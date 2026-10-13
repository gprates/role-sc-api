import { build } from 'esbuild';

// Handler da Lambda: um arquivo só, com todas as dependências.
// (O deploy usa o esbuild do `sam build`, configurado no template.yaml.)
await build({
  entryPoints: ['src/handler.ts'],
  bundle: true,
  minify: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outdir: 'dist',
  external: [],
});

console.log('Build concluído → dist/handler.js');

// Servidor HTTP (`pnpm start` e Docker): só o código do projeto; as
// dependências ficam em node_modules (o @fastify/swagger-ui precisa dos
// arquivos estáticos do pacote para servir /docs).
await build({
  entryPoints: { server: 'src/invoke-local.ts' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  packages: 'external',
  outdir: 'dist',
});

console.log('Build concluído → dist/server.js');
