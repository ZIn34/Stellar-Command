/* Does the handicap follow the map position or the seat number?
 *   node test/seatswap.js
 *
 * Seat 0 banks money it never spends and gets overrun. Either its corner of
 * the map is the problem, or being owner 0 is. Swapping the two starting
 * positions separates those: if the loser is still seat 0 after the swap, it
 * is the owner index; if the loser moves with the corner, it is the map. */
'use strict';
const { loadScore = null } = {};
const { loadGame } = require('./harness.js');

function play(swap, seed) {
  const g = loadGame(), run = g.run;
  run('scaleKey="standard"; modeKey="duel"; terrainKey="open"');
  run('facKey="legion"');
  run('startGame("veteran")');
  run('FACOF=["legion","legion","concord","concord"]');
  run('clearDefs()');
  if (swap) run('var _b=BASES[0]; BASES[0]=BASES[1]; BASES[1]=_b;');
  run('setSeed(' + seed + '); init()');
  run('BOTS=[true,true,false,false]');
  // play to 200s, which is before the fight decides it, and read the economy
  let t = 0;
  while (t < 200) { run('over=false'); run('simTick(0.05)'); t += 0.05; }
  const out = [];
  for (const o of [0, 1]) {
    out.push(run('(function(){var o=' + o + ',b=0;' +
      'for(var i=0;i<ents.length;i++){var e=ents[i];' +
      ' if(!e.dead&&e.owner===o&&e.kind==="building"&&e.done) b++; }' +
      'return {bld:b, bank:Math.round(P[o].m), cap:P[o].cap,' +
      ' corner:(function(){for(var i=0;i<ents.length;i++){var e=ents[i];' +
      '  if(!e.dead&&e.owner===o&&e.type==="keystone")' +
      '   return (e.x<WW/2?"left":"right")+"-"+(e.y<WH/2?"top":"bottom");}' +
      '  return "none";})()};})()'));
  }
  return out;
}

const SEEDS = [12345, 777, 20260101, 4242];
for (const swap of [false, true]) {
  console.log((swap ? 'POSITIONS SWAPPED' : 'NORMAL') + '  (state at 200s)');
  for (const sd of SEEDS) {
    const r = play(swap, sd);
    const line = r.map((s, o) => 'seat ' + o + ' @' + s.corner.padEnd(13) +
      ' bld ' + String(s.bld).padStart(2) + '  banked ' + String(s.bank).padStart(5) +
      '  cap ' + String(s.cap).padStart(3)).join('   |   ');
    console.log('  seed ' + String(sd).padStart(9) + '  ' + line);
  }
  console.log('');
}
console.log('A bot that is working spends its money: high bank with few buildings');
console.log('is the stall. Watch which SEAT shows it, and which CORNER.');
