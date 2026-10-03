/* Regression tests for the simulation, run headless:  node test/sim.test.js
 *
 * These cover the arithmetic that breaks silently - prices, refunds, supply,
 * doctrine multipliers, the replay header. Every case here is a bug that was
 * actually shipped at some point, so each one is a tripwire rather than a
 * theory. Nothing in here draws or needs a browser. */
'use strict';
const { loadGame } = require('./harness.js');

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (e) {
    fail++;
    failures.push({ name, message: e.message });
    console.log('  FAIL ' + name + '\n         ' + e.message);
  }
}
function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error((what || 'value') + ': expected ' + JSON.stringify(expected) +
                    ', got ' + JSON.stringify(actual));
  }
}
function near(actual, expected, tol, what) {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error((what || 'value') + ': expected ' + expected + ' +/-' + tol +
                    ', got ' + actual);
  }
}
function ok(cond, what) {
  if (!cond) throw new Error(what || 'expected a truthy value');
}

console.log('loading the game headless...');
const g = loadGame();
const run = g.run;
const TILE_SIZE_GUESS = run('TILE');
console.log('loaded.\n');

/* Helpers that drive the game the way the UI would. */
function setFactions(f) { run('FACOF=["' + f + '","' + f + '","' + f + '","' + f + '"]'); }
function newMatch(opts) {
  const o = opts || {};
  run('scaleKey=' + JSON.stringify(o.scale || 'standard'));
  run('modeKey=' + JSON.stringify(o.mode || 'duel'));
  run('terrainKey=' + JSON.stringify(o.terrain || 'open'));
  run('facKey=' + JSON.stringify(o.fac || 'concord'));
  run('startGame(' + JSON.stringify(o.diff || 'veteran') + ')');
  if (o.fac) setFactions(o.fac);
}

console.log('prices and refunds');

test('a unit costs the doctrine price, a structure costs list', () => {
  setFactions('pact');
  const u = run('priceOf("unit","warden",0)');
  const b = run('priceOf("building","habitat",0)');
  eq(u.m, Math.round(run('UDEF.warden.m') * run('FACTIONS.pact.cost')), 'pact warden');
  eq(b.m, run('BDEF.habitat.m'), 'pact habitat is list price');
  setFactions('concord');
  eq(run('priceOf("unit","warden",0)').m, run('UDEF.warden.m'), 'concord warden');
});

test('queueing and cancelling a unit is money-neutral for every doctrine', () => {
  for (const f of ['concord', 'legion', 'pact']) {
    newMatch({ fac: f });
    run('P[0].m=4000; P[0].g=2000');
    const before = run('P[0].m');
    run([
      'var _hall=ents.find(e=>!e.dead&&e.kind==="building"&&e.owner===0&&BDEF[e.type].trains&&',
      '  e.type!=="keystone");',
      'if(!_hall){ _hall=mkBuilding("musterhall",0,BASES[0].tx*TILE+180,BASES[0].ty*TILE,true); }',
      'for(var i=0;i<30;i++){ tryTrain(_hall,"warden"); cancelQueue(_hall,_hall.queue.length-1); }'
    ].join('\n'));
    eq(run('P[0].m') - before, 0, f + ': 30 queue/cancel cycles net aurite');
    eq(run('P[0].g') - 2000, 0, f + ': 30 queue/cancel cycles net ichor');
  }
});

test('cancelling a half-built structure refunds three quarters of its own price', () => {
  newMatch({ fac: 'pact' });
  const back = run('refundOf("building","musterhall",0,.75)');
  const list = run('priceOf("building","musterhall",0)');
  eq(back.m, Math.floor(list.m * 0.75), 'structure refund');
});

test('the salvage bounty is paid off the price the owner actually paid', () => {
  newMatch({ fac: 'concord' });
  setFactions('pact');
  // a Pact warden cost 40, so a 20% bounty is 8 - not 10 off the list price
  const bounty = run('refundOf("unit","warden",0,.2)');
  eq(bounty.m, Math.floor(run('priceOf("unit","warden",0)').m * 0.2), 'unit bounty');
  ok(bounty.m < Math.floor(run('UDEF.warden.m') * 0.2) ||
     run('FACTIONS.pact.cost') === 1, 'pact bounty is below the list-price bounty');
});

