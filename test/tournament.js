/* Doctrine tournament, run headless:  node test/tournament.js [matchesPerPair]
 *
 * The balance between the three armies has only ever been reasoned from the
 * stat tables. This plays them against each other instead: bot versus bot,
 * every ordered pair, and reports win rates plus how each match was decided.
 *
 * Ordered pairs matter because the two base positions are not identical and
 * seat 0 gets the first map slot, so A-vs-B and B-vs-A are both played and
 * the side bias shows up in the output as its own number. */
'use strict';
const { loadGame } = require('./harness.js');

const ARMIES = ['concord', 'legion', 'pact'];
const PER_PAIR = parseInt(process.argv[2] || '6', 10);
const DT = 0.05;
const CAP_SECONDS = 900;          // 15 minutes of game time
const SCALE = process.env.SCALE || 'standard';
const DIFF = process.env.DIFF || 'veteran';

function playOne(seatArmies, seed) {
  const g = loadGame(), run = g.run;
  run('scaleKey="' + SCALE + '"; modeKey="duel"; terrainKey="open"');
  run('facKey="' + seatArmies[0] + '"');
  run('startGame("' + DIFF + '")');
  /* startGame picks the armies for seats 1-3 at random and then builds the
     world, so the starting workers are spawned with whatever army it chose -
     their maxHp is baked in at spawn. Setting the armies and rebuilding means
     every unit on the field belongs to the army being tested. */
  run('FACOF=["' + seatArmies[0] + '","' + seatArmies[1] + '","concord","concord"]');
  run('clearDefs()');
  run('init()');
  run('BOTS=[true,true,false,false]');
  const seated = run('[FACOF[0],FACOF[1]]');
  if (seated[0] !== seatArmies[0] || seated[1] !== seatArmies[1]) {
    throw new Error('seats did not take: ' + JSON.stringify(seated));
  }

  let t = 0, winner = null, reason = 'cap';
  while (t < CAP_SECONDS) {
    run('over=false');              // endGame() latches this; we judge the end ourselves
    run('simTick(' + DT + ')');
    t += DT;
    if (Math.abs(t % 5) < DT) {     // checking every tick is wasted work
      const alive = run('aliveTeams()');
      if (alive.length <= 1) {
        winner = alive.length === 1 ? (alive[0] === run('TEAMOF[0]') ? 0 : 1) : null;
        reason = 'eliminated';
        break;
      }
    }
  }
  if (winner === null) {
    // nobody was wiped out in the time limit: decide on what is left standing
    const score = run('(function(){var s=[0,0];' +
      'for(var i=0;i<ents.length;i++){var e=ents[i];' +
      'if(e.dead||e.owner>1) continue;' +
      'var d=(e.kind==="building"?BDEF:UDEF)[e.type]; if(!d) continue;' +
      'var v=(d.m||0)+(d.g||0)*1.5;' +
      's[e.owner]+=v*(e.hp/Math.max(1,e.maxHp));}' +
      'return s;})()');
    const margin = Math.abs(score[0] - score[1]) / Math.max(1, score[0] + score[1]);
    if (margin < 0.12) { reason = 'draw on points'; }
    else { winner = score[0] > score[1] ? 0 : 1; reason = 'ahead on points'; }
  }
  return { winner, reason, seconds: Math.round(t) };
}

const wins = {}, played = {}, bySeat = [0, 0];
const reasons = {};
for (const a of ARMIES) { wins[a] = 0; played[a] = 0; }

const pairs = [];
for (const a of ARMIES) for (const b of ARMIES) if (a !== b) pairs.push([a, b]);

console.log('scale ' + SCALE + ', difficulty ' + DIFF + ', ' + PER_PAIR +
            ' matches per ordered pair, ' + (pairs.length * PER_PAIR) + ' total');
console.log('cap ' + CAP_SECONDS + 's of game time per match\n');

const head = [];
let n = 0;
for (const [a, b] of pairs) {
  for (let i = 0; i < PER_PAIR; i++) {
    const t0 = Date.now();
    const r = playOne([a, b], n);
    n++;
    played[a]++; played[b]++;
    if (r.winner === 0) { wins[a]++; bySeat[0]++; }
    else if (r.winner === 1) { wins[b]++; bySeat[1]++; }
    reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    const who = r.winner === null ? 'draw' : (r.winner === 0 ? a : b);
    const line = '  ' + (a + ' vs ' + b).padEnd(20) + who.padEnd(9) +
                 r.reason.padEnd(17) + r.seconds + 's game, ' +
                 ((Date.now() - t0) / 1000).toFixed(1) + 's real';
    console.log(line);
    head.push(line);
  }
}

console.log('\nwin rate');
for (const a of ARMIES) {
  const pct = played[a] ? Math.round(100 * wins[a] / played[a]) : 0;
  const bar = '#'.repeat(Math.round(pct / 3));
  console.log('  ' + a.padEnd(9) + String(wins[a] + '/' + played[a]).padEnd(8) +
              String(pct + '%').padEnd(6) + bar);
}
console.log('\nhow matches ended');
for (const k in reasons) console.log('  ' + k.padEnd(18) + reasons[k]);
console.log('\nseat bias (does going first matter?)');
console.log('  seat 0 won ' + bySeat[0] + ', seat 1 won ' + bySeat[1]);
