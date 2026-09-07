import csv
from solver import solve

ELEMENTS = ['철갑', '수냉', '작열', '풍압', '전격']
HP = [[99856279200,99856279200,150841813600,150841813600,99856279200],[149784418800,149784418800,226262720400,226262720400,149784418800],[292455295750,292455295750,349230901500,349230901500,292455295750]]
users = {}
with open('union_raid.txt', encoding='utf-8-sig', newline='') as source:
    for row in csv.DictReader(source):
        user = users.setdefault(row['지휘관'], {'id':row['지휘관'], 'name':row['지휘관'], 'active':True, 'attacksLeft':3, 'availability':[{'start':'05:00','end':'05:00'}], 'parties':[]})
        user['parties'].append({'id':f"{row['지휘관']}-{row['보스']}-{row['덱']}", 'name':f"{row['보스']} 덱 {row['덱']}", 'element':row['보스'], 'nikkes':[row[f'니케{i}'] for i in range(1,6)], 'normalDamage':int(row['딜량'] or 0), 'finalDamage':None})
bosses = [{'id':f'r{round_no}-{element}', 'round':round_no, 'name':element, 'element':element, 'hp':HP[round_no-1][index]} for round_no in (1,2,3) for index,element in enumerate(ELEMENTS)]
bosses.append({'id':'final', 'round':4, 'name':'애니힐리오', 'element':'풍압', 'hp':'infinite'})
state = {'settings':{'startAt':'2026-09-06T05:00','endAt':'2026-09-07T05:00','now':'2026-09-06T05:00','attackMinutes':10,'simultaneous':True,'finalElement':'풍압'},'users':list(users.values()),'bosses':bosses,'results':[],'locks':[]}
print(len(state['users']), sum(len(user['parties']) for user in state['users']))
print(solve(state, 25)['summary'])
