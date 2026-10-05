/* Pick the click rates from data instead of guessing.
   9999 is effectively "no limit", i.e. how the bot behaved before the budget
   existed, so it gives the baseline each setting should be measured against. */
const { loadGame } = require('./harness.js');

function kill(diff, apm, burst, seed) {
  const g = loadGame();
  g.run('scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord"');
  g.run('startGame("' + diff + '"); setSeed(' + seed + '); init(); BOTS=[false,true,false,false]');
  g.run('DIFF.apm=' + apm + '; DIFF.burst=' + burst);
  for (let i = 0; i < 9000; i++) {
    g.run('simTick(0.1)');
    if (g.run('over')) return Math.round(g.run('gameTime'));
  }
  return null;
}

const diff = process.argv[2] || 'veteran';
const seeds = [4242, 99];
const rates = (process.argv[3] || '9999,140,90,60,40,25').split(',').map(Number);
console.log(diff.toUpperCase() + '   (seconds to finish an idle player; null = never)');
for (const apm of rates) {
  const burst = apm >= 9999 ? 99 : (apm >= 100 ? 5 : apm >= 50 ? 4 : 3);
  const ts = seeds.map(s => kill(diff, apm, burst, s));
  const good = ts.filter(t => t !== null);
  const avg = good.length ? Math.round(good.reduce((a, b) => a + b, 0) / good.length) : null;
  console.log('  apm ' + String(apm).padStart(5) + '  burst ' + String(burst).padStart(2) +
    '   ' + ts.map(t => t === null ? 'never' : t + 's').join(', ').padEnd(16) +
    (avg === null ? '' : '  avg ' + avg + 's'));
}
