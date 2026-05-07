import { ObjectId } from 'mongodb';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  NotFound,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as userRepo from '../database/repositories/user.repository.js';
import {
  AVATAR_ACCEPTED_MIME_TYPES,
  AVATAR_MAX_SIZE_BYTES,
  type AvatarMimeType,
  type AvatarUploadUrlResponse,
  type AvatarConfirmResponse,
} from '../types/avatar.types.js';
import { createLogger } from '../utils/logger.utils.js';

const logger = createLogger('AvatarService');

const PRESIGN_EXPIRES_SECONDS = 5 * 60; // 5min — janela curta pro PUT do client

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;

  const region = process.env.S3_AVATARS_REGION;
  if (!region) {
    throw new Error('S3_AVATARS_REGION não configurada');
  }

  client = new S3Client({ region });
  return client;
}

function getBucket(): string {
  const bucket = process.env.S3_AVATARS_BUCKET;
  if (!bucket) {
    throw new Error('S3_AVATARS_BUCKET não configurada');
  }
  return bucket;
}

function getRegion(): string {
  const region = process.env.S3_AVATARS_REGION;
  if (!region) {
    throw new Error('S3_AVATARS_REGION não configurada');
  }
  return region;
}

function buildKey(userId: string): string {
  // Mesma key sempre = sobrescreve avatar anterior, sem orfãos. Sem extensão:
  // o Content-Type fica em metadata do S3.
  return `avatars/${userId}`;
}

function buildPublicUrl(key: string): string {
  // Cache busting via timestamp — o React Native trata URLs com query params
  // como recursos diferentes, então o <Image> não usa o cache antigo.
  return `https://${getBucket()}.s3.${getRegion()}.amazonaws.com/${key}?v=${Date.now()}`;
}

function isAcceptedMimeType(value: string): value is AvatarMimeType {
  return (AVATAR_ACCEPTED_MIME_TYPES as readonly string[]).includes(value);
}

function makeInvalidTypeError(): Error & { statusCode: number; code: string } {
  const error = new Error(
    'Apenas JPG, PNG, WebP e GIF são suportados.',
  ) as Error & { statusCode: number; code: string };
  error.statusCode = 400;
  error.code = 'AVATAR_INVALID_TYPE';
  return error;
}

function makeTooLargeError(): Error & { statusCode: number; code: string } {
  const error = new Error('Imagem maior que o limite de 5MB.') as Error & {
    statusCode: number;
    code: string;
  };
  error.statusCode = 400;
  error.code = 'AVATAR_TOO_LARGE';
  return error;
}

function makeNotUploadedError(): Error & { statusCode: number; code: string } {
  const error = new Error(
    'O upload não foi finalizado. Tente novamente.',
  ) as Error & { statusCode: number; code: string };
  error.statusCode = 400;
  error.code = 'AVATAR_NOT_UPLOADED';
  return error;
}

export async function getUploadUrl(
  userId: string,
  contentType: string,
  sizeBytes: number,
): Promise<AvatarUploadUrlResponse> {
  if (!isAcceptedMimeType(contentType)) {
    throw makeInvalidTypeError();
  }
  if (
    !Number.isInteger(sizeBytes) ||
    sizeBytes < 0 ||
    sizeBytes > AVATAR_MAX_SIZE_BYTES
  ) {
    throw makeTooLargeError();
  }

  const key = buildKey(userId);

  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
    ContentLength: sizeBytes,
  });

  const uploadUrl = await getSignedUrl(getClient(), command, {
    expiresIn: PRESIGN_EXPIRES_SECONDS,
  });

  return {
    success: true,
    uploadUrl,
    key,
    // O frontend deve enviar EXATAMENTE esses headers no PUT pro S3.
    // Como ContentType foi parte da assinatura, ele PRECISA bater senão
    // o S3 rejeita o PUT com 403.
    headers: { 'Content-Type': contentType },
  };
}

export async function confirmAvatar(
  userId: string,
  key: string,
): Promise<AvatarConfirmResponse> {
  // Defesa contra IDOR: o cliente NUNCA pode confirmar avatar de outro user.
  // Reusamos o erro genérico de "não foi feito upload" pra não distinguir
  // (em logs) tentativas maliciosas de keys legítimas com objeto faltando.
  const expectedKey = buildKey(userId);
  if (key !== expectedKey) {
    logger.warn(
      `Tentativa de confirm com key inesperada: userId=${userId} keyRecebida=${key}`,
    );
    throw makeNotUploadedError();
  }

  const head = await getClient()
    .send(
      new HeadObjectCommand({
        Bucket: getBucket(),
        Key: key,
      }),
    )
    .catch((err: unknown) => {
      // SDK v3: NotFound é uma classe específica; outros 404 também caem aqui
      // por causa do `name` em alguns casos.
      if (
        err instanceof NotFound ||
        (err as { name?: string })?.name === 'NotFound' ||
        (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
          ?.httpStatusCode === 404
      ) {
        throw makeNotUploadedError();
      }
      logger.error('Falha no HEAD do S3 em confirm-avatar:', err);
      throw err;
    });

  // Defesa em profundidade: o cliente pode ter mentido o sizeBytes/contentType
  // no upload-url. Aqui validamos o que o S3 efetivamente recebeu.
  const contentLength = head.ContentLength ?? 0;
  if (contentLength > AVATAR_MAX_SIZE_BYTES) {
    throw makeTooLargeError();
  }

  const contentType = head.ContentType ?? '';
  if (!isAcceptedMimeType(contentType)) {
    throw makeInvalidTypeError();
  }

  const avatarUrl = buildPublicUrl(key);
  await userRepo.updateAvatarUrl(new ObjectId(userId), avatarUrl);

  return {
    success: true,
    avatarUrl,
  };
}
