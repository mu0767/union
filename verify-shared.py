"""Browser integration checks with an in-memory Apps Script API. No Google credentials."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent
html = (root / 'index.html').read_text(encoding='utf-8')
backend = (root / 'apps-script/Code.gs').read_text(encoding='utf-8')
defaults = (root / 'default-bosses.json').read_text(encoding='utf-8')
test = r"""
const results = [];
function check(value, label) { if (!value) throw Error(label); results.push(label); }
async function verify() {
 try {
  await loadSharedBosses();
  check(serverReady, 'initial load');
  const original = structuredClone(mockStore);
  const batch = [];
  for (const round of [1,2,3,4]) for (let index=0;index<original.rounds[round].length;index++) {
    for (const field of ['name','element']) batch.push({round,index,field,before:original.rounds[round][index][field],value:field==='name' ? 'User '+round+index : original.rounds[round][index].element==='철갑' ? '수냉' : '철갑'});
  }
  let concurrent = structuredClone(original);
  for (const change of batch) concurrent = mergeBossChanges_(concurrent,[change]);
  check(concurrent.version===32, '32 stale clients merge independent fields');
  check(mergeBossChanges_(concurrent,[batch[0]]).version===32, 'lost-response retry idempotent');
  let conflict=false;
  try { mergeBossChanges_(concurrent,[{...batch[2],value:'another'},{...batch[0],value:'conflict'}]); } catch { conflict=true; }
  check(conflict && concurrent.version===32, 'conflict rejects entire batch');
  let invalid=false; try {mergeBossChanges_(original,[{round:4,index:0,field:'hp',before:'infinite',value:1}]);} catch {invalid=true;}
  check(invalid,'final HP invariant');
  selectPage('bosses');
  const input=$('boss-list').querySelector('input'); input.focus(); input.value='Draft'; input.dispatchEvent(new Event('input',{bubbles:true}));
  const row=$('table-body').firstElementChild;
  const beforeCalls=loads;
  await loadSharedBosses();
  check(loads===beforeCalls, 'unchanged version skips snapshot');
  mockStore=mergeBossChanges_(mockStore,[{round:1,index:1,field:'name',before:mockStore.rounds[1][1].name,value:'Remote'}]);
  await loadSharedBosses();
  check(input===$('boss-list').querySelector('input') && input.value==='Draft' && document.activeElement===input,'focused draft and DOM preserved');
  check(row===$('table-body').firstElementChild,'table rows preserved');
  check($('boss-list').querySelectorAll('[name="bossName"]')[1].value==='Remote','unrelated field updated');
  $('save-bosses').click(); await new Promise(r=>setTimeout(r,20));
  check(mockStore.rounds[1][0].name==='Draft' && mockStore.rounds[1][1].name==='Remote','only edited field saved');
  input.value='unsaved';input.dispatchEvent(new Event('input',{bubbles:true}));
  failSave=true;$('save-bosses').click();await new Promise(r=>setTimeout(r,20));
  check(bossDirty && input.value==='unsaved' && $('server-status').textContent.includes('offline'),'failed save retains input');
  failSave=false;$('save-bosses').click();await new Promise(r=>setTimeout(r,20));
  check(mockStore.rounds[1][0].name==='unsaved' && !bossDirty,'second save and failure retry use updated base');
  check(!overlap,'requests do not overlap');
  document.body.innerHTML='<pre id="result">PASS '+results.join('\n')+'</pre>';
 } catch(e) {document.body.innerHTML='<pre id="result">FAIL '+e.stack+'</pre>';}
}
window.addEventListener('DOMContentLoaded', () => setTimeout(verify, 50));
"""
mock = "const mockDefaults=" + defaults + r""";
let mockStore={rounds:mockDefaults,revisions:Object.fromEntries(Object.entries(mockDefaults).map(([r,b])=>[r,b.map(()=>0)])),version:0};
let loads=0,failSave=false,active=0,overlap=false;
async function invoke(fn) { if(active++) overlap=true; await Promise.resolve();try{return fn();}finally{active--;}}
window.google={script:{run:{withSuccessHandler(resolve){return {withFailureHandler(reject){return {bossApi(request){invoke(()=>{
  if(request.action==='version')return {version:mockStore.version};
  if(request.action==='load'){loads++;return structuredClone(mockStore);}
  if(failSave)throw Error('offline');
  mockStore=mergeBossChanges_(mockStore,request.changes);return structuredClone(mockStore);
}).then(resolve,reject);}};}};}}}};
"""
html = html.replace('<script src="boss-repository.js" defer></script>', '<script>'+backend+mock+'</script><script src="boss-repository.js" defer></script>')
html = html.replace('</body>', '<script>'+test+'</script></body>')
path = root / 'shared-check.html'
path.write_text(html, encoding='utf-8')
chrome = Path('C:/Program Files/Google/Chrome/Application/chrome.exe')
with tempfile.TemporaryDirectory(prefix='union-shared-') as profile:
    result = subprocess.run([str(chrome),'--headless','--disable-gpu','--in-process-gpu','--no-sandbox','--no-first-run','--allow-file-access-from-files',f'--user-data-dir={profile}','--dump-dom','--virtual-time-budget=4000',path.as_uri()],capture_output=True,encoding='utf-8',timeout=30)
    import re
    match = re.search(r'<pre id="result">(.*?)</pre>',result.stdout,re.S)
    print(match.group(1) if match else result.stderr[-2000:])
    if not match or not match.group(1).startswith('PASS'): raise SystemExit(1)
path.unlink()
