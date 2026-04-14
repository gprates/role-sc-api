import { build } from 'esbuild';

await build({
  entryPoints: ['src/handler.ts'],
  bundle: true,
  minify: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outdir: 'dist',
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  external: ['bcrypt'],
});

console.log('Build concluído → dist/handler.js');
