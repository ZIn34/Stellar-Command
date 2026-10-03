/* What does the second player actually see?   node test/guestview.js
 *
 * Two separate game instances: one plays host and produces a real snapshot,
 * the other is a guest in slot 1 and consumes it. Then we ask the guest's own
 * code the three questions the bug report raises - can it find its workers,
 * does its fog light up, and can it see the enemy. */
'use strict';
const { loadGame } = require('./harness.js');

// ---- host side: a real world, with both sides in contact ----------------
const H = loadGame(), hrun = H.run;
hrun('scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord"');
hrun('NET.role="host"; NET.slot=0; NET.humans=2; NET.teams=[0,1,0,1]; NET.facs=null; NET.terrain="open"');
hrun('startOnline(12345,false,"duel","standard")');
// put one of every unit type on each side, close together, away from the bases
hrun('var k=ents.find(function(e){return !e.dead&&e.kind==="building"&&e.owner===1&&e.type==="keystone";})');
hrun('Object.keys(UDEF).forEach(function(t,i){ mkUnit(t,1,k.x-300+i*44,k.y-260); })');
hrun('Object.keys(UDEF).forEach(function(t,i){ mkUnit(t,0,k.x-300+i*44,k.y-200); })');
const snap = hrun('(function(){var grab=null,old=netRelay;' +
  'netRelay=function(o){ if(o&&o.k==="S") grab=o; };' +
  'try{ netSnapshot(); } finally { netRelay=old; }' +
  'return grab;})()');
console.log('host sent ' + snap.e.length + ' entities');

// ---- guest side: slot 1, world arrives only through the snapshot --------
const G = loadGame(), grun = G.run;
grun('scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="legion"');
grun('NET.role="guest"; NET.slot=1; NET.humans=2; NET.teams=[0,1,0,1]; NET.facs=null; NET.terrain="open"');
grun('startOnline(12345,false,"duel","standard")');
console.log('guest NET.slot ' + grun('NET.slot') +
            '  TEAMOF ' + JSON.stringify(grun('TEAMOF')) +
            '  NPLAY ' + grun('NPLAY'));

G.__snap = snap;   // loadGame returns the sandbox, so this is a global in there
grun('netApplySnapshot(__snap)');

const q = expr => grun('(function(){' + expr + '})()');

console.log('\nwhat arrived');
console.log('  entities: ' + q('return ents.filter(function(e){return !e.dead;}).length'));
console.log('  owners seen: ' + JSON.stringify(q(
  'var s={}; ents.forEach(function(e){ if(!e.dead) s[e.owner]=(s[e.owner]||0)+1; }); return s;')));
const badType = q('return ents.filter(function(e){return !e.dead&&e.kind==="unit"&&' +
  '(!e.type||!UDEF[e.type]||UDEF[e.type].sight===undefined);})' +
  '.map(function(e){return String(e.type);});');
console.log('  units whose type does not resolve: ' + (badType.length ? JSON.stringify(badType) : 'none'));
const badB = q('return ents.filter(function(e){return !e.dead&&e.kind==="building"&&' +
  '(!e.type||!BDEF[e.type]);}).map(function(e){return String(e.type);});');
console.log('  buildings whose type does not resolve: ' + (badB.length ? JSON.stringify(badB) : 'none'));

console.log('\ncan the guest find its own workers?');
console.log('  its units (local owner 0): ' + q(
  'return ents.filter(function(e){return !e.dead&&e.kind==="unit"&&e.owner===0;}).length'));
console.log('  of those, workers: ' + q(
  'return ents.filter(function(e){return !e.dead&&e.kind==="unit"&&e.owner===0&&' +
  'UDEF[e.type]&&UDEF[e.type].worker;}).length'));
console.log('  idleWorkers(): ' + q('return idleWorkers().length'));

console.log('\ndoes its fog light up?');
grun('updateFog()');
console.log('  visible tiles: ' + q('var n=0; for(var i=0;i<visible.length;i++) if(visible[i]) n++; return n;'));
console.log('  explored tiles: ' + q('var n=0; for(var i=0;i<explored.length;i++) if(explored[i]) n++; return n;'));

console.log('\ncan it see the enemy?');
console.log('  enemy entities present: ' + q(
  'return ents.filter(function(e){return !e.dead&&e.owner===1;}).length'));
console.log('  of those, seen(): ' + q(
  'return ents.filter(function(e){return !e.dead&&e.owner===1&&seen(e);}).length'));
console.log('  would be drawn: ' + q(
  'return ents.filter(function(e){return !e.dead&&e.kind!=="res"&&(isAlly(e.owner)||seen(e));}).length'));
console.log('  isAlly(0)=' + q('return isAlly(0)') + '  isAlly(1)=' + q('return isAlly(1)'));
