'use strict';

(function installDeepOptimizer(){
  const calculateButton=$('calculate');
  const recalculateButton=$('recalculate');
  if(!calculateButton||!recalculateButton)return;

  calculateButton.removeEventListener('click',calculate);
  recalculateButton.removeEventListener('click',calculate);

  const stageOf=plan=>plan?.summary?.reachedFinal?3:Math.max(0,Number(plan?.summary?.reachedRound||1)-1);
  const statusRank=plan=>plan?.status==='OPTIMAL'?1:0;
  const betterPlan=(candidate,current)=>{
    if(!current)return true;
    const aStage=stageOf(candidate),bStage=stageOf(current);
    if(aStage!==bStage)return aStage>bStage;
    const aTarget=Number(candidate?.summary?.targetDamage||0),bTarget=Number(current?.summary?.targetDamage||0);
    if(aTarget!==bTarget)return aTarget>bTarget;
    const aWaste=Number(candidate?.summary?.planningWaste??Number.MAX_SAFE_INTEGER);
    const bWaste=Number(current?.summary?.planningWaste??Number.MAX_SAFE_INTEGER);
    if(aWaste!==bWaste)return aWaste<bWaste;
    const aOver=Number(candidate?.summary?.totalOverkill??Number.MAX_SAFE_INTEGER);
    const bOver=Number(current?.summary?.totalOverkill??Number.MAX_SAFE_INTEGER);
    if(aOver!==bOver)return aOver<bOver;
    return statusRank(candidate)>statusRank(current);
  };

  const renderProof=plan=>{
    const holder=$('plan-summary');
    if(!holder||!plan)return;
    const old=holder.querySelector('[data-optimizer-proof]');
    if(old)old.remove();
    const card=document.createElement('div');
    card.className='summary-card';
    card.dataset.optimizerProof='true';
    const o=plan.summary?.optimization||{};
    const proof=plan.status==='OPTIMAL'?'충분히 좋은 계획 · 최적성도 증명됨':'실전 최선해 · 계속 개선 가능한 해';
    card.innerHTML=`<small>최적화 상태</small><strong>${proof}</strong><small>효율 우선 초기배치 → 전역 교환/개선 · 도달 ${o.stage||'-'} · 목표딜 ${o.target||'-'} · 낭비 ${o.waste||'-'}</small>`;
    holder.append(card);
  };

  async function calculateDeep(){
    if(calculateButton.disabled)return;
    const buttons=[calculateButton,recalculateButton];
    buttons.forEach(button=>{
      button.disabled=true;
      button.classList.add('is-calculating');
      button.dataset.label=button.textContent;
      button.textContent='전역 최적화 중…';
    });
    const snapshot=JSON.stringify({...state,plan:null});
    const started=Date.now();
    const wallBudgetMs=30000;
    const deadline=started+wallBudgetMs;
    let phase='30초 실전 최적화 준비 중…';
    const updateStatus=()=>{$('planner-status').textContent=`[${Math.floor((Date.now()-started)/1000)}초] ${phase}`;};
    updateStatus();
    const ticker=setInterval(updateStatus,1000);
    const workers=[];
    try{
      const hardware=Math.max(1,Number(navigator.hardwareConcurrency)||4);
      // GitHub Pages is normally not cross-origin isolated, so OR-Tools cannot
      // safely use pthread search workers there. Run several independent WASM
      // solver workers with different seeds instead. When isolation is available,
      // one solver can use its own multi-worker CP-SAT portfolio internally.
      const portfolioCount=globalThis.crossOriginIsolated===true?1:Math.min(4,Math.max(2,Math.floor(hardware/2)));
      let best=null,finished=0,failed=0,resolved=false;
      const plan=await new Promise((resolve,reject)=>{
        const hardTimeout=setTimeout(()=>{
          if(resolved)return;
          resolved=true;
          workers.forEach(worker=>worker.terminate());
          if(best)resolve(best);
          else reject(new Error('30초 실전 최적화 제한 시간 안에 실행 가능한 해를 찾지 못했습니다.'));
        },Math.max(1,deadline-Date.now()));

        const finishOne=()=>{
          finished++;
          if(finished<portfolioCount||resolved)return;
          resolved=true;
          clearTimeout(hardTimeout);
          workers.forEach(worker=>worker.terminate());
          if(best)resolve(best);
          else reject(new Error(`모든 최적화 탐색이 실패했습니다. (${failed}/${portfolioCount})`));
        };

        for(let index=0;index<portfolioCount;index++){
          const worker=new Worker('./planner-cpsat-worker.js',{type:'module'});
          workers.push(worker);
          worker.onmessage=({data})=>{
            if(data.progress){
              phase=portfolioCount===1?data.progress:`탐색 ${index+1}/${portfolioCount} · ${data.progress}`;
              updateStatus();
              return;
            }
            if(data.plan&&betterPlan(data.plan,best))best=data.plan;
            if(data.plan?.status==='OPTIMAL'&&!resolved){
              resolved=true;
              clearTimeout(hardTimeout);
              workers.forEach(other=>{if(other!==worker)other.terminate();});
              resolve(data.plan);
              return;
            }
            if(data.error)failed++;
            finishOne();
          };
          worker.onerror=()=>{failed++;finishOne();};
          const input=JSON.parse(snapshot);
          input.__solverSeed=index+1;
          // 60 seconds is a wall-clock budget for the whole calculation, including
          // WASM/module startup. Never give each worker a fresh 60-second budget.
          input.__solverMaxSeconds=Math.max(1,Math.floor((deadline-Date.now())/1000));
          input.__levelAttackPower=window.LEVEL_ATTACK_POWER||{};
          worker.postMessage(input);
        }
      });

      if(snapshot!==JSON.stringify({...state,plan:null}))throw new Error('계산 중 입력이 변경됐습니다. 현재 입력으로 다시 계산해 주세요.');
      if(!plan?.attacks?.length){
        const d=plan?.diagnostics||{};
        throw new Error(`배치 가능한 공격이 0개입니다. 활성 유저 ${d.activeUsers??0}명 · 공격 후보 ${d.candidates??0}개`);
      }
      state.plan=plan;
      renderSchedule();
      renderProof(plan);
      renderLive();
      const proof=plan.status==='OPTIMAL'?'실전 최선해 · 최적성 증명':'실전 최선해';
      const o=plan.summary.optimization||{};
      localSave(`${proof} · 도달 ${o.stage||'-'} / 목표딜 ${o.target||'-'} / 낭비 ${o.waste||'-'} · ${plan.attacks.length}개 공격 · ${plan.summary.reachedFinal?'최종보스 딜':`R${plan.summary.reachedRound} 유효 딜`} ${displayNumber(plan.summary.targetDamage)} · 계획 낭비 ${displayNumber(plan.summary.planningWaste||0)} · 실제 오버딜 ${displayNumber(plan.summary.totalOverkill)}`);
    }catch(error){
      $('planner-status').textContent=`계산 실패: ${error.message}`;
    }finally{
      clearInterval(ticker);
      workers.forEach(worker=>worker.terminate());
      buttons.forEach(button=>{
        button.disabled=false;
        button.classList.remove('is-calculating');
        button.textContent=button.dataset.label;
      });
    }
  }

  calculateButton.addEventListener('click',calculateDeep);
  recalculateButton.addEventListener('click',calculateDeep);
  if(state?.plan)renderProof(state.plan);
})();
