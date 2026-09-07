from __future__ import annotations
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any
from ortools.sat.python import cp_model

ELEMENTS = {"철갑", "수냉", "작열", "풍압", "전격"}

class InputError(Exception):
    pass

def dt(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except Exception as exc:
        raise InputError("레이드 날짜와 현재 시각을 입력해 주세요.") from exc

def availability_intervals(settings: dict, windows: list[dict], duration: int) -> list[tuple[int,int]]:
    start, end, now = dt(settings["startAt"]), dt(settings["endAt"]), dt(settings["now"])
    origin = start
    lower = max(0, int((now-origin).total_seconds()//60))
    upper = int((end-origin).total_seconds()//60)-duration
    intervals=[]
    day=(start.replace(hour=5,minute=0,second=0,microsecond=0)-timedelta(days=1))
    while day <= end:
        for w in windows:
            try:
                sh,sm=map(int,w["start"].split(':')); eh,em=map(int,w["end"].split(':'))
            except Exception as exc: raise InputError("플레이 가능 시간 형식을 확인해 주세요.") from exc
            ws=day+timedelta(hours=(sh-5)%24,minutes=sm)
            we=day+timedelta(hours=(eh-5)%24,minutes=em)
            if we<=ws: we+=timedelta(days=1)
            a=max(lower,int((ws-origin).total_seconds()//60)); b=min(upper,int((we-origin).total_seconds()//60)-duration)
            if a<=b: intervals.append((a,b))
        day+=timedelta(days=1)
    return sorted(set(intervals))

def solve(state: dict[str,Any], limit_seconds: float = 25.0) -> dict[str,Any]:
    settings=state.get("settings",{})
    duration=int(settings.get("attackMinutes") or 0)
    if duration<=0: raise InputError("공격 1회 소요 시간을 입력해 주세요.")
    if not isinstance(settings.get("simultaneous"),bool): raise InputError("동시 공격 가능 여부를 선택해 주세요.")
    users={u["id"]:u for u in state.get("users",[]) if u.get("active")}
    if len(users)>32: raise InputError("참가자는 최대 32명입니다.")
    bosses={b["id"]:b for b in state.get("bosses",[])}
    normal=[b for b in bosses.values() if b.get("round") in (1,2,3)]
    if len(normal)!=15 or any(b.get("element") not in ELEMENTS or not isinstance(b.get("hp"),int) or b["hp"]<=0 for b in normal): raise InputError("Round 1~3에 속성별 보스 15명과 HP가 필요합니다.")
    for round_no in (1,2,3):
        if {b["element"] for b in normal if b["round"]==round_no} != ELEMENTS: raise InputError(f"Round {round_no}에는 5개 속성 보스가 하나씩 필요합니다.")
    finals=[b for b in bosses.values() if b.get("round")==4]
    if len(finals)!=1: raise InputError("최종보스가 한 명 필요합니다.")
    final=finals[0]
    results=state.get("results",[]); locks=state.get("locks",[])
    used=defaultdict(set); result_count=defaultdict(int); actual_damage=defaultdict(int)
    party_lookup={}
    for uid,u in users.items():
        if not 0<=int(u.get("attacksLeft",0))<=3: raise InputError(f"{u.get('name')}: 남은 공격권은 0~3이어야 합니다.")
        per_element=defaultdict(int)
        parties_by_element=defaultdict(list)
        for party in u.get("parties",[]): parties_by_element[party.get("element")].append(party)
        selected_parties=[]
        for element,group in parties_by_element.items():
            selected_parties.extend(sorted(group,key=lambda party:int(party.get("normalDamage",0)),reverse=True)[:2])
        for p in selected_parties:
            if len(p.get("nikkes",[]))!=5 or len(set(p["nikkes"]))!=5: raise InputError(f"{u.get('name')} / {p.get('name')}: 서로 다른 니케 5명이 필요합니다.")
            if p.get("element") not in ELEMENTS: raise InputError(f"{p.get('name')}: 속성이 올바르지 않습니다.")
            per_element[p["element"]]+=1; party_lookup[(uid,p["id"])]=p
    for r in results:
        if r.get("userId") not in users: continue
        p=party_lookup.get((r["userId"],r.get("partyId"))); b=bosses.get(r.get("bossId")); nikkes=r.get("nikkes") or (p and p.get("nikkes")); element=r.get("element") or (p and p.get("element"))
        if not b or not nikkes: raise InputError("완료 공격에 삭제된 보스가 있거나 니케 기록이 없습니다.")
        if element!=b["element"]: raise InputError(f"완료 공격의 속성이 맞지 않습니다: {users[r['userId']]['name']}")
        used[r["userId"]].update(nikkes); result_count[r["userId"]]+=1; actual_damage[b["id"]]+=int(r.get("damage",0))
    model=cp_model.CpModel(); horizon=max(1,int((dt(settings["endAt"])-dt(settings["startAt"])).total_seconds()//60))
    candidates=[]; by_user=defaultdict(list); by_nikke=defaultdict(list); by_boss=defaultdict(list); intervals_by_user=defaultdict(list); global_intervals=[]
    for uid,u in users.items():
        domains=availability_intervals(settings,[{"start":"05:00","end":"05:00"}],duration)
        if not domains: continue
        domain=cp_model.Domain.FromIntervals(domains)
        candidate_groups=defaultdict(list)
        for party in u.get("parties",[]): candidate_groups[party.get("element")].append(party)
        candidate_parties=[]
        for group in candidate_groups.values(): candidate_parties.extend(sorted(group,key=lambda party:int(party.get("normalDamage",0)),reverse=True)[:2])
        for p in candidate_parties:
            if used[uid].intersection(p["nikkes"]): continue
            for b in bosses.values():
                if p["element"]!=b["element"]: continue
                key=f"{uid}_{p['id']}_{b['id']}"; x=model.NewBoolVar('x_'+key); start=model.NewIntVarFromDomain(domain,'s_'+key); end=model.NewIntVar(0,horizon,'e_'+key)
                model.Add(end==start+duration).OnlyEnforceIf(x)
                interval=model.NewOptionalIntervalVar(start,duration,end,x,'i_'+key)
                final_damage=p.get("finalDamage")
                damage=int(p.get("normalDamage",0) if final_damage is None else final_damage) if b["round"]==4 else int(p.get("normalDamage",0))
                c={"x":x,"start":start,"end":end,"user":u,"party":p,"boss":b,"damage":damage};candidates.append(c);by_user[uid].append(c);by_boss[b["id"]].append(c);intervals_by_user[uid].append(interval);global_intervals.append(interval)
                for n in p["nikkes"]: by_nikke[(uid,n)].append(c)
    for uid,u in users.items(): model.Add(sum(c["x"] for c in by_user[uid]) <= int(u.get("attacksLeft",0)))
    for cs in by_nikke.values(): model.Add(sum(c["x"] for c in cs)<=1)
    for ints in intervals_by_user.values(): model.AddNoOverlap(ints)
    if not settings["simultaneous"]: model.AddNoOverlap(global_intervals)
    clear={}; total={}; effective={}; overkill={}; clear_time={}
    max_damage=sum(max(0,c["damage"]) for c in candidates)+sum(actual_damage.values())
    for b in normal:
        bid=b["id"]; hp=int(b["hp"]); total[bid]=model.NewIntVar(0,max(hp,max_damage),'total_'+bid);model.Add(total[bid]==actual_damage[bid]+sum(c["damage"]*c["x"] for c in by_boss[bid]))
        effective[bid]=model.NewIntVar(0,hp,'effective_'+bid);model.AddMinEquality(effective[bid],[total[bid],hp])
        clear[bid]=model.NewBoolVar('clear_'+bid);model.Add(total[bid]>=hp).OnlyEnforceIf(clear[bid]);model.Add(total[bid]<=hp-1).OnlyEnforceIf(clear[bid].Not())
        overkill[bid]=model.NewIntVar(0,max_damage,'over_'+bid);model.Add(overkill[bid]==total[bid]-effective[bid])
        clear_time[bid]=model.NewIntVar(0,horizon,'ct_'+bid)
        for c in by_boss[bid]: model.Add(clear_time[bid]>=c["end"]).OnlyEnforceIf(c["x"])
    for round_no in (2,3,4):
        previous=[b for b in normal if b["round"]==round_no-1]
        for c in [x for x in candidates if x["boss"]["round"]==round_no]:
            for b in previous:
                model.Add(c["x"]<=clear[b["id"]]);model.Add(c["start"]>=clear_time[b["id"]]).OnlyEnforceIf(c["x"])
    candidate_index={(c["user"]["id"],c["party"]["id"],c["boss"]["id"]):c for c in candidates}
    lock_seen=defaultdict(list)
    lock_keys=set()
    for lock in locks:
        key=(lock.get("userId"),lock.get("partyId"),lock.get("bossId"));c=candidate_index.get(key)
        if key in lock_keys: raise InputError("같은 공격이 두 번 잠겨 있습니다.")
        lock_keys.add(key)
        if not c: raise InputError("잠긴 공격이 불가능합니다. 유저 가능 시간, 사용 니케, 속성 또는 남은 공격권을 확인해 주세요.")
        if c["boss"]["round"]<4 and actual_damage[c["boss"]["id"]]>=c["boss"]["hp"]: raise InputError(f"이미 클리어된 보스에는 공격을 잠글 수 없습니다: {c['boss']['name']}")
        model.Add(c["x"]==1);lock_seen[lock["userId"]].append(c)
    for uid,cs in lock_seen.items():
        if len(cs)>int(users[uid].get("attacksLeft",0)): raise InputError(f"{users[uid]['name']}: 남은 공격권보다 잠긴 공격이 많습니다.")
        seen=set()
        for c in cs:
            overlap=seen.intersection(c["party"]["nikkes"])
            if overlap: raise InputError(f"{users[uid]['name']}: 잠긴 공격의 니케가 중복됩니다 ({', '.join(overlap)}).")
            seen.update(c["party"]["nikkes"])
    validation=model.Validate()
    if validation: raise InputError(f"계산 모델 오류: {validation}")
    solver=cp_model.CpSolver();solver.parameters.max_time_in_seconds=limit_seconds;solver.parameters.num_search_workers=1
    opened=[]
    for round_no in (1,2,3):
        previous=[clear[b["id"]] for b in normal if b["round"]==round_no]
        flag=model.NewBoolVar(f"round_{round_no+1}_open")
        for value in previous:model.Add(flag<=value)
        model.Add(flag>=sum(previous)-len(previous)+1)
        opened.append(flag)
    stage_score=sum(opened);model.Maximize(stage_score);status=solver.Solve(model)
    if status not in (cp_model.OPTIMAL,cp_model.FEASIBLE): raise InputError(f"현재 제약조건으로 실행 가능한 계획이 없습니다. 잠금과 가능 시간을 확인해 주세요. ({solver.StatusName(status)})")
    best_stage=round(solver.ObjectiveValue());model.Add(stage_score==best_stage)
    if best_stage==3:
        final_damage=sum(c["damage"]*c["x"] for c in by_boss[final["id"]]);model.Maximize(final_damage)
    else:
        last_round=best_stage+1;model.Maximize(sum(effective[b["id"]] for b in normal if b["round"]==last_round))
    status=solver.Solve(model);best_secondary=round(solver.ObjectiveValue())
    if best_stage==3:model.Add(final_damage==best_secondary)
    else:model.Add(sum(effective[b["id"]] for b in normal if b["round"]==last_round)==best_secondary)
    model.Minimize(sum(overkill.values()));status=solver.Solve(model);best_over=round(solver.ObjectiveValue());model.Add(sum(overkill.values())==best_over)
    scheduled_starts=[]
    for index,c in enumerate(candidates):
        value=model.NewIntVar(0,horizon,f"scheduled_start_{index}")
        model.AddMultiplicationEquality(value,[c["start"],c["x"]])
        windows=availability_intervals(settings,[{"start":"05:00","end":"05:00"}],duration)
        urgency=max(1,horizon-max(end for _,end in windows)+1)
        scheduled_starts.append(value*urgency)
    model.Minimize(sum(scheduled_starts));status=solver.Solve(model)
    selected=[c for c in candidates if solver.Value(c["x"])]
    selected.sort(key=lambda c:(solver.Value(c["start"]),c["boss"]["round"],c["boss"]["name"]))
    remaining={b["id"]:("infinite" if b["round"]==4 else max(0,int(b["hp"])-actual_damage[b["id"]])) for b in bosses.values()};attack_no=defaultdict(lambda:result_count.copy())
    output=[];origin=dt(settings["startAt"]);now=dt(settings["now"])
    user_attack_no=defaultdict(int)
    for c in selected:
        b=c["boss"];before=remaining[b["id"]];damage=c["damage"]
        if before=="infinite":after="infinite";over=0
        else:after=max(0,before-damage);over=max(0,damage-before);remaining[b["id"]]=after
        user_attack_no[c["user"]["id"]]+=1;start_time=origin+timedelta(minutes=solver.Value(c["start"]));
        output.append({"start":start_time.isoformat(timespec='minutes'),"timeLabel":start_time.strftime('%m/%d %H:%M'),"isNow":start_time<=now+timedelta(minutes=duration),"userId":c["user"]["id"],"userName":c["user"]["name"],"partyId":c["party"]["id"],"partyName":c["party"]["name"],"nikkes":c["party"]["nikkes"],"bossId":b["id"],"bossName":b["name"],"bossNameSort":b["name"],"round":b["round"],"element":b["element"],"damage":damage,"beforeHp":before,"afterHp":after,"overkill":over,"attackNumber":result_count[c["user"]["id"]]+user_attack_no[c["user"]["id"]]})
    final_total=sum(a["damage"] for a in output if a["round"]==4)
    return {"status":"OPTIMAL" if status==cp_model.OPTIMAL else "FEASIBLE","summary":{"reachedFinal":best_stage==3,"reachedRound":4 if best_stage==3 else best_stage+1,"attackCount":len(output),"totalOverkill":sum(a["overkill"] for a in output),"finalDamage":final_total},"attacks":output}
