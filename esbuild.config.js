import { build } from 'esbuild';

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
