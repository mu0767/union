"""Bundle the existing UI and its assets with a small managed-storage Worker."""
from pathlib import Path
import base64
import json
import mimetypes

root = Path(__file__).resolve().parent
names = ['index.html','styles.css','app.js','data.js','characters.js','boss-repository.js','shared-config.js',
         'planner.html','planner.css','planner.js']
files = [root / name for name in names] + list((root/'assets').rglob('*'))
assets = {}
for path in files:
    if not path.is_file(): continue
    mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    if path.suffix == '.js': mime = 'text/javascript'
    assets['/' + path.relative_to(root).as_posix()] = {'type':mime,'data':base64.b64encode(path.read_bytes()).decode('ascii')}
rounds = json.loads((root/'default-bosses.json').read_text(encoding='utf-8'))
initial = {'rounds':rounds, 'revisions':{r:[0]*len(b) for r,b in rounds.items()}}
gas = (root/'apps-script/Code.gs').read_text(encoding='utf-8')
merge = gas[gas.index('function mergeBossChanges_('):gas.index('function bossApi(')]
output = 'const ASSETS = '+json.dumps(assets)+';\nconst INITIAL_STORE = '+json.dumps(initial)+';\n'+merge+'\n'+(root/'worker/index.js').read_text(encoding='utf-8')
(root/'dist/server').mkdir(parents=True,exist_ok=True)
(root/'dist/.openai').mkdir(parents=True,exist_ok=True)
(root/'dist/server/index.js').write_text(output,encoding='utf-8')
(root/'dist/.openai/hosting.json').write_bytes((root/'.openai/hosting.json').read_bytes())
print(f'Built Worker with {len(assets)} existing assets; {len(output)} bytes')