test('every unit and structure has a price that round-trips through refundOf', () => {
  for (const f of ['concord', 'legion', 'pact']) {
    setFactions(f);
    for (const t of run('Object.keys(UDEF)')) {
      const p = run('priceOf("unit",' + JSON.stringify(t) + ',0)');
      const r = run('refundOf("unit",' + JSON.stringify(t) + ',0,1)');
      eq(r.m, p.m, f + ' ' + t + ' full refund matches price');
      eq(r.g, p.g, f + ' ' + t + ' full refund matches ichor price');
    }
    for (const t of run('Object.keys(BDEF)')) {
      const p = run('priceOf("building",' + JSON.stringify(t) + ',0)');
      const r = run('refundOf("building",' + JSON.stringify(t) + ',0,1)');
      eq(r.m, p.m, f + ' ' + t + ' full refund matches price');
    }
  }
  setFactions('concord');
});

console.log('\npopulation');

test('population has no ceiling - housing is the only limit', () => {
  newMatch({ scale: 'standard' });
  eq(run('popCeiling()'), Infinity, 'standard has no ceiling');
  newMatch({ scale: 'grand' });
  eq(run('popCeiling()'), Infinity, 'grand war has no ceiling');
  // and the cap really is just what has been built
  const cap = run('P[0].cap');
  run('mkBuilding("habitat",0,BASES[0].tx*TILE+200,BASES[0].ty*TILE+200,true); recalcSupply(0)');
  eq(run('P[0].cap'), cap + run('supplyOf("habitat",0)'), 'a new habitat raises the cap');
});

test('housing is worth more in Grand War', () => {
  newMatch({ scale: 'standard', fac: 'concord' });
  const sHab = run('supplyOf("habitat",0)'), sKey = run('supplyOf("keystone",0)');
  newMatch({ scale: 'grand', fac: 'concord' });
  const gHab = run('supplyOf("habitat",0)'), gKey = run('supplyOf("keystone",0)');
  ok(gHab > sHab, 'a Grand War habitat beats a standard one (' + gHab + ' vs ' + sHab + ')');
  ok(gKey > sKey, 'a Grand War keystone beats a standard one');
  eq(gHab, Math.round(sHab * 2.5), 'habitat scales 2.5x');
});

test('the Legion supply bonus stacks on top of the scale', () => {
  newMatch({ scale: 'standard', fac: 'legion' });
  const lHab = run('supplyOf("habitat",0)');
  setFactions('concord');
  const cHab = run('supplyOf("habitat",0)');
  eq(lHab - cHab, run('FACTIONS.legion.supplyBonus'), 'legion bonus per structure');
});

test('a bot keeps building housing right up to the Grand War ceiling', () => {
  /* The regression: the bot economy compared its cap against a hardcoded 190,
     so in Grand War a bot stopped building housing at under half the ceiling.
     Read the whole script back and make sure that comparison is gone. */
  const whole = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'stellar-command.html'), 'utf8');
  ok(!/P\[ME\]\.cap\s*<\s*190/.test(whole), 'no hardcoded 190 supply ceiling in the bot economy');
  ok(/popCeiling\(\)/.test(whole), 'the bot economy uses popCeiling()');
});

console.log('\ndoctrines');

test('the Legion hits harder the more hurt it is', () => {
  newMatch({ fac: 'legion' });
  run('var _u=mkUnit("warden",0,BASES[0].tx*TILE+120,BASES[0].ty*TILE+120)');
  run('_u.hp=_u.maxHp');
  const full = run('dmgOf(_u)');
  run('_u.hp=_u.maxHp*.1');
  const hurt = run('dmgOf(_u)');
  ok(hurt > full * 1.2, 'a wounded Legion unit hits harder (' + full + ' -> ' + hurt + ')');
});

test('the Concord gets no wounded-damage ramp', () => {
  newMatch({ fac: 'concord' });
  run('var _u=mkUnit("warden",0,BASES[0].tx*TILE+120,BASES[0].ty*TILE+120)');
  run('_u.hp=_u.maxHp');
  const full = run('dmgOf(_u)');
  run('_u.hp=_u.maxHp*.1');
  eq(run('dmgOf(_u)'), full, 'concord damage is flat');
});

test('the Legion cannot repair and the Concord can', () => {
  newMatch({ fac: 'legion' });
  eq(run('facOf(0).noRepair'), true, 'legion cannot repair');
  setFactions('concord');
  ok(!run('facOf(0).noRepair'), 'concord can repair');
});

