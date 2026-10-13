import 'dotenv/config';
import { buildApp } from './app.js';
import { registerOpenApi } from './openapi.js';

// Servidor HTTP usado em desenvolvimento (`pnpm dev`), por `pnpm start`
// (dist/server.js) e pelo container Docker. Em produção a API roda como
// Lambda (src/handler.ts), sem servidor HTTP próprio.
const start = async () => {
  const app = buildApp({ beforeRoutes: registerOpenApi });
  await app.listen({ port: 3000, host: '0.0.0.0' });
  console.log('API rodando em http://localhost:3000 (documentação em /docs)');
};

start();
