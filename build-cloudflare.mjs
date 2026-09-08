import { mkdir, copyFile, cp, writeFile, rm, readdir } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import './build-cpsat.mjs';
const files = ['index.html','planner.html','styles.css','planner.css','app.js','planner.js',
  'data.js','characters.js','level_attack_power.js','shared-config.js','boss-repository.js',
  'planner-optimizer-ui.js','planner-cpsat-worker.js','planner-hybrid-engine-v2.js','planner-hybrid-engine-v3.js'];
const outputRoot = resolve('dist/client');
if (dirname(outputRoot) !== resolve('dist')) throw new Error('Unexpected static output directory');
await mkdir(outputRoot,{recursive:true});
for (const entry of await readdir(outputRoot,{recursive:true,withFileTypes:true})) {
  if (!entry.isFile()) continue;
  const file=resolve(entry.parentPath,entry.name);
  if (!file.startsWith(outputRoot+sep)) throw new Error('Unexpected generated asset path');
  await rm(file,{force:true});
}
for (const file of files) await copyFile(file,`dist/client/${file}`);
try { await copyFile('character-catalog.js','dist/client/character-catalog.js'); }
catch(error){ if(error.code!=='ENOENT')throw error; await writeFile('dist/client/character-catalog.js','window.NIKKE_CHARACTER_CATALOG = window.NIKKE_CHARACTERS || [];\n');}
await cp('assets','dist/client/assets',{recursive:true});
await cp('vendor','dist/client/vendor',{recursive:true});
await writeFile('dist/client/build-info.json',JSON.stringify({builtAt:new Date().toISOString()}));
console.log('Cloudflare site built in dist/client');