test('each doctrine keeps its own names, prices and look', () => {
  const seen = {};
  for (const f of ['concord', 'legion', 'pact']) {
    setFactions(f);
    seen[f] = {
      warden: run('nameOf("warden",0)'),
      keystone: run('nameOf("keystone",0)'),
      accent: run('facAcc(0)')
    };
  }
  ok(seen.concord.warden !== seen.legion.warden &&
     seen.legion.warden !== seen.pact.warden, 'unit names differ');
  ok(seen.concord.keystone !== seen.legion.keystone &&
     seen.legion.keystone !== seen.pact.keystone, 'structure names differ');
  ok(seen.concord.accent !== seen.legion.accent &&
     seen.legion.accent !== seen.pact.accent &&
     seen.concord.accent !== seen.pact.accent, 'accent colours differ');
  setFactions('concord');
});

console.log('\nreplays');

test('the replay header stores the seed the match started from', () => {
  newMatch({ fac: 'concord' });
  const seed0 = run('SEED0');
  // every srand() moves the generator on, so the live state is not the seed
  run('for(var i=0;i<500;i++) rnd(0,1)');
  const live = run('SEED');
  ok(seed0 !== live, 'the generator has moved on from the starting seed');
  const src = run('String(replaySave)');
  ok(/seed:\s*SEED0/.test(src),
     'replaySave writes SEED0, not the live SEED that every srand() has advanced');
});

test('the replay header records the map size that was actually played', () => {
  ok(!/scale:\s*scaleKey/.test(run('String(replaySave)')),
     'replaySave no longer trusts the local menu scaleKey');
  ok(/scale:\s*GRAND/.test(run('String(replaySave)')),
     'replaySave derives the scale from the live GRAND flag');
});

test('the replay header records which doctrines were on the field', () => {
  ok(/facof/.test(run('String(replaySave)')), 'replaySave stores facof');
});

console.log('\nbot movement');

