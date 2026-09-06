'use strict';
// Transport boundary. UI code knows neither Google Sheets nor HTTP endpoints.
window.BossRepository = (() => {
  let busy = false;
  async function request(action, changes) {
    if (busy) throw new Error('이전 요청 처리 중');
    busy = true;
    try {
      let result;
      if (window.google?.script?.run) {
        // Do not time out RPC locally: a timed-out write may still be executing.
        result = await new Promise((resolve, reject) => google.script.run
          .withSuccessHandler(resolve).withFailureHandler(reject).bossApi(changes ? {action, changes} : {action}));
      } else {
        const endpoint = window.UNION_SHARED_URL;
        if (!endpoint) throw new Error('공유 저장소 주소가 없습니다.');
        const response = await fetch(action === 'save' ? endpoint : `${endpoint}?action=${action}&t=${Date.now()}`, {
          method:action === 'save' ? 'POST' : 'GET', redirect:'follow', cache:'no-store',
          ...(action === 'save' ? {headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify({action, changes})} : {})
        });
        result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      }
      if (result.error) throw new Error(result.error);
      return result;
    } finally { busy = false; }
  }
  return {checkVersion:async () => (await request('version')).version,
    load:() => request('load'), save:changes => request('save', changes)};
})();
