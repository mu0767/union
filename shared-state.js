'use strict';
window.SharedState = (() => {
  async function request(method, body) {
    const response = await fetch('/api/shared-state', {
      method, cache:'no-store',
      ...(body ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error('공유 서버에 연결하지 못했습니다. Cloudflare 배포 주소에서 접속해 주세요.'); }
    if (!response.ok) { const error = new Error(data.error || '공유 저장 실패'); error.status = response.status; throw error; }
    return data;
  }
  return {load:() => request('GET'), save:(version, key, value, mutationId=crypto.randomUUID()) =>
    request('POST', {version,key,value,mutationId})};
})();
