/* Where does seat 0 fall behind?  node test/seatdiag.js
 *
 * Mirror matches showed seat 1 taking 94% of decided games with the same army
 * on both sides, so something other than the armies is deciding them. This
 * plays one mirror match and samples both sides side by side, so the point
 * where they diverge is visible: economy, expansion, army, or the fight. */
'use strict';
const { loadGame } = require('./harness.js');

const g = loadGame(), run = g.run;
const ARMY = process.argv[2] || 'legion';
const SEED = process.argv[3] || '12345';

run('scaleKey="standard"; modeKey="duel"; terrainKey="open"');
run('facKey="' + ARMY + '"');
run('startGame("veteran")');
run('FACOF=["' + ARMY + '","' + ARMY + '","concord","concord"]');
run('clearDefs()');
run('setSeed(' + SEED + '); init()');
run('BOTS=[true,true,false,false]');

function snap(o) {
  return run('(function(){var o=' + o + ';' +
    'var w=0,a=0,b=0,hall=0,expo=0,ref=0;' +
    'for(var i=0;i<ents.length;i++){var e=ents[i];' +
    ' if(e.dead||e.owner!==o) continue;' +
    ' if(e.kind==="unit"){ if(UDEF[e.type].worker) w++; else a++; }' +
    ' else if(e.kind==="building"&&e.done){ b++;' +
    '   if(e.type==="keystone") hall++;' +
    '   if(e.type==="musterhall") expo++;' +
    '   if(e.type==="siphon") ref++; } }' +
    'return {w:w,army:a,bld:b,halls:hall,barracks:expo,ref:ref,' +
    ' m:Math.round(P[o].m),cap:P[o].cap,' +
    ' t:Math.round((AIS[o]||{}).t||0),mode:(AIS[o]||{}).mode||"-",' +
    ' expos:(AIS[o]||{}).expo||0};})()');
}

console.log(ARMY + ' vs itself, seed ' + SEED + '\n');
console.log('  time | seat |  wk army bld halls brk ref | supply cap |  AI.t mode    expos');
const MARKS = [30, 60, 120, 180, 240, 300, 420, 540, 660, 780, 900];
let t = 0, mi = 0;
while (t < 900 && mi < MARKS.length) {
  run('over=false'); run('simTick(0.05)'); t += 0.05;
  if (t >= MARKS[mi]) {
    for (const o of [0, 1]) {
      const s = snap(o);
      console.log('  ' + String(Math.round(t)).padStart(4) + ' |   ' + o + '  | ' +
        String(s.w).padStart(3) + String(s.army).padStart(5) + String(s.bld).padStart(4) +
        String(s.halls).padStart(6) + String(s.barracks).padStart(4) + String(s.ref).padStart(4) +
        ' | ' + String(s.m).padStart(6) + String(s.cap).padStart(5) +
        ' | ' + String(s.t).padStart(5) + ' ' + String(s.mode).padEnd(8) + s.expos);
    }
    const alive = run('aliveTeams()');
    if (alive.length <= 1) { console.log('\n  over at ' + Math.round(t) + 's, teams left: ' + JSON.stringify(alive)); break; }
    mi++;
  }
}
