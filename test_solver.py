from solver import solve, InputError

elements=['철갑','수냉','작열','풍압','전격']
bosses=[]
for round_no in (1,2,3):
    for element in elements: bosses.append({'id':f'r{round_no}-{element}','round':round_no,'name':f'{round_no}-{element}','element':element,'hp':100})
bosses.append({'id':'final','round':4,'name':'최종','element':'풍압','hp':'infinite'})
users=[]
for element in elements:
    parties=[]
    for n in range(3): parties.append({'id':f'{element}-{n}','name':f'{element}{n}','element':element,'nikkes':[f'{element}-{n}-{i}' for i in range(5)],'normalDamage':100,'finalDamage':120})
    users.append({'id':element,'name':element,'active':True,'attacksLeft':3,'availability':[{'start':'05:00','end':'05:00'}],'parties':parties})
users.append({'id':'finisher','name':'마무리','active':True,'attacksLeft':1,'availability':[{'start':'05:00','end':'05:00'}],'parties':[{'id':'fin','name':'최종파티','element':'풍압','nikkes':[f'f{i}' for i in range(5)],'normalDamage':90,'finalDamage':500}]})
state={'settings':{'startAt':'2026-09-06T05:00','endAt':'2026-09-07T05:00','now':'2026-09-06T05:00','attackMinutes':10,'simultaneous':False,'finalElement':'풍압'},'users':users,'bosses':bosses,'results':[],'locks':[]}
plan=solve(state,8)
assert plan['summary']['reachedFinal'] is True
assert plan['summary']['finalDamage']==500
assert plan['summary']['attackCount']==16
assert all(a['element']==next(b['element'] for b in bosses if b['id']==a['bossId']) for a in plan['attacks'])
for user in users:
    attacks=[a for a in plan['attacks'] if a['userId']==user['id']]
    used=[n for a in attacks for n in a['nikkes']]
    assert len(attacks)<=user['attacksLeft'] and len(used)==len(set(used))
state['locks']=[{'id':'l1','userId':'철갑','partyId':'철갑-0','bossId':'r1-철갑'}]
locked=solve(state,8)
assert any(a['userId']=='철갑' and a['partyId']=='철갑-0' and a['bossId']=='r1-철갑' for a in locked['attacks'])
print('solver checks passed:',plan['status'],len(plan['attacks']))
