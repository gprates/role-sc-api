// Constantes em sincronia com o frontend (src/types/avatar.types.ts).
// Qualquer mudança aqui implica mudança no client — e vice-versa.

export const AVATAR_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const AVATAR_ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export type AvatarMimeType = (typeof AVATAR_ACCEPTED_MIME_TYPES)[number];

export interface AvatarUploadUrlBody {
  contentType: string;
  sizeBytes: number;
}

export interface AvatarConfirmBody {
  key: string;
}

export interface AvatarUploadUrlResponse {
  success: true;
  uploadUrl: string;
  key: string;
  headers: { 'Content-Type': string };
}

export interface AvatarConfirmResponse {
  success: true;
  avatarUrl: string;
}
