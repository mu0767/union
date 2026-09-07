window.addEventListener('load', () => {
  const checks=[]; const check=(name,value)=>checks.push({name,pass:Boolean(value)});
  try {
    check('16 users seeded',state.users.length===16);
    check('15 parties per seeded user',state.users.every(u=>u.parties.length===15));
    check('5 unique Nikkes per party',state.users.every(u=>u.parties.every(p=>p.nikkes.length===5&&new Set(p.nikkes).size===5)));
    check('16 bosses',state.bosses.length===16);
    check('Round 4 infinite wind boss',state.bosses.at(-1).round===4&&state.bosses.at(-1).element==='풍압'&&state.bosses.at(-1).hp==='infinite');
    check('Member editor rendered',document.querySelectorAll('#party-body tr').length===15);
    check('Settings boss editor rendered',document.querySelectorAll('#planner-boss-body tr').length===16);
    check('Live user options rendered',document.querySelectorAll('#result-form [name=user] option').length===16);
    check('Electric and wind seed mapping',state.users[0].parties[9].element==='전격'&&state.users[0].parties[12].element==='풍압');
  } catch(error) { checks.push({name:error.message,pass:false}); }
  const output=document.createElement('pre');output.id='planner-test';output.textContent=JSON.stringify(checks);document.body.append(output);
});
