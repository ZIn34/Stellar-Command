/* Is the attention budget what made bots weak?

   Decisive form: the same difficulty on the same map, once with the shipped
   budget and once with no budget at all (which is how bots behaved before it
   existed). If the unbudgeted one is materially stronger, the budget is the
   cost and the numbers need loosening - and if it is not, the weakness is
   somewhere else and I should stop blaming the budget.  */
const { loadGame } = require('./harness.js');

function snapshot(diff, apm, burst, seed, seconds) {
  const g = loadGame();
  g.run('scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord"');
  g.run('startGame("' + diff + '"); setSeed(' + seed + '); init(); BOTS=[false,true,false,false]');
  g.run('DIFF.apm=' + apm + '; DIFF.burst=' + burst);
  const ticks = seconds * 10;
  for (let i = 0; i < ticks; i++) { g.run('over=false'); g.run('simTick(0.1)'); }
  return {
    structures: g.run('bldOf(1).filter(function(b){return b.done;}).length'),
    army: g.run('unitsOf(1).filter(function(u){return !UDEF[u.type].worker;}).length'),
    workers: g.run('unitsOf(1).filter(function(u){return UDEF[u.type].worker;}).length'),
    // what the army is actually worth, not just how many bodies
    armyValue: Math.round(g.run(
      'unitsOf(1).filter(function(u){return !UDEF[u.type].worker;})' +
      '.reduce(function(n,u){return n+priceOf("unit",u.type,1).m;},0)')),
    upgrades: g.run('UP[1]?UP[1].wep+UP[1].arm:0'),
    unspent: Math.round(g.run('P[1].m')),
    killsOnMe: g.run('ents.filter(function(e){return e.dead&&e.owner===0;}).length')
  };
}

const diff = process.argv[2] || 'veteran';
const secs = +(process.argv[3] || 240);
const SEEDS = [4242, 99];
const CASES = [['shipped', null, null], ['no budget', 9999, 99]];

console.log('\n' + diff.toUpperCase() + ' at ' + secs + 's, averaged over ' + SEEDS.length + ' maps');
console.log('  case        structures  army  value  workers  upgrades  unspent');
const got = {};
for (const [label, apm, burst] of CASES) {
  const acc = {};
  for (const s of SEEDS) {
    // null means leave the shipped numbers alone
    const g0 = loadGame();
    g0.run('startGame("' + diff + '")');
    const a = apm === null ? g0.run('DIFF.apm') : apm;
    const b = burst === null ? g0.run('DIFF.burst') : burst;
    const r = snapshot(diff, a, b, s, secs);
    for (const k of Object.keys(r)) acc[k] = (acc[k] || 0) + r[k] / SEEDS.length;
  }
  got[label] = acc;
  console.log('  ' + label.padEnd(11) +
    '   ' + acc.structures.toFixed(1).padStart(5) +
    '  ' + acc.army.toFixed(1).padStart(5) +
    '  ' + Math.round(acc.armyValue).toString().padStart(5) +
    '    ' + acc.workers.toFixed(1).padStart(5) +
    '      ' + acc.upgrades.toFixed(1).padStart(4) +
    '    ' + Math.round(acc.unspent).toString().padStart(5));
}
const a = got['shipped'], b = got['no budget'];
const pct = (x, y) => y === 0 ? 'n/a' : (((x - y) / y) * 100).toFixed(0) + '%';
console.log('\n  shipped vs no budget:  army value ' + pct(a.armyValue, b.armyValue) +
  ', structures ' + pct(a.structures, b.structures) +
  ', workers ' + pct(a.workers, b.workers));
