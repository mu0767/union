import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const url='https://www.blablalink.com/shiftyspad/nikke-list';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({locale:'ko-KR',viewport:{width:1440,height:1000}});
await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000});
await page.waitForSelector('[data-cname="all-item"]',{timeout:120000});

const found=new Map();
async function harvest(){
  const rows=await page.$$eval('[data-cname="all-item"]', cards => cards.flatMap(card=>{
    const img=card.querySelector('img');
    const src=img?.currentSrc||img?.src||'';
    if(!src||!/blablalink\.com|sg-tools-cdn\.blablalink\.com/.test(src))return [];
    const names=[img?.alt,img?.title,...card.querySelectorAll('span')].map(x=>typeof x==='string'?x:x?.textContent).map(x=>x?.trim()).filter(Boolean);
    return [...new Set(names)].filter(name=>name.length<=40&&!/^(SSR|SR|R|ALL|전체|화력형|방어형|지원형|1|2|3)$/.test(name)).map(name=>({name,source:src}));
  }));
  for(const row of rows)found.set(row.name,row.source);
}
await harvest();

for(let pass=0;pass<5;pass++){
  const scrollables=await page.locator('div').evaluateAll(nodes=>nodes.map((n,i)=>({i,sh:n.scrollHeight,ch:n.clientHeight})).filter(x=>x.sh>x.ch+200).sort((a,b)=>b.sh-b.ch-(a.sh-a.ch)).slice(0,8).map(x=>x.i));
  for(const idx of scrollables){
    const locator=page.locator('div').nth(idx);
    const max=await locator.evaluate(el=>el.scrollHeight-el.clientHeight).catch(()=>0);
    if(!max)continue;
    for(let pos=0;pos<=max;pos+=Math.max(250,Math.floor(max/25))){
      await locator.evaluate((el,y)=>{el.scrollTop=y},pos).catch(()=>{});
      await page.waitForTimeout(120);
      await harvest();
    }
  }
  const height=await page.evaluate(()=>document.documentElement.scrollHeight);
  for(let y=0;y<=height;y+=700){await page.evaluate(v=>scrollTo(0,v),y);await page.waitForTimeout(100);await harvest();}
}
await browser.close();

const catalog=[...found].map(([name,source])=>({name,source})).sort((a,b)=>b.name.length-a.name.length);
if(catalog.length<30)throw new Error('Blablalink character catalog too small: '+catalog.length);
await writeFile('character-catalog.js','window.NIKKE_CHARACTER_CATALOG = '+JSON.stringify(catalog,null,2)+';\n');
console.log('characters:',catalog.length);
console.log('WILLE:',catalog.filter(x=>x.name.includes('WILLE')||x.name.includes('아스카')).map(x=>x.name).join(' | '));