test('bots order their armies as a spread formation, not onto one tile', () => {
  const src = run('String(aiMoveGroup)');
  ok(/formation\(/.test(src), 'aiMoveGroup goes through formation()');
  ok(/aiOrder/.test(src), 'aiMoveGroup tags the order so paths are not wiped each tick');
});

test('re-issuing the same group order is a no-op', () => {
  newMatch({ mode: 'ffa', fac: 'concord' });
  run([
    'var _army=[];',
    'for(var i=0;i<8;i++) _army.push(mkUnit("warden",1,BASES[1].tx*TILE+i*30,BASES[1].ty*TILE));',
    'aiMoveGroup(_army,900,900);',
    'var _first=_army.map(u=>({x:u.cmd.x,y:u.cmd.y,tag:u.aiOrder}));',
    'aiMoveGroup(_army,900,900);',
    'var _second=_army.map(u=>({x:u.cmd.x,y:u.cmd.y,tag:u.aiOrder}));'
  ].join('\n'));
  const a = run('JSON.stringify(_first)'), b = run('JSON.stringify(_second)');
  eq(b, a, 'the second identical order changed nothing');
  const spread = run('(function(){var xs=_army.map(u=>u.cmd.x);' +
                     'return Math.max.apply(null,xs)-Math.min.apply(null,xs);})()');
  ok(spread > 0, 'the eight units were given different destinations (spread ' + spread + 'px)');
});

console.log('\nharvesting');

test('a dozen idle Delvers spread over the patches instead of one crystal', () => {
  newMatch({ fac: 'concord' });
  run([
    'var _k=ents.find(e=>!e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone");',
    'var _ws=[];',
    'for(var i=0;i<12;i++){ var w=mkUnit("delver",0,_k.x+40+i*8,_k.y+70); w.cmd={t:"idle"}; _ws.push(w); }',
    'for(var i=0;i<_ws.length;i++){ var n=findMineralNear(_ws[i],_ws[i]); if(n) setGather(_ws[i],n); }',
    'var _nodes={};',
    'for(var i=0;i<_ws.length;i++){ var c=_ws[i].cmd;',
    '  if(c.t==="gather"&&c.node) _nodes[c.node.id]=(_nodes[c.node.id]||0)+1; }'
  ].join('\n'));
  const spread = JSON.parse(run('JSON.stringify(_nodes)'));
  const counts = Object.keys(spread).map(k => spread[k]);
  const patches = counts.length;
  const worst = Math.max.apply(null, counts);
  ok(patches >= 4, '12 Delvers went to at least 4 patches (went to ' + patches + ')');
  ok(worst <= run('NODE_SLOTS'),
     'no patch holds more than its slots (worst was ' + worst + ' on one patch)');
});

test('a group ordered onto one crystal fans out over the patches beside it', () => {
  newMatch({ fac: 'concord' });
  run([
    'var _k=ents.find(e=>!e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone");',
    'var _target=nearest(ents,_k.x,_k.y,e=>e.kind==="res"&&e.type==="aurite"&&e.amount>0);',
    'var _ws=[];',
    'for(var i=0;i<10;i++){ var w=mkUnit("delver",0,_k.x+40+i*8,_k.y+70); w.cmd={t:"idle"}; _ws.push(w); }',
    'setSel(_ws);',
    'touchOrder(_target.x,_target.y);',
    'var _spread={};',
    'for(var i=0;i<_ws.length;i++){ var c=_ws[i].cmd;',
    '  if(c.t==="gather"&&c.node) _spread[c.node.id]=(_spread[c.node.id]||0)+1; }'
  ].join('\n'));
  const spread = JSON.parse(run('JSON.stringify(_spread)'));
  const counts = Object.keys(spread).map(k => spread[k]);
  ok(counts.length >= 3,
     'the order fanned out over at least 3 patches (hit ' + counts.length + ')');
  ok(Math.max.apply(null, counts) <= run('NODE_SLOTS'),
     'no patch was overloaded by the group order');
});

test('a patch reports full once its slots are taken', () => {
  newMatch({ fac: 'concord' });
  run([
    'var _k=ents.find(e=>!e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone");',
    // a patch the starting Delvers are not already working
    'var _n=nearest(ents,_k.x,_k.y,e=>e.kind==="res"&&e.type==="aurite"&&e.amount>0&&nodeLoad(e)===0);',
    'var _a=mkUnit("delver",0,_k.x+30,_k.y+30), _b=mkUnit("delver",0,_k.x+50,_k.y+30);',
    'setGather(_a,_n); setGather(_b,_n);'
  ].join('\n'));
  eq(run('nodeLoad(_n)'), 2, 'two on the patch');
  eq(run('nodeFull(_n)'), true, 'the patch is full');
  eq(run('nodeLoad(_n,_a)'), 1, 'the asker is not counted against itself');
  eq(run('nodeFull(_n,_a)'), false, 'the one already there may stay');
});


console.log('\nplacement');

test('a taken destination falls back to the nearest tile, not up-and-left', () => {
  newMatch({ fac: 'concord' });
  /* The ring scan used to return the first free tile in scan order, and that
     scan runs dx=-r..r then dy=-r..r - so the first hit on each ring is its
     top-left corner and every fallback drifted up and to the left. */
  const drift = run([
    '(function(){',
    '  var tx=40, ty=40, px=tx*TILE+TILE/2, py=ty*TILE+TILE/2;',
    '  var taken=new Set(); taken.add(ti(tx,ty));',
    '  var u=mkUnit("warden",0,px,py);',
    '  var p=slotFor(u,px,py,taken);',
    '  return {dx:p.x-px, dy:p.y-py};',
    '})()'
  ].join('\n'));
  const off = Math.hypot(drift.dx, drift.dy);
  ok(off <= TILE_SIZE_GUESS * 1.5,
     'the fallback slot is adjacent to the point asked for (moved ' +
     Math.round(off) + 'px, offset ' + JSON.stringify(drift) + ')');
});

test('the ring picks whichever free tile is closest, from any direction', () => {
  newMatch({ fac: 'concord' });
  /* Block everything on the ring except one tile to the right. A scan-order
     pick would still answer with the top-left corner. */
  const picked = run([
    '(function(){',
    '  var tx=40, ty=40, px=tx*TILE+TILE/2, py=ty*TILE+TILE/2;',
    '  var taken=new Set();',
    '  for(var dx=-1;dx<=1;dx++) for(var dy=-1;dy<=1;dy++)',
    '    if(!(dx===1&&dy===0)) taken.add(ti(tx+dx,ty+dy));',
    '  var u=mkUnit("warden",0,px,py);',
    '  var p=slotFor(u,px,py,taken);',
    '  return {dx:Math.round((p.x-px)/TILE), dy:Math.round((p.y-py)/TILE)};',
    '})()'
  ].join('\n'));
  eq(picked.dx, 1, 'took the one free tile to the right');
  eq(picked.dy, 0, 'and did not drift upward');
});


console.log('\ndoctrine-aware bots');

test('each doctrine has its own idea of when to commit', () => {
  const doc = JSON.parse(run('JSON.stringify(AIDOC)'));
  ok(doc.legion.push < doc.concord.push,
     'the Legion commits with a smaller army than the Concord');
  ok(doc.legion.bail < doc.concord.bail,
     'the Legion will lose more of a squad before calling off an attack');
  eq(doc.legion.repair, false, 'the Legion does not try to repair');
  ok(doc.pact.homely > 0, 'the Pact prefers to fight on its own ground');
});

test('a Legion bot never pulls a Delver onto a repair it cannot perform', () => {
  /* The Legion cannot repair, so a repair order is pure lost mining time. */
  run('scaleKey="standard"; modeKey="ffa"; terrainKey="open"; facKey="concord"');
  run('startGame("warlord")');
  run('FACOF=["concord","legion","legion","legion"]');
  for (let i = 0; i < 600; i++) run('simTick(0.1)');
  run('var _k=ents.find(e=>!e.dead&&e.kind==="building"&&e.owner===1&&e.type==="keystone")');
  run('_k.hp=_k.maxHp*0.45; _k.hurtAt=gameTime');
  run('mkUnit("warden",0,_k.x+150,_k.y+150)');
  let peak = 0;
  for (let i = 0; i < 300; i++) {
    run('simTick(0.1)');
    const n = run('ents.filter(u=>!u.dead&&u.kind==="unit"&&u.owner===1&&u.cmd&&u.cmd.t==="repair").length');
    if (n > peak) peak = n;
  }
  eq(peak, 0, 'no Legion Delver was sent to repair');
});

test('a Concord bot does send Delvers to mend a damaged hall', () => {
  run('scaleKey="standard"; modeKey="ffa"; terrainKey="open"; facKey="concord"');
  run('startGame("warlord")');
  run('FACOF=["legion","concord","concord","concord"]');
  for (let i = 0; i < 600; i++) run('simTick(0.1)');
  run('var _k=ents.find(e=>!e.dead&&e.kind==="building"&&e.owner===1&&e.type==="keystone")');
  run('_k.hp=_k.maxHp*0.45; _k.hurtAt=gameTime');
  run('mkUnit("warden",0,_k.x+150,_k.y+150)');
  let peak = 0;
  for (let i = 0; i < 300; i++) {
    run('simTick(0.1)');
    const n = run('ents.filter(u=>!u.dead&&u.kind==="unit"&&u.owner===1&&u.cmd&&u.cmd.t==="repair").length');
    if (n > peak) peak = n;
  }
  ok(peak > 0, 'the Concord bot put at least one Delver on the repair');
});

console.log('\nfog of war');

test('a patch outside your vision is drawn as you last saw it', () => {
  newMatch({ fac: 'concord' });
  run('updateFog()');
  // a patch nobody can see: remembered amount is whatever it was when last seen
  run([
    'var _far=null;',
    'for(var i=0;i<ents.length;i++){ var e=ents[i];',
    '  if(e.kind!=="res"||e.type!=="aurite") continue;',
    '  var tx=clamp((e.x/TILE)|0,0,MAP_W-1), ty=clamp((e.y/TILE)|0,0,MAP_H-1);',
    '  if(visible[ti(tx,ty)]!==1){ _far=e; break; } }'
  ].join('\n'));
  ok(run('!!_far'), 'found a patch outside vision');
  const before = run('resShown(_far).amount');
  // mine it right out from under the fog
  run('_far.amount=Math.max(0,_far.amount-200)');
  eq(run('resShown(_far).amount'), before,
     'what is shown did not change while it was out of sight');
  // once it is in vision the real state comes through
  run('var _tx=clamp((_far.x/TILE)|0,0,MAP_W-1), _ty=clamp((_far.y/TILE)|0,0,MAP_H-1)');
  run('visible[ti(_tx,_ty)]=1; rememberRes()');
  eq(run('resShown(_far).amount'), run('_far.amount'),
     'in vision it shows the live amount');
});


console.log('\nteams');

test('a team arrangement with everyone on one side is rejected', () => {
  eq(run('teamsValid([0,0,0,0],"team")'), false, 'all on side A');
  eq(run('teamsValid([1,1,1,1],"team")'), false, 'all on side B');
  eq(run('teamsValid([0,1,0,1],"team")'), true, 'the default pairing');
  eq(run('teamsValid([0,0,1,1],"team")'), true, 'a rearranged 2v2');
  eq(run('teamsValid([0,0,0,0],"ffa")'), true, 'free-for-all ignores sides');
  // a duel only seats two, so seats 3 and 4 must not rescue a one-sided pair
  eq(run('teamsValid([0,0,1,1],"duel")'), false, 'duel judged on its two seats');
});

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ': ' + pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('\nfailures:');
  for (const f of failures) console.log('  - ' + f.name + ': ' + f.message);
}
process.exit(fail ? 1 : 0);
