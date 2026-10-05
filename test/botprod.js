/* Two things at once, because they pull against each other:

   - do bots build fighting units? (the budget meant they did not: the worker
     block runs first and always wants something, so with one shared action
     pool it spent the lot on Sappers and the production loop never got a turn)
   - do they still refrain from starting everything in the same breath?
     buildGap and siteCap are what enforce that, and they are untouched. */
const { loadGame } = require('./harness.js');

function run(diff, seconds, seed) {
  const g = loadGame();
  g.run('scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord"');
  g.run('startGame("' + diff + '"); setSeed(' + seed + '); init(); BOTS=[false,true,false,false]');
  let peakSites = 0, starts = [];
  const ticks = seconds * 10;
  let seen = g.run('bldOf(1).length');
  for (let i = 0; i < ticks; i++) {
    g.run('over=false'); g.run('simTick(0.1)');
    if (i % 5 === 0) {
      const open = g.run('bldOf(1).filter(function(b){return !b.done;}).length');
      if (open > peakSites) peakSites = open;
      const n = g.run('bldOf(1).length');
      if (n > seen) { starts.push(Math.round(i / 10)); seen = n; }
    }
  }
  const gaps = [];
  for (let i = 1; i < starts.length; i++) gaps.push(starts[i] - starts[i - 1]);
  return {
    workers: g.run('unitsOf(1).filter(function(u){return UDEF[u.type].worker;}).length'),
    army: g.run('unitsOf(1).filter(function(u){return !UDEF[u.type].worker;}).length'),
    byType: g.run('(function(){var o={};unitsOf(1).forEach(function(u){' +
      'if(!UDEF[u.type].worker)o[u.type]=(o[u.type]||0)+1;});return o;})()'),
    peakSites, cap: g.run('DIFF.sites'), gapRule: g.run('DIFF.buildGap'),
    minGap: gaps.length ? Math.min.apply(null, gaps) : null,
    starts: starts.length
  };
}

for (const d of ['recruit', 'veteran', 'warlord']) {
  const r = run(d, 240, 4242);
  console.log('\n' + d.toUpperCase());
  console.log('  workers ' + r.workers + '   fighting units ' + r.army +
              '   ' + JSON.stringify(r.byType));
  console.log('  structures started ' + r.starts +
              ', never more than ' + r.peakSites + ' at once (cap ' + r.cap + ')' +
              ', closest together ' + r.minGap + 's (rule ' + r.gapRule + 's)');
}
