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
  setFactions('concord');
});

test('your colour is yours, whatever doctrine you run', () => {
  /* The accent used to be pulled toward the doctrine, which made two players
     running the same legion indistinguishable and your own army hard to pick
     out. Ownership owns that channel now. */
  newMatch({ mode: 'ffa' });
  for (const f of ['concord', 'legion', 'pact']) {
    setFactions(f);
    eq(run('facAcc(0)'), run('TEAM[0].c'), f + ': slot 0 wears its own colour');
    eq(run('facAcc(1)'), run('TEAM[1].c'), f + ': slot 1 wears its own colour');
    ok(run('facAcc(0)') !== run('facAcc(1)'),
       f + ': two players on the same doctrine are still told apart');
  }
  // and the doctrine is still visible, just not in the ownership channel
  const hulls = {};
  for (const f of ['concord', 'legion', 'pact']) {
    setFactions(f);
    hulls[f] = JSON.stringify(run('hullSet(0)'));
  }
  ok(hulls.concord !== hulls.legion && hulls.legion !== hulls.pact,
     'the hull material still differs per doctrine');
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


console.log('\ndoctrine combat styles');

function arena(fac, foe) {
  run('scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord"');
  run('startGame("veteran")');
  run('FACOF=["' + fac + '","' + (foe || 'concord') + '","concord","concord"]');
  run('BOTS=[false,false,false,false]');
  run('P[0].m=9000; P[0].g=9000');
}
function tickOn(n, step) {
  for (let i = 0; i < n; i++) { run('over=false'); run('simTick(' + (step || 0.05) + ')'); }
}

test('the same unit has a different statline in each doctrine', () => {
  const seen = {};
  for (const f of ['concord', 'legion', 'pact']) {
    run('FACOF=["' + f + '","' + f + '","' + f + '","' + f + '"]');
    const d = run('defFor("unit","warden",0)');
    seen[f] = { rng: d.rng, dmg: d.dmg };
  }
  ok(seen.legion.rng < seen.concord.rng / 2,
     'the Legion warden is a brawler (' + seen.legion.rng + ' vs ' + seen.concord.rng + ')');
  ok(seen.legion.dmg > seen.concord.dmg, 'and it hits harder for it');
  // the charge mechanic was removed; the brawler statline is what remains
  ok(!run('FSTYLE.legion.warden.charge'), 'no charge behaviour left on it');
  eq(seen.pact.rng, seen.concord.rng, 'the Pact keeps its range');
  ok(seen.pact.dmg < seen.concord.dmg, 'and trades raw damage for the wound');
  run('FACOF=["concord","concord","concord","concord"]');
});

test('a Pact wound keeps working after the attacker is gone', () => {
  arena('pact');
  run('var A=mkUnit("warden",0,1000,1000), B=mkUnit("warden",1,1060,1000)');
  tickOn(40);
  const dps = run('B.venom?B.venom.dps:0');
  const hp1 = run('B.dead?0:B.hp');
  run('if(!A.dead) A.dead=true');
  tickOn(50);
  const hp2 = run('B.dead?0:B.hp');
  ok(dps > 0, 'the hit left a wound (' + dps.toFixed(2) + '/s)');
  ok(hp2 < hp1, 'and it kept bleeding with nobody shooting (' +
     Math.round(hp1) + ' -> ' + Math.round(hp2) + ')');
});

test('a Concord unit dug in hits harder than one on the move', () => {
  arena('concord');
  run('var A=mkUnit("warden",0,1000,1000)');
  run('A.stillT=0'); const moving = run('dmgOf(A)');
  run('A.stillT=' + (run('ENTRENCH_AT') + 1)); const dug = run('dmgOf(A)');
  ok(dug > moving, 'standing still pays (' + moving.toFixed(1) + ' -> ' + dug.toFixed(1) + ')');
});

console.log('\ncapital ships');

test('every doctrine fields a different capital ship at the same flat price', () => {
  const seen = {};
  for (const f of ['concord', 'legion', 'pact']) {
    run('FACOF=["' + f + '","' + f + '","' + f + '","' + f + '"]');
    seen[f] = { name: run('nameOf("titan",0)'), yard: run('nameOf("citadel",0)'),
                cost: run('priceOf("unit","titan",0)'), def: run('defFor("unit","titan",0)') };
  }
  for (const f of ['concord', 'legion', 'pact']) {
    eq(seen[f].cost.m, 1500, f + ' titan aurite');
    eq(seen[f].cost.g, 1500, f + ' titan ichor');
    eq(seen[f].def.sup, 10, f + ' titan population');
  }
  ok(seen.concord.name !== seen.legion.name && seen.legion.name !== seen.pact.name,
     'three different ships');
  ok(seen.concord.yard !== seen.legion.yard && seen.legion.yard !== seen.pact.yard,
     'three different yards');
  eq(!!seen.concord.def.ward, false, 'ward lives on the style, not the def');
  ok(run('FSTYLE.concord.titan.ward') && run('FSTYLE.legion.titan.boom') &&
     run('FSTYLE.pact.titan.brood'), 'each has its own ability');
  eq(run('BDEF.citadel.req'), 'forgeworks', 'the yard needs a Forgeworks first');
  run('FACOF=["concord","concord","concord","concord"]');
});

test('there is no limit on how many capital ships you own', () => {
  arena('pact');
  run('var k=ents.find(e=>!e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone")');
  run('for(var i=0;i<6;i++) mkBuilding("habitat",0,k.x+320+(i%3)*90,k.y-240+((i/3)|0)*90,true)');
  run('recalcSupply(0)');
  run('var cit=mkBuilding("citadel",0,k.x+260,k.y+60,true)');
  const q = [run('tryTrain(cit,"titan")'), run('tryTrain(cit,"titan")'), run('tryTrain(cit,"titan")')];
  ok(q.every(Boolean), 'three queued back to back with no cap');
  eq(run('cit.queue.length'), 3, 'all three are in the queue');
});

test('the Aegis Bastion shields what is under it and mends what it hangs over', () => {
  arena('concord');
  run('var T=mkUnit("titan",0,1200,1200)');
  // a target tough enough to survive the hit, or both just die and prove nothing
  run('var A=mkUnit("harrower",0,1230,1210)');
  run('var B=mkUnit("harrower",0,3000,3000)');
  tickOn(4);
  const full = run('A.maxHp');
  run('damage(A,100,1); damage(B,100,1)');
  const under = full - run('A.dead?0:A.hp'), exposed = full - run('B.dead?0:B.hp');
  ok(under < exposed, 'cover reduced the hit (' + Math.round(under) + ' vs ' +
     Math.round(exposed) + ')');
  arena('concord');
  run('var T2=mkUnit("titan",0,1200,1200)');
  run('var hurt=mkBuilding("habitat",0,1300,1240,true); hurt.hp=hurt.maxHp*0.4');
  tickOn(240);
  ok(run('hurt.hp/hurt.maxHp') > 0.8, 'and it mended the structure beside it');
});

test('the Cataclysm Engine detonates when it dies', () => {
  arena('legion');
  run('var T=mkUnit("titan",0,1200,1200)');
  run('var V=mkUnit("warden",1,1260,1200)');
  /* Keep the ship from shooting the victim first - its range covers its own
     blast radius, so without this the target is already dead and the test
     proves nothing. A couple of ticks just populate the spatial grid. */
  run('T.cmd={t:"hold"}; T.target=null; T.atkCd=999; V.cmd={t:"hold"}; V.target=null; V.atkCd=999');
  tickOn(2);
  run('T.atkCd=999; V.atkCd=999; V.hp=V.maxHp');
  const before = run('V.hp');
  run('damage(T,99999,1)');
  const after = run('V.dead?0:V.hp');
  ok(before > 0, 'the victim was alive before the blast (' + Math.round(before) + ' hp)');
  ok(after < before, 'and the blast caught it (' + Math.round(before) +
     ' -> ' + Math.round(after) + ')');
});

test('the Hollow Mother births free units that cost no population', () => {
  arena('pact');
  run('var k=ents.find(e=>!e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone")');
  run('for(var i=0;i<6;i++) mkBuilding("habitat",0,k.x+320+(i%3)*90,k.y-240+((i/3)|0)*90,true)');
  run('var T=mkUnit("titan",0,1200,1200)');
  run('recalcSupply(0)');
  const pop0 = run('P[0].sup');
  tickOn(420);
  run('recalcSupply(0)');
  const brood = run('ents.filter(e=>!e.dead&&e.spawned&&e.owner===0).length');
  ok(brood > 0, 'it birthed ' + brood + ' free units');
  eq(run('P[0].sup'), pop0, 'and none of them cost population');
});

console.log('\nsiege retaliation');

test('a squad sieging a building turns on units that attack it', () => {
  arena('concord');
  run('var k=ents.find(e=>!e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone")');
  run('var me=mkUnit("warden",0,k.x+300,k.y+300)');
  run('var wall=mkBuilding("habitat",1,k.x+380,k.y+300,true)');
  run('var raider=mkUnit("warden",1,k.x+240,k.y+340)');
  run('me.cmd={t:"attack",target:wall}; me.target=wall');
  tickOn(3);
  eq(run('me.target===wall'), true, 'it starts on the building');
  run('damage(me,4,1,raider)');
  tickOn(2);
  eq(run('me.target===raider'), true, 'a raider shooting it pulls it onto the raider');
  eq(run('me.cmd.t'), 'attack', 'the order itself is untouched');
  eq(run('me.cmd.target===wall'), true, 'and still points at the building');
  run('raider.dead=true');
  tickOn(4);
  eq(run('me.target===wall'), true, 'with the raider dead the siege resumes on its own');
});

test('a focus-fire order on a unit is never stolen', () => {
  arena('concord');
  run('var A=mkUnit("warden",0,1000,1000)');
  run('var focus=mkUnit("warden",1,1100,1000)');
  run('var pest=mkUnit("warden",1,1010,1030)');
  run('A.cmd={t:"attack",target:focus}; A.target=focus');
  tickOn(2);
  run('damage(A,4,1,pest)');
  tickOn(2);
  eq(run('A.target===focus'), true, 'told to kill that one, it kills that one');
});

test('a tower shooting you does not drag you off a siege', () => {
  arena('concord');
  run('var B=mkUnit("warden",0,1000,1000)');
  run('var wall2=mkBuilding("habitat",1,1090,1000,true)');
  run('var tower=mkBuilding("watchspire",1,1300,1000,true)');
  run('B.cmd={t:"attack",target:wall2}; B.target=wall2');
  tickOn(2);
  run('damage(B,6,1,tower)');
  tickOn(2);
  eq(run('B.target===wall2'), true, 'a turret is something you walk out of, not charge');
});

test('a Delver being shot still keeps mining', () => {
  arena('concord');
  run('var W=ents.find(e=>!e.dead&&e.kind==="unit"&&e.owner===0&&UDEF[e.type].worker)');
  run('var F=mkUnit("warden",1,W.x+60,W.y)');
  run('damage(W,5,1,F)');
  eq(run('W.cmd.t'), 'gather', 'still on the aurite');
});

console.log('\ntutorial covers the capital ship');

test('the tutorial teaches the shipyard and the capital ship', () => {
  run('facKey="pact"');
  run('startTutorial()');
  const steps = run('TUT_STEPS.map(function(s){return (typeof s.b==="function")?s.b():s.b;})');
  const yard = steps.findIndex(t => /Worldheart|Citadel|Gate|Bloodforge/i.test(t));
  const ship = steps.findIndex(t => /Hollow Mother|Titan|Bastion|Cataclysm/i.test(t));
  ok(yard >= 0, 'there is a step for the shipyard');
  ok(ship > yard, 'and ordering the ship comes after building the yard');
  const last = steps.length - 1;
  ok(ship < last, 'both land before the final mission');
});

test('the shipyard step funds itself, since a training run never banks that much', () => {
  run('facKey="concord"');
  run('startTutorial()');
  const steps = run('TUT_STEPS.map(function(s){return (typeof s.b==="function")?s.b():s.b;})');
  const i = steps.findIndex(t => /Ascendant Gate/i.test(t));
  ok(i >= 0, 'found the shipyard step');
  run('P[0].m=0; P[0].g=0');
  run('TUT.i=' + i + '; TUT_STEPS[' + i + ']._entered=false; tutShow()');
  const cost = run('priceOf("unit","titan",0)');
  ok(run('P[0].m') >= cost.m, 'enough aurite to actually reach the ship');
  ok(run('P[0].g') >= cost.g, 'and enough ichor');
});

test('the shipyard step walks the same build chain as the others', () => {
  run('facKey="legion"');
  run('startTutorial()');
  const steps = run('TUT_STEPS.map(function(s){return (typeof s.b==="function")?s.b():s.b;})');
  const i = steps.findIndex(t => /Bloodforge/i.test(t));
  run('TUT.i=' + i + '; tutShow()');
  run('setSel([])');
  const a = run('(function(){var f=tutFocus(); return f&&f.ent?"rings a unit":JSON.stringify(f);})()');
  ok(/rings a unit/.test(a), 'with nothing selected it points at a Delver');
  run('var w=mineU(function(u){return UDEF[u.type].worker;})[0]; setSel([w])');
  run('cardMode="main"');
  eq(run('(tutFocus()||{}).el'), '#card .btn[data-hk="B"]', 'then the build menu');
  run('cardMode="build"');
  eq(run('(tutFocus()||{}).el'), '#card .btn[data-hk="G"]', 'then the shipyard button');
  run('placing="citadel"');
  ok(run('(function(){var f=tutFocus(); return !!(f&&f.x!==undefined);})()'),
     'then a patch of ground to put it on');
  run('placing=null; cardMode="main"');
});


console.log('\nretaliation and surrender');

test('a unit shot from outside its sight turns on whoever shot it', () => {
  arena('concord');
  run('var A=mkUnit("warden",0,1000,1000); A.cmd={t:"move",x:1000,y:2000}');
  run('var S=mkUnit("sunderer",1,1150,1000)');     // outranges a warden
  run('S.cmd={t:"attack",target:A}');
  tickOn(60);
  ok(run('A.dead?false:(A.target&&A.target.type==="sunderer")'),
     'it turned on the thing shooting it instead of walking on');
});

test('a specific attack order is not overridden by being poked', () => {
  arena('concord');
  run('var A=mkUnit("warden",0,1000,1000)');
  run('var T=mkUnit("warden",1,1100,1000)');
  run('var Q=mkUnit("warden",1,1020,1010)');
  run('A.cmd={t:"attack",target:T}; A.target=T');
  run('damage(A,5,1,Q)');
  eq(run('A.target===T'), true, 'the order you gave still stands');
});

test('a Delver that gets shot keeps mining', () => {
  arena('concord');
  run('var W=ents.find(e=>!e.dead&&e.kind==="unit"&&e.owner===0&&UDEF[e.type].worker)');
  run('var F=mkUnit("warden",1,W.x+60,W.y)');
  run('damage(W,5,1,F)');
  eq(run('W.cmd.t'), 'gather', 'it is still on the aurite');
  eq(run('!!W.target'), false, 'and it did not pick a fight');
});

test('a bot that loses its last Keystone surrenders instead of hiding', () => {
  run('scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord"');
  run('startGame("veteran")');
  run('BOTS=[false,true,false,false]');
  tickOn(40);
  run('var k=ents.find(e=>!e.dead&&e.owner===1&&e.kind==="building"&&e.type==="keystone")');
  run('mkBuilding("habitat",1,k.x+200,k.y+60,true); mkBuilding("musterhall",1,k.x-220,k.y+40,true)');
  run('mkUnit("warden",1,k.x+120,k.y+120)');
  run('k.dead=true');
  tickOn(60);
  eq(run('!!P[1].out'), false, 'it does not give up the instant the core falls');
  tickOn(220);
  eq(run('!!P[1].out'), true, 'but it concedes rather than make you sweep the map');
  eq(run('ents.filter(e=>!e.dead&&e.owner===1).length'), 0, 'and its leftovers are gone');
  eq(run('teamAlive(TEAMOF[1])'), false, 'the match counts that side as out');
});


console.log('\ncontrols');

test('Escape cancels and never pauses', () => {
  // the handler is an inline listener, so read it out of the source
  const whole = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'stellar-command.html'), 'utf8');
  const esc = whole.slice(whole.indexOf("if(k==='escape'){", whole.indexOf('addEventListener(\'keydown\'')));
  const block = esc.slice(0, esc.indexOf('\n  }') + 4);
  ok(!/togglePause/.test(block), 'Escape no longer opens the pause menu');
  ok(/setSel\(\[\]\)/.test(block), 'and it drops the selection when there is nothing to cancel');
  ok(/pauseBtn'\)\.onclick/.test(whole), 'the pause button still pauses');
});


console.log('\nscouting');

test('a bot does not feed an endless stream of scouts', () => {
  /* Losing a scout used to cost nothing: the next tick drafted a replacement,
     so a bot sent single units into your base one after another forever. */
  const res = run([
    '(function(){',
    ' scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord";',
    ' startGame("warlord"); BOTS=[false,true,false,false];',
    ' var drafted=0, prev=0;',
    ' for(var i=0;i<6000;i++){',
    '   over=false; simTick(0.1);',
    '   var a=(typeof AIS!=="undefined")?AIS[1]:null;',
    '   var cur=(a&&a.scout&&!a.scout.dead)?a.scout.id:0;',
    '   if(cur&&cur!==prev) drafted++;',
    '   prev=cur;',
    '   if(a&&a.scout) a.scout.dead=true;',      // every scout dies at once
    ' }',
    ' var a2=(typeof AIS!=="undefined")?AIS[1]:null;',
    ' return {drafted:drafted, seconds:Math.round(gameTime), lost:a2?(a2.scoutLost||0):0};',
    '})()'
  ].join('\n'));
  ok(res.drafted <= 8,
     'only ' + res.drafted + ' scouts in ' + res.seconds + 's even with every one dying');
  ok(res.lost > 0, 'it noticed it was losing them');
});

test('the scout gate stops once a bot knows where you live', () => {
  const src = run('String(aiScout)');
  ok(/if\(aiKnownBases\(AI\)\.length\) return;/.test(src),
     'knowing a base ends scouting outright, rather than only when a timer agrees');
  ok(/scoutLost/.test(src), 'and losing scouts backs it off');
});

console.log('\nclicking');

test('left-clicking a hostile with fighters selected orders the attack', () => {
  arena('concord');
  run('var k=ents.find(e=>!e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone")');
  run('var me=mkUnit("warden",0,k.x+100,k.y+100)');
  run('var foe=mkUnit("warden",1,k.x+240,k.y+60)');
  run('var foeB=mkBuilding("habitat",1,k.x+380,k.y+160,true)');
  tickOn(3);
  // the order path the click branch calls
  run('setSel([me]); me.cmd={t:"idle"}; me.target=null');
  run('rightClick(foe.x,foe.y,false)');
  eq(run('me.cmd.t'), 'attack', 'an enemy unit');
  eq(run('me.cmd.target===foe'), true, 'and the right one');
  run('me.cmd={t:"idle"}; me.target=null; setSel([me])');
  run('rightClick(foeB.x,foeB.y,false)');
  eq(run('me.cmd.t'), 'attack', 'an enemy building');
  eq(run('me.cmd.target===foeB'), true, 'and the right one');
  // and the click handler really does route hostiles through it
  const whole = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'stellar-command.html'), 'utf8');
  ok(/if\(!d\.shift&&!e\.ctrlKey&&isFoe\(e2\.owner,0\)\)/.test(whole),
     'a plain left-click on a hostile is handled');
  ok(/mine\.length\)\{[\s\S]{0,160}rightClick\(p\.x,p\.y,false\)/.test(whole),
     'and it goes through the shared order path so a guest relays it');
});

