import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const url='https://www.blablalink.com/shiftyspad/nikke-list';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({locale:'ko-KR'});
await page.goto(url,{waitUntil:'networkidle',timeout:120000});
await page.waitForSelector('[data-cname="all-item"]',{timeout:120000});
const catalog=await page.$$eval('[data-cname="all-item"]', cards => {
  const out=[];
  for(const card of cards){
    const text=[...card.querySelectorAll('span')].map(x=>x.textContent?.trim()).filter(Boolean);
    const name=text.sort((a,b)=>b.length-a.length)[0]||'';
    const img=card.querySelector('img');
    const src=img?.currentSrc||img?.src||'';
    if(name&&src&&/blablalink\.com|sg-tools-cdn\.blablalink\.com/.test(src))out.push({name,source:src});
  }
  return out;
});
await browser.close();
const dedup=[...new Map(catalog.map(x=>[x.name,x])).values()].sort((a,b)=>b.name.length-a.name.length);
if(!dedup.length)throw new Error('Blablalink character catalog is empty');
await writeFile('character-catalog.js', 'window.NIKKE_CHARACTER_CATALOG = '+JSON.stringify(dedup,null,2)+';\n');
console.log('characters:',dedup.length);
