window.addEventListener('load', async () => {
  const checks = [];
  const check = (name, pass) => { checks.push({name, pass}); if (!pass) throw new Error(name); };
  try {
    check('16 commanders and 240 records', people.length === 16 && document.querySelectorAll('.damage-line').length === 240);
    check('15 official portraits', document.querySelectorAll('#lineups img').length === 15);
    check('All teams split into 5 known characters', people.every(p => p.stages.every(s => s.squads.every(t => splitTeam(t.team)?.length === 5))));
    check('Unknown teams preserve raw text', renderTeam('알수없는니케').includes('알수없는니케'));
    const images = [...document.querySelectorAll('#lineups img')];
    await Promise.all(images.map(img => { img.loading = 'eager'; return img.decode(); }));
    check('All 15 local images decoded', images.every(img => img.naturalWidth > 0));
    showDetail(people.findIndex(p => p.name === '미레온'));
    check('Detail has 75 portraits', document.querySelectorAll('#detail-body img').length === 75);
    check('Missing character marked in 5 stages', document.querySelectorAll('.character.missing').length === 5);
    $('detail').close();
    document.querySelector('[data-stage="2"]').click();
    check('Stage filtering', document.querySelectorAll('.damage-line').length === 48);
    $('search').value = '셀레스'; $('search').dispatchEvent(new Event('input'));
    check('Name filtering', document.querySelectorAll('[data-person]').length === 1);
    $('search').value = ''; $('sort').value = 'level'; $('sort').dispatchEvent(new Event('change'));
    check('Level sorting', document.querySelector('.commander').textContent.includes('달빛'));
    $('sort').value = 'original'; document.querySelector('[data-stage="all"]').click();
  } catch (error) { checks.push({error:error.message, pass:false}); }
  const output = document.createElement('pre'); output.id = 'verification'; output.textContent = JSON.stringify(checks); document.body.append(output);
});