test('an enemy can still be selected to read its statline', () => {
  const whole = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'stellar-command.html'), 'utf8');
  ok(/const mine=sel\.filter\(x=>!x\.dead&&x\.kind===.unit.&&x\.owner===0&&!UDEF\[x\.type\]\.worker\)/.test(whole),
     'the attack only happens when you have your own fighters in hand');
  ok(/if\(mine\.length\)\{/.test(whole),
     'and an empty selection falls through to selecting the enemy');
});

console.log('\nsettings');

test('the mouse settings exist and are applied', () => {
  const whole = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'stellar-command.html'), 'utf8');
  ok(/id="sDragPan"/.test(whole), 'a drag-pan sensitivity slider');
  ok(/id="sZoomSpd"/.test(whole), 'a zoom speed slider');
  ok(/OPT\.dragPan\|\|1/.test(whole), 'drag pan is read when panning');
  ok(/OPT\.zoomSpd\|\|1/.test(whole), 'zoom speed is read on the wheel');
  ok(/OPT\.invZoom/.test(whole), 'and the wheel can be inverted');
});

test('hotkeys are rebindable and fall back to the defaults', () => {
  eq(run('keyFor("c_A")'), 'a', 'attack-move defaults to A');
  run('OPT.keys={"c_A":"q"}');
  eq(run('keyFor("c_A")'), 'q', 'a binding is honoured');
  eq(run('keyIs("c_A","q")'), true, 'and the handler test agrees');
  eq(run('keyIs("c_A","a")'), false, 'the old key stops working');
  eq(run('hkOf("bld","habitat","H")'), 'H', 'card labels come from the binding');
  run('OPT.keys={"b_habitat":"j"}');
  eq(run('hkOf("bld","habitat","H")'), 'J', 'and change with it');
  run('OPT.keys={}');
  eq(run('keyFor("c_A")'), 'a', 'clearing restores the default');
  ok(run('KEY_ACTS.length') >= 15, 'every action in the list is rebindable');
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
