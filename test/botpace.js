/* What does a bot actually have on the board, minute by minute?
   The complaint was that a Recruit still macroed like a professional: it put
   up everything at once because nothing limited how often it could act. This
   prints the build-up for each difficulty so the difference is visible rather
   than asserted. */
const { loadGame } = require('./harness.js');

function pace(diff, seconds, seed) {
  const g = loadGame();
  g.run('scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord"');
  g.run('MAPSEED=' + seed);
  g.run('startGame("' + diff + '")');
  g.run('BOTS=[true,true,false,false]');       // bot in seat 0 too, so we watch one
  const marks = {};
  const want = [60, 120, 180, 300];
  let t = 0;
  while (t < seconds) {
    g.run('over=false'); g.run('simTick(0.1)');
    t += 0.1;
    for (const w of want) {
      if (!marks[w] && t >= w) {
        marks[w] = {
          structures: g.run('bldOf(1).filter(b=>b.done).length'),
          sites: g.run('bldOf(1).filter(b=>!b.done).length'),
          army: g.run('unitsOf(1).filter(u=>!UDEF[u.type].worker).length'),
          workers: g.run('unitsOf(1).filter(u=>UDEF[u.type].worker).length'),
          banked: Math.round(g.run('P[1].m')),
          queued: g.run('bldOf(1).reduce((n,b)=>n+((b.queue&&b.queue.length)||0),0)')
        };
      }
    }
  }
  return marks;
}

const SEEDS = [11, 404, 7777];
for (const d of ['recruit', 'veteran', 'warlord']) {
  console.log('\n' + d.toUpperCase());
  const avg = {};
  for (const s of SEEDS) {
    const m = pace(d, 300, s);
    for (const k of Object.keys(m)) {
      avg[k] = avg[k] || { structures: 0, sites: 0, army: 0, workers: 0, banked: 0, queued: 0 };
      for (const f of Object.keys(m[k])) avg[k][f] += m[k][f] / SEEDS.length;
    }
  }
  for (const k of Object.keys(avg).sort((a, b) => a - b)) {
    const v = avg[k];
    console.log('  ' + String(k).padStart(4) + 's  ' +
      'built ' + v.structures.toFixed(1).padStart(5) +
      '   going up ' + v.sites.toFixed(1) +
      '   army ' + v.army.toFixed(1).padStart(5) +
      '   workers ' + v.workers.toFixed(1).padStart(5) +
      '   queued ' + v.queued.toFixed(1) +
      '   unspent ' + Math.round(v.banked));
  }
}
