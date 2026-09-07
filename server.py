from __future__ import annotations
import hashlib, hmac, json, mimetypes, os, re, secrets, tempfile
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse
from solver import InputError, solve

ROOT=Path(__file__).resolve().parent
DATA=Path(os.environ.get('DATA_DIR',ROOT/'.server'));DATA.mkdir(parents=True,exist_ok=True)
KEY_FILE=DATA/'admin-key.txt';PLANNER_FILE=DATA/'planner.json';BOSSES_FILE=DATA/'bosses.json'
if os.environ.get('ADMIN_PASSWORD'): PASSWORD=os.environ['ADMIN_PASSWORD']
else:
    if not KEY_FILE.exists(): KEY_FILE.write_text(secrets.token_urlsafe(24),encoding='utf-8')
    PASSWORD=KEY_FILE.read_text(encoding='utf-8').strip()

def atomic_write(path:Path,value:dict):
    fd,tmp=tempfile.mkstemp(dir=path.parent,prefix=path.name+'.',suffix='.tmp')
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f:json.dump(value,f,ensure_ascii=False,indent=2)
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def default_boss_store():
    rounds=json.loads((ROOT/'default-bosses.json').read_text(encoding='utf-8'))
    return {'rounds':rounds,'revisions':{k:[0]*len(v) for k,v in rounds.items()}}

class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.js':'text/javascript','.css':'text/css','.webp':'image/webp'}
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def json(self,status,value):
        data=json.dumps(value,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def authorized(self):
        supplied=self.headers.get('Authorization','').removeprefix('Bearer ')
        return hmac.compare_digest(hashlib.sha256(supplied.encode()).digest(),hashlib.sha256(PASSWORD.encode()).digest())
    def body(self,limit=5*1024*1024):
        if not self.headers.get('Content-Type','').startswith('application/json'):raise InputError('JSON 형식이 필요합니다.')
        size=int(self.headers.get('Content-Length','0')); 
        if size<=0 or size>limit:raise InputError('입력 크기를 확인해 주세요.')
        try:return json.loads(self.rfile.read(size))
        except Exception as exc:raise InputError('입력 형식을 확인해 주세요.') from exc
    def do_GET(self):
        path=urlparse(self.path).path
        if path=='/api/planner':return self.json(200,json.loads(PLANNER_FILE.read_text(encoding='utf-8')) if PLANNER_FILE.exists() else {'state':None,'revision':0})
        if path=='/api/bosses':return self.json(200,json.loads(BOSSES_FILE.read_text(encoding='utf-8')) if BOSSES_FILE.exists() else default_boss_store())
        if path=='/':self.path='/index.html'
        return super().do_GET()
    def do_PUT(self):
        path=urlparse(self.path).path
        try:body=self.body()
        except InputError as e:return self.json(400,{'error':str(e)})
        if path=='/api/planner':
            current=json.loads(PLANNER_FILE.read_text(encoding='utf-8')) if PLANNER_FILE.exists() else {'state':None,'revision':0}
            state=body.get('state');
            if not isinstance(state,dict) or not isinstance(state.get('users'),list) or len(state['users'])>32:return self.json(400,{'error':'운영 데이터 형식이 올바르지 않습니다.'})
            if body.get('revision')!=current['revision']:return self.json(409,{'error':'다른 관리자가 먼저 저장했습니다. 최신 데이터를 불러오세요.'})
            result={'state':state,'revision':current['revision']+1};atomic_write(PLANNER_FILE,result)
            boss_store=json.loads(BOSSES_FILE.read_text(encoding='utf-8')) if BOSSES_FILE.exists() else default_boss_store()
            for round_no,cards in boss_store['rounds'].items():
                for index,card in enumerate(cards):
                    match=next((b for b in state.get('bosses',[]) if str(b.get('round'))==round_no and b.get('element')==card.get('element')),None)
                    if match:
                        boss_store['rounds'][round_no][index]={'name':match['name'],'element':match['element'],'hp':match['hp']};boss_store['revisions'][round_no][index]+=1
            atomic_write(BOSSES_FILE,boss_store);return self.json(200,result)
        match=re.fullmatch(r'/api/bosses/([1-4])/([0-4])',path)
        if match:
            current=json.loads(BOSSES_FILE.read_text(encoding='utf-8')) if BOSSES_FILE.exists() else default_boss_store()
            round_no,index=match.group(1),int(match.group(2));boss=body.get('boss',{})
            if round_no not in current['rounds'] or index>=len(current['rounds'][round_no]):return self.json(404,{'error':'보스가 없습니다.'})
            if body.get('revision')!=current['revisions'][round_no][index]:return self.json(409,{'error':'다른 관리자가 먼저 수정했습니다. 최신 정보를 불러오세요.'})
            if not isinstance(boss.get('name'),str) or not boss['name'].strip() or boss.get('element') not in {'철갑','수냉','작열','풍압','전격'} or not (boss.get('hp')=='infinite' or isinstance(boss.get('hp'),int) and boss['hp']>0):return self.json(400,{'error':'이름·속성·체력 형식을 확인해 주세요.'})
            current['rounds'][round_no][index]={'name':boss['name'].strip(),'element':boss['element'],'hp':boss['hp']};current['revisions'][round_no][index]+=1;atomic_write(BOSSES_FILE,current);return self.json(200,current)
        return self.json(404,{'error':'지원하지 않는 요청입니다.'})
    def do_POST(self):
        if urlparse(self.path).path!='/api/solve':return self.json(404,{'error':'지원하지 않는 요청입니다.'})
        try:
            body=self.body();plan=solve(body.get('state',{}));return self.json(200,{'plan':plan})
        except InputError as e:return self.json(400,{'error':str(e)})
        except Exception as e:
            print('Solver error:',repr(e));return self.json(500,{'error':'최적화 계산 중 오류가 발생했습니다.'})
    def log_message(self,fmt,*args):print('%s - %s'%(self.address_string(),fmt%args))

if __name__=='__main__':
    host=os.environ.get('HOST','127.0.0.1');port=int(os.environ.get('PORT','8787'))
    print(f'Union planner: http://{host}:{port}/planner.html')
    if not os.environ.get('ADMIN_PASSWORD'):print(f'Admin password: {KEY_FILE}')
    ThreadingHTTPServer((host,port),Handler).serve_forever()
