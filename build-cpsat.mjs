import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('vendor/build/portable', { recursive: true });
await build({
  entryPoints: ['cpsat-vendor-entry.js'], bundle: true, format: 'esm',
  platform: 'browser', external: ['node:*'], outfile: 'vendor/cpsat/index.js'
});
for (const name of ['cpsat.mjs', 'cpsat.wasm']) {
  await copyFile(`node_modules/cpsat-js/build/portable/${name}`, `vendor/build/portable/${name}`);
}
