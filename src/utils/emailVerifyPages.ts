export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const baseStyles = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(180deg, #F0F9FF 0%, #DBEAFE 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: #001E3C;
    }
    .card {
      background: white;
      border-radius: 24px;
      padding: 48px 32px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 8px 24px rgba(15,23,42,0.1);
    }
    .icon {
      width: 72px; height: 72px;
      border-radius: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
      font-size: 36px;
      font-weight: bold;
    }
    h1 { font-size: 22px; margin-bottom: 8px; }
    p { color: #64748B; line-height: 1.5; font-size: 15px; }
    .footer { margin-top: 24px; font-size: 13px; color: #94A3B8; }
`;

export function renderSuccessPage(nome: string): string {
  const nomeSafe = escapeHtml(nome);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email verificado — Rolê SC</title>
  <style>${baseStyles}
    .icon { background: #DBEAFE; color: #1E88E5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10003;</div>
    <h1>Email verificado!</h1>
    <p>Tudo certo, ${nomeSafe}. Agora você pode voltar ao app Rolê SC e fazer login.</p>
    <p class="footer">Rolê SC · Eventos do litoral catarinense</p>
  </div>
</body>
</html>`;
}

export function renderErrorPage(reason: string): string {
  const reasonSafe = escapeHtml(reason);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Link inválido — Rolê SC</title>
  <style>${baseStyles}
    .icon { background: #FEE2E2; color: #EF4444; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10007;</div>
    <h1>Link inválido ou expirado</h1>
    <p>${reasonSafe}</p>
    <p class="footer">Volte ao app Rolê SC e solicite um novo link de verificação.</p>
  </div>
</body>
</html>`;
}
