import { mkdir, copyFile, cp, writeFile, rm, readdir } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import './build-cpsat.mjs';
// Only public site files belong in Static Assets.
const files = ['index.html','planner.html','styles.css','planner.css','app.js','planner.js',
  'data.js','characters.js','level_attack_power.js','shared-config.js',
  'shared-state.js','boss-repository.js','planner-solver.js','planner-solver-worker.js',
  'planner-cpsat-engine.js','planner-cpsat-worker.js'];
const outputRoot = resolve('dist/client');
if (dirname(outputRoot) !== resolve('dist')) throw new Error('Unexpected static output directory');
await mkdir(outputRoot, {recursive:true});
// Windows dev watchers hold the directory open. Remove generated files, retaining directories.
for (const entry of await readdir(outputRoot, {recursive:true,withFileTypes:true})) {
  if (!entry.isFile()) continue;
  const file = resolve(entry.parentPath,entry.name);
  if (!file.startsWith(outputRoot + sep)) throw new Error('Unexpected generated asset path');
  await rm(file, {force:true});
}
for (const file of files) await copyFile(file, `dist/client/${file}`);
try { await copyFile('character-catalog.js', 'dist/client/character-catalog.js'); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await writeFile('dist/client/character-catalog.js', 'window.NIKKE_CHARACTER_CATALOG = window.NIKKE_CHARACTERS || [];\n');
}
await cp('assets', 'dist/client/assets', {recursive:true});
await cp('vendor/cpsat', 'dist/client/vendor/cpsat', {recursive:true});
await cp('vendor/build/portable', 'dist/client/vendor/build/portable', {recursive:true});
await writeFile('dist/client/_headers', `/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
  Cache-Control: no-cache
`);
console.log('Cloudflare site built in dist/client');
