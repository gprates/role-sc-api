import {
  SESv2Client,
  SendEmailCommand,
} from '@aws-sdk/client-sesv2';
import { createLogger } from '../utils/logger.utils.js';
import { escapeHtml } from '../utils/emailVerifyPages.js';

const logger = createLogger('EmailService');

let client: SESv2Client | null = null;

function getClient(): SESv2Client {
  if (client) return client;

  const region = process.env.SES_AWS_REGION;
  if (!region) {
    throw new Error('SES_AWS_REGION não configurada');
  }

  client = new SESv2Client({ region });
  return client;
}

function buildVerificationUrl(token: string): string {
  const base = process.env.APP_BASE_URL;
  if (!base) {
    throw new Error('APP_BASE_URL não configurada');
  }
  return `${base.replace(/\/+$/, '')}/auth/verify-email?token=${encodeURIComponent(token)}`;
}

function buildTextBody(nome: string, url: string): string {
  return [
    `Olá, ${nome}!`,
    '',
    'Bem-vindo(a) ao Rolê SC. Pra ativar sua conta e começar a descobrir eventos',
    'no litoral catarinense, clique no link abaixo:',
    '',
    url,
    '',
    'Este link expira em 24 horas. Se você não criou essa conta, ignore este email.',
    '',
    '---',
    'Rolê SC · Eventos do litoral catarinense',
  ].join('\n');
}

function buildHtmlBody(nome: string, url: string): string {
  const nomeSafe = escapeHtml(nome);
  const urlSafe = escapeHtml(url);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirme seu email — Rolê SC</title>
</head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F0F9FF;color:#001E3C;">
  <div style="max-width:480px;margin:0 auto;background:white;border-radius:24px;padding:40px 28px;box-shadow:0 8px 24px rgba(15,23,42,0.1);">
    <h1 style="font-size:22px;margin:0 0 16px 0;">Olá, ${nomeSafe}!</h1>
    <p style="color:#334155;line-height:1.6;font-size:15px;margin:0 0 16px 0;">
      Bem-vindo(a) ao Rolê SC. Pra ativar sua conta e começar a descobrir eventos
      no litoral catarinense, clique no botão abaixo:
    </p>
    <p style="text-align:center;margin:28px 0;">
      <a href="${urlSafe}" style="display:inline-block;background:#1E88E5;color:white;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:600;font-size:15px;">
        Confirmar email
      </a>
    </p>
    <p style="color:#64748B;line-height:1.5;font-size:13px;margin:16px 0 0 0;">
      Se o botão não funcionar, copie e cole esta URL no seu navegador:
    </p>
    <p style="color:#1E88E5;font-size:12px;word-break:break-all;margin:4px 0 24px 0;">
      ${urlSafe}
    </p>
    <p style="color:#94A3B8;font-size:13px;line-height:1.5;margin:0;border-top:1px solid #E2E8F0;padding-top:16px;">
      Este link expira em 24 horas. Se você não criou essa conta, ignore este email.
    </p>
    <p style="color:#94A3B8;font-size:12px;margin:16px 0 0 0;">
      Rolê SC · Eventos do litoral catarinense
    </p>
  </div>
</body>
</html>`;
}

export async function sendVerificationEmail(
  to: string,
  nome: string,
  token: string,
): Promise<void> {
  const from = process.env.SES_FROM_EMAIL;
  if (!from) {
    throw new Error('SES_FROM_EMAIL não configurada');
  }

  const url = buildVerificationUrl(token);
  const textBody = buildTextBody(nome, url);
  const htmlBody = buildHtmlBody(nome, url);

  const command = new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: 'Confirme seu email no Rolê SC', Charset: 'UTF-8' },
        Body: {
          Text: { Data: textBody, Charset: 'UTF-8' },
          Html: { Data: htmlBody, Charset: 'UTF-8' },
        },
      },
    },
  });

  try {
    const response = await getClient().send(command);
    logger.info(`Email de verificação enviado para ${to} (MessageId=${response.MessageId})`);
  } catch (err) {
    logger.error(`Falha ao enviar email de verificação para ${to}:`, err);
    throw err;
  }
}
