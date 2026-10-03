/* Is one starting position better than the other?  node test/seatbias.js [n]
 *
 * The doctrine tournament showed seat 1 winning far more often than seat 0,
 * which could be the armies or could be the map. This removes the armies from
 * the question: both seats play the SAME army, so anything left is the
 * starting position, the order the bots are updated in, or the map generator.
 * Each match uses a fresh seed, so map noise averages out. */
'use strict';
const { loadGame } = require('./harness.js');

const PER_ARMY = parseInt(process.argv[2] || '8', 10);
const DT = 0.05;
const CAP_SECONDS = 900;

function mirror(army) {
  const g = loadGame(), run = g.run;
  run('scaleKey="standard"; modeKey="duel"; terrainKey="open"');
  run('facKey="' + army + '"');
  run('startGame("veteran")');
  run('FACOF=["' + army + '","' + army + '","concord","concord"]');
  run('clearDefs()');
  run('init()');
  run('BOTS=[true,true,false,false]');

  let t = 0, winner = null, reason = 'cap';
  while (t < CAP_SECONDS) {
    run('over=false');
    run('simTick(' + DT + ')');
    t += DT;
    if (Math.abs(t % 5) < DT) {
      const alive = run('aliveTeams()');
      if (alive.length <= 1) {
        winner = alive.length === 1 ? (alive[0] === run('TEAMOF[0]') ? 0 : 1) : null;
        reason = 'eliminated';
        break;
      }
    }
  }
  if (winner === null) {
    const score = run('(function(){var s=[0,0];' +
      'for(var i=0;i<ents.length;i++){var e=ents[i];' +
      'if(e.dead||e.owner>1) continue;' +
      'var d=(e.kind==="building"?BDEF:UDEF)[e.type]; if(!d) continue;' +
      'var v=(d.m||0)+(d.g||0)*1.5;' +
      's[e.owner]+=v*(e.hp/Math.max(1,e.maxHp));}' +
      'return s;})()');
    const margin = Math.abs(score[0] - score[1]) / Math.max(1, score[0] + score[1]);
    if (margin < 0.12) reason = 'draw on points';
    else { winner = score[0] > score[1] ? 0 : 1; reason = 'ahead on points'; }
  }
  return { winner, reason, seconds: Math.round(t) };
}

const ARMIES = ['concord', 'legion', 'pact'];
const tally = {};
let s0 = 0, s1 = 0, draws = 0;

console.log('mirror matches: the same army in both seats, ' + PER_ARMY + ' per army\n');
for (const a of ARMIES) {
  let w0 = 0, w1 = 0, d = 0;
  for (let i = 0; i < PER_ARMY; i++) {
    const r = mirror(a);
    if (r.winner === 0) { w0++; s0++; }
    else if (r.winner === 1) { w1++; s1++; }
    else { d++; draws++; }
    console.log('  ' + a.padEnd(9) + 'seat ' +
      (r.winner === null ? '-' : r.winner) + ' won   ' +
      r.reason.padEnd(17) + r.seconds + 's');
  }
  tally[a] = [w0, w1, d];
}

console.log('\nby army (seat 0 / seat 1 / draw)');
for (const a of ARMIES) console.log('  ' + a.padEnd(9) + tally[a].join(' / '));
const decided = s0 + s1;
console.log('\noverall: seat 0 won ' + s0 + ', seat 1 won ' + s1 + ', ' + draws + ' draws');
if (decided) {
  console.log('  seat 1 took ' + Math.round(100 * s1 / decided) + '% of decided matches');
  console.log('  (50% means the positions are even; a fair map should land near it)');
}
