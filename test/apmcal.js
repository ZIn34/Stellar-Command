/* Calibrating the bot's attention budget.

   Two complaints to satisfy at once: a bot used to put up everything at once
   like a professional, and the first fix made it sluggish. So the thing to
   measure is not throughput alone but both numbers together:

     built/army at 180s  - is it keeping up? (compare against no limit)
     peak sites + peak queues in one frame - is it acting like a person?

   apm 9999 / burst 99 is how it behaved before any of this, the baseline.  */
const { loadGame } = require('./harness.js');

function probe(diff, apm, burst, seed) {
  const g = loadGame();
  g.run('scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord"');
  g.run('startGame("' + diff + '"); setSeed(' + seed + '); init(); BOTS=[false,true,false,false]');
  g.run('DIFF.apm=' + apm + '; DIFF.burst=' + burst);
  let peakSites = 0, peakQ = 0;
  for (let i = 0; i < 1800; i++) {          // 180 seconds
    g.run('simTick(0.1)');
    if (i % 5 === 0) {
      const sq = g.run('[bldOf(1).filter(b=>!b.done).length,' +
                       'bldOf(1).reduce((n,b)=>n+((b.queue&&b.queue.length)||0),0)]');
      if (sq[0] > peakSites) peakSites = sq[0];
      if (sq[1] > peakQ) peakQ = sq[1];
    }
    if (g.run('over')) break;
  }
  return {
    built: g.run('bldOf(1).filter(b=>b.done).length'),
    army: g.run('unitsOf(1).filter(u=>!UDEF[u.type].worker).length'),
    workers: g.run('unitsOf(1).filter(u=>UDEF[u.type].worker).length'),
    peakSites, peakQ,
    unspent: Math.round(g.run('P[1].m'))
  };
}

const SEEDS = [4242, 99, 7];
const diff = process.argv[2] || 'veteran';
const cases = (process.argv[3] || '9999:99,160:4,110:3,70:2,45:2')
  .split(',').map(c => c.split(':').map(Number));

console.log('\n' + diff.toUpperCase() + '  at 180s, averaged over ' + SEEDS.length + ' maps');
console.log('  rate        built  army  workers  peak sites  peak queued  unspent');
for (const [apm, burst] of cases) {
  const acc = { built: 0, army: 0, workers: 0, peakSites: 0, peakQ: 0, unspent: 0 };
  for (const s of SEEDS) {
    const r = probe(diff, apm, burst, s);
    for (const k of Object.keys(acc)) acc[k] += r[k] / SEEDS.length;
  }
  const tag = apm >= 9999 ? 'no limit ' : ('apm ' + apm + '/b' + burst).padEnd(10);
  console.log('  ' + tag +
    '  ' + acc.built.toFixed(1).padStart(5) +
    ' ' + acc.army.toFixed(1).padStart(5) +
    '    ' + acc.workers.toFixed(1).padStart(5) +
    '       ' + acc.peakSites.toFixed(1).padStart(4) +
    '        ' + acc.peakQ.toFixed(1).padStart(5) +
    '      ' + Math.round(acc.unspent));
}
