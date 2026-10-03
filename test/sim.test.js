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

test('every doctrine can repair, and the Concord is best at it', () => {
  /* The Legion losing repair outright was a hole with nothing compensating
     it - its identity is raw strength, not a missing mechanic. */
  const rate = {};
  for (const f of ['concord', 'legion', 'pact']) {
    newMatch({ fac: f });
    ok(!run('facOf(0).noRepair'), f + ' can repair');
    run('var k=ents.find(function(e){return !e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone";})');
    run('var h=mkBuilding("habitat",0,k.x+300,k.y+300,true); h.hp=h.maxHp*0.4');
    run('var w=ents.find(function(e){return !e.dead&&e.kind==="unit"&&e.owner===0&&UDEF[e.type].worker;})');
    run('P[0].m=3000');
    run('w.cmd={t:"repair",target:h}');
    const hp0 = run('h.hp');
    tickOn(120);
    rate[f] = run('h.hp') - hp0;
    ok(rate[f] > 0, f + ' actually mended something (' + Math.round(rate[f]) + 'hp)');
  }
  ok(rate.concord > rate.legion && rate.concord > rate.pact,
     'the Concord mends fastest, which is its whole thing');
});

test('each doctrine has exactly one thing it is best at', () => {
  const F = {};
  for (const f of ['concord', 'legion', 'pact']) F[f] = run('FACTIONS.' + f);
  // Pact: numbers and money
  ok(F.pact.cost < F.concord.cost && F.pact.cost < F.legion.cost, 'the Pact fields the cheapest units');
  ok(F.pact.bt < F.concord.bt && F.pact.bt < F.legion.bt, 'and builds fastest');
  ok(F.pact.trickle > 0, 'and draws income from its structures');
  // Legion: raw strength, and no economy on top
  ok(F.legion.hp > F.concord.hp && F.legion.hp > F.pact.hp, 'the Legion has the toughest bodies');
  ok(F.legion.dmg > F.concord.dmg && F.legion.dmg > F.pact.dmg, 'and hits hardest');
  ok(!F.legion.trickle && !(F.legion.salvage > 1) && F.legion.eco <= 1,
     'and gets no economy to blur that');
  // Concord: tech and efficiency
  ok(F.concord.upgCost < 1 && F.concord.upgTime < 1, 'the Concord researches cheapest and fastest');
  ok(F.concord.upgCost < (F.legion.upgCost || 1) && F.concord.upgCost < (F.pact.upgCost || 1),
     'by a clear margin over the others');
  ok(F.concord.eco > F.legion.eco, 'and wastes the least at the mineral line');
});

test('research is worth taking now', () => {
  newMatch({ fac: 'legion' });
  run('var k=ents.find(function(e){return !e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone";})');
  run('var u=mkUnit("warden",0,k.x+300,k.y+300)');
  const d0 = run('dmgOf(u)');
  run('UP[0].wep=3');
  const d3 = run('dmgOf(u)');
  run('UP[0].wep=0');
  ok(d3 / d0 > 1.6, 'fully upgraded weapons are worth over 60% more damage (+' +
     Math.round(100 * (d3 / d0 - 1)) + '%)');
  // plating grades properly and never reaches immunity
  const took = [];
  for (const lvl of [0, 1, 2, 3]) {
    newMatch({ fac: 'concord' });
    run('var k2=ents.find(function(e){return !e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone";})');
    run('var v=mkUnit("harrower",1,k2.x+400,k2.y+300)');   // tough enough to survive the hit
    run('UP[1].arm=' + lvl);
    run('v.hp=v.maxHp');
    run('damage(v,100,0)');
    took.push(run('v.maxHp-v.hp'));
    run('UP[1].arm=0');
  }
  ok(took[0] > took[1] && took[1] > took[2] && took[2] > took[3],
     'each level of plating helps: ' + took.map(t => Math.round(t)).join(' -> '));
  ok(took[3] > 20, 'and the last level is not immunity (' + Math.round(took[3]) + ' of 100 still lands)');
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
  ok(/scale:\s*\(?GRAND/.test(run('String(replaySave)')),
     'replaySave derives the scale from the live flags');
  ok(/BLITZ/.test(run('String(replaySave)')),
     'and records a blitz match as blitz, not as standard');
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

test('a dozen idle Sappers spread over the patches instead of one crystal', () => {
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
  ok(patches >= 4, '12 Sappers went to at least 4 patches (went to ' + patches + ')');
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
    // a patch the starting Sappers are not already working
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
  eq(doc.legion.repair, true, 'the Legion patches things up now, like everyone');
  ok(doc.pact.homely > 0, 'the Pact prefers to fight on its own ground');
});

test('a Steel Legion bot sends Sappers to mend a damaged hall', () => {
  /* It used to be unable to repair at all, so the bot was told not to try.
     Now it can, and it should. */
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
  ok(peak > 0, 'a Steel Legion bot put at least one Sapper on the repair');
});

test('an Allied bot does send Sappers to mend a damaged hall', () => {
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
  ok(peak > 0, 'the Allied bot put at least one Sapper on the repair');
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
    const w = run('defFor("unit","warden",0)');
    const b = run('defFor("unit","breaker",0)');
    seen[f] = { wRng: w.rng, wDmg: w.dmg, bRng: b.rng, bDmg: b.dmg, name: run('nameOf("breaker",0)') };
  }
  // the ranged line is shared ground - the Legion is not all melee any more
  eq(seen.legion.wRng, seen.concord.wRng, 'the Legion keeps its reach');
  eq(seen.pact.wRng, seen.concord.wRng, 'and so does the Pact');
  ok(seen.legion.wDmg > seen.concord.wDmg, 'the Legion just hits harder');
  ok(seen.pact.wDmg < seen.concord.wDmg, 'the Pact trades damage for the wound');
  // close quarters is one dedicated unit that every doctrine has its own of
  for (const f of ['concord', 'legion', 'pact'])
    ok(seen[f].bRng < seen[f].wRng / 3, f + ' melee unit has almost no reach');
  ok(seen.legion.bDmg > seen.concord.bDmg, "the Legion's is the nastiest");
  ok(seen.concord.name !== seen.legion.name && seen.legion.name !== seen.pact.name,
     'three different names: ' + [seen.concord.name, seen.legion.name, seen.pact.name].join(', '));
  ok(!run('FSTYLE.legion.warden.charge'), 'no charge behaviour left on it');
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
  eq(run('BDEF.citadel.req'), 'forgeworks', 'the yard needs a Workshop first');
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

test('the land battleship shields what is under it and mends what it hangs over', () => {
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

test('the Juggernaut births free units that cost no population', () => {
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

console.log('\nfog: ichor vents');

test('an enemy draining a vent in the fog tells you nothing', () => {
  newMatch({ fac: 'concord' });
  run('updateFog()');
  run([
    'var _v=null;',
    'for(var i=0;i<ents.length;i++){ var e=ents[i];',
    ' if(e.kind!=="res"||e.type!=="vent") continue;',
    ' var tx=clamp((e.x/TILE)|0,0,MAP_W-1), ty=clamp((e.y/TILE)|0,0,MAP_H-1);',
    ' if(visible[ti(tx,ty)]!==1){ _v=e; break; } }'
  ].join('\n'));
  ok(run('!!_v'), 'found a vent outside vision');
  const shown = run('resShown(_v).amount');
  const pickable = run('entAt(_v.x,_v.y)===_v');
  // somebody builds a Refinery on it and drains it, all out of sight
  run('_v.taken=true; _v.amount=Math.max(0,_v.amount-400)');
  eq(run('resShown(_v).amount'), shown, 'the figure you are shown does not move');
  ok(run('_v.amount') < shown, 'even though it really did drain');
  eq(run('entAt(_v.x,_v.y)===_v'), pickable,
     'and it does not quietly become unclickable, which would give it away');
  // and once you look at it again, you get the truth
  run('var _tx=clamp((_v.x/TILE)|0,0,MAP_W-1), _ty=clamp((_v.y/TILE)|0,0,MAP_H-1)');
  run('visible[ti(_tx,_ty)]=1; rememberRes()');
  eq(run('resShown(_v).amount'), run('_v.amount'), 'in vision you see what is really there');
});

console.log('\ncapital ships: spread and escort');

test('the melee unit is cheap enough to open a match with', () => {
  /* It is meant to be the first thing you build, so it has to be affordable
     before anything else is standing and must not eat the tiny population you
     start with. */
  for (const f of ['concord', 'legion', 'pact']) {
    run('scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="' + f + '"');
    run('startGame("veteran")');
    const br = run('priceOf("unit","breaker",0)');
    const wd = run('priceOf("unit","warden",0)');
    const d = run('defFor("unit","breaker",0)');
    const purse = run('P[0].m');
    ok(br.m < wd.m / 2, f + ': cheaper than half a rifle squad (' + br.m + ' vs ' + wd.m + ')');
    eq(d.sup, 1, f + ': one population, like the other light units');
    ok(Math.floor(purse / br.m) >= 4,
       f + ': you can afford ' + Math.floor(purse / br.m) + ' from your opening purse');
    ok(d.bt <= 20, f + ': and it is quick to build (' + d.bt + 's)');
  }
});

test('bots field the melee unit early, off its real price', () => {
  const whole = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'stellar-command.html'), 'utf8');
  const code = whole.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/brCost=priceOf\('unit','breaker',ME\)\.m/.test(code),
     'the gate reads the price rather than a hard number');
  ok(!/P\[ME\]\.m>=200\)\?'breaker'/.test(code), 'the old flat threshold is gone');
  const res = run([
    '(function(){',
    ' scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord";',
    ' startGame("warlord"); BOTS=[false,true,false,false];',
    ' var firstAt=null;',
    ' for(var i=0;i<2500;i++){',
    '   over=false; simTick(0.1);',
    '   if(!firstAt&&ents.some(function(e){return !e.dead&&e.owner===1&&e.type==="breaker";})){',
    '     firstAt=Math.round(gameTime); break; }',
    ' }',
    ' return {firstAt:firstAt, at:Math.round(gameTime)};',
    '})()'
  ].join(String.fromCharCode(10)));
  ok(res.firstAt !== null && res.firstAt < 180,
     'a bot had one out by ' + res.firstAt + 's');
});

test('every capital ship splashes', () => {
  for (const f of ['concord', 'legion', 'pact']) {
    run('FACOF=["' + f + '","' + f + '","' + f + '","' + f + '"]');
    const sp = run('defFor("unit","titan",0).splash');
    ok(sp > 0, f + ' titan has splash (' + sp + ')');
  }
  run('FACOF=["concord","concord","concord","concord"]');
});

test('a splashing Pact ship still poisons everything it catches', () => {
  /* The splash branch never touched venomApply, so giving the Juggernaut a
     spread would have quietly cost it the thing that makes it a Pact ship. */
  arena('pact');
  run('var k=ents.find(e=>!e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone")');
  run('var T=mkUnit("titan",0,k.x+600,k.y+600)');
  run('var a=mkUnit("titan",1,k.x+740,k.y+600)');
  run('var b=mkUnit("titan",1,k.x+790,k.y+640)');
  let bleeding = 0;
  for (let i = 0; i < 120; i++) {
    run('over=false'); run('simTick(0.05)');
    const n = run('[a,b].filter(function(u){return !u.dead&&u.venom&&u.venom.until>gameTime;}).length');
    if (n > bleeding) bleeding = n;
  }
  ok(bleeding >= 2, 'both targets in one splash came away bleeding (' + bleeding + ')');
});

test('the land battleship gathers stragglers but obeys your orders', () => {
  arena('concord');
  run('var k=ents.find(e=>!e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone")');
  run('var cx=k.x+700, cy=k.y+700');
  run('var T=mkUnit("titan",0,cx,cy)');
  run('var R=FSTYLE.concord.titan.ward.range');
  run('var stray=mkUnit("warden",0,cx+R+120,cy); stray.cmd={t:"idle"}');
  run('var sent=mkUnit("warden",0,cx+R+120,cy+60); sent.cmd={t:"move",x:cx+R+900,y:cy+60}');
  run('var w=ents.find(e=>!e.dead&&e.kind==="unit"&&e.owner===0&&UDEF[e.type].worker)');
  const strayOut0 = run('Math.hypot(stray.x-cx,stray.y-cy)-R');
  const sentOut0 = run('Math.hypot(sent.x-cx,sent.y-cy)-R');
  for (let i = 0; i < 200; i++) { run('over=false'); run('simTick(0.05)'); }
  const strayOut1 = run('Math.hypot(stray.x-T.x,stray.y-T.y)-R');
  const sentOut1 = run('Math.hypot(sent.x-T.x,sent.y-T.y)-R');
  ok(strayOut1 < strayOut0, 'the straggler was drawn back under the shield (' +
     Math.round(strayOut0) + 'px out -> ' + Math.round(strayOut1) + 'px)');
  ok(strayOut1 <= 0, 'and ended up inside it');
  ok(sentOut1 > sentOut0, 'the one you sent away kept going (' +
     Math.round(sentOut0) + 'px -> ' + Math.round(sentOut1) + 'px)');
  eq(run('w.cmd.t'), 'gather', 'and the Sappers were left to work');
});

test('a unit trading blows braces against the crowd', () => {
  arena('legion');
  run('var k=ents.find(e=>!e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone")');
  run('var cx=k.x+620, cy=k.y+620');
  run('for(var i=0;i<6;i++) mkUnit("warden",0,cx-50+(i%3)*20,cy-20+((i/3)|0)*20)');
  run('for(var i=0;i<6;i++) mkUnit("warden",1,cx+50-(i%3)*20,cy-20+((i/3)|0)*20)');
  run('ents.forEach(function(u){ if(!u.dead&&u.kind==="unit"&&!UDEF[u.type].worker)' +
      ' u.cmd={t:"amove",x:(u.owner===0?cx+40:cx-40),y:cy}; })');
  let braced = 0;
  for (let i = 0; i < 90; i++) {
    run('over=false'); run('simTick(0.05)');
    const n = run('ents.filter(function(u){return !u.dead&&u.kind==="unit"&&u.braced;}).length');
    if (n > braced) braced = n;
  }
  ok(braced >= 4, 'a melee has units planted and trading (' + braced + ' braced at once)');
  const src = run('String(separate)');
  ok(/u\.braced\) f\*=/.test(src), 'and the crowd pushes them far less while they are');
  ok(/isFoe\(o\.owner,u\.owner\)\) f\*=/.test(src),
     'and you cannot shove an enemy line around by walking into it');
});


console.log('\nshield lookup');

test('a shield soaks exactly what it used to', () => {
  arena('concord');
  run('var k=ents.find(e=>!e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone")');
  run('var lone=mkUnit("harrower",0,k.x+400,k.y+400)');
  tickOn(3);
  eq(run('wardFactor(lone)'), 1, 'nothing overhead means no reduction');
  run('var T=mkUnit("titan",0,k.x+800,k.y+800)');
  run('var inside=mkUnit("harrower",0,k.x+830,k.y+830)');
  run('var outside=mkUnit("harrower",0,k.x+1400,k.y+1400)');
  run('var foe=mkUnit("harrower",1,k.x+830,k.y+860)');
  tickOn(3);
  const cut = run('FSTYLE.concord.titan.ward.cut');
  near(run('wardFactor(inside)'), 1 - cut, 0.001, 'under your own Bastion');
  eq(run('wardFactor(outside)'), 1, 'outside the bubble');
  eq(run('wardFactor(foe)'), 1, 'an enemy standing under your shield gets nothing');
});

test('the shield lookup costs nothing when nobody owns one', () => {
  /* This sits inside damage(), so it runs for every bullet, blow and splash
     victim in the game. It used to walk the spatial grid around the target on
     every one of those calls - even with no Bastion anywhere, which is most of
     every match. */
  const src = run('String(wardFactor)');
  ok(/if\(!list\.length\) return 1;/.test(src), 'it bails out before searching anything');
  ok(!/around\(/.test(src), 'and it no longer walks the crowd around the target');
  ok(/WARDF\.get\(t\)/.test(src), 'and it remembers the answer for the rest of the tick');
  ok(/w\.range\*w\.range/.test(src), 'comparing squared distances rather than taking roots');
});

test('the set of shield-carrying types is derived, not hardcoded', () => {
  const types = run('[...wardTypes()]');
  ok(types.indexOf('titan') >= 0, 'the capital ship carries one');
  const src = run('String(wardTypes)');
  ok(/FSTYLE/.test(src), 'read from FSTYLE, so giving something else a shield still works');
});

test('the shield lookup is fast enough for a Grand War brawl', () => {
  arena('concord');
  run('var k=ents.find(e=>!e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone")');
  run('var cx=k.x+900, cy=k.y+900');
  run('for(var i=0;i<60;i++) mkUnit("warden",0,cx-150+(i%10)*26,cy-80+((i/10)|0)*26)');
  run('for(var i=0;i<60;i++) mkUnit("warden",1,cx+150-(i%10)*26,cy-80+((i/10)|0)*26)');
  run('mkUnit("titan",0,cx-60,cy)');
  tickOn(3);
  const r = run([
    '(function(){',
    ' var list=ents.filter(function(e){return !e.dead&&e.kind==="unit";});',
    ' var t0=Date.now(), n=0;',
    ' for(var pass=0;pass<20;pass++){',
    '   gameTime+=0.05;',
    '   for(var rr=0;rr<20;rr++) for(var i=0;i<list.length;i++){ wardFactor(list[i]); n++; }',
    ' }',
    ' return {calls:n, ms:Date.now()-t0};',
    '})()'
  ].join('\n'));
  const perCall = r.ms / r.calls;
  ok(perCall < 0.002,
     r.calls.toLocaleString() + ' lookups in ' + r.ms + 'ms (' +
     (perCall * 1000).toFixed(2) + ' microseconds each)');
});


console.log('\ngrouped production');

test('a group of halls reports what it is building and what is idle', () => {
  /* Selecting a control group of production buildings told you nothing about
     what any of them were doing - which is most of the reason to group them. */
  arena('legion');
  run('P[0].m=9000; P[0].g=4000');
  run('var k=ents.find(function(e){return !e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone";})');
  // plenty of housing, or the orders get refused on population and prove nothing
  run('for(var i=0;i<8;i++) mkBuilding("habitat",0,k.x-400+(i%4)*90,k.y-300+((i/4)|0)*90,true)');
  run('var halls=[]');
  run('for(var i=0;i<5;i++) halls.push(mkBuilding("musterhall",0,k.x+260+(i%3)*150,k.y-200+((i/3)|0)*140,true))');
  run('recalcSupply(0)');
  run('tryTrain(halls[0],"warden"); tryTrain(halls[0],"warden"); tryTrain(halls[0],"breaker")');
  run('tryTrain(halls[1],"bulwark"); tryTrain(halls[1],"warden")');
  run('tryTrain(halls[2],"breaker")');
  tickOn(10);
  const pr = run('groupProduction(halls)');
  const queued = run('halls.reduce(function(n,b){return n+((b.queue&&b.queue.length)||0);},0)');
  const busy = run('halls.filter(function(b){return b.queue&&b.queue.length;}).length');
  eq(pr.halls, 5, 'it counted the halls');
  eq(pr.total, queued, 'the total matches the real queues (' + queued + ')');
  eq(pr.busy, busy, 'and how many are working');
  eq(pr.idle, 5 - busy, 'and how many are standing idle');
  ok(pr.soonest !== null && pr.soonest >= 0, 'with the soonest completion (' +
     (pr.soonest === null ? 'none' : pr.soonest.toFixed(1) + 's') + ')');
  ok(pr.parts.join(', ').indexOf('Conscript') >= 0,
     "broken down in this doctrine's own names: " + pr.parts.join(', '));
});

test('a group of halls with nothing queued says so', () => {
  arena('concord');
  run('var k=ents.find(function(e){return !e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone";})');
  run('var halls=[]');
  run('for(var i=0;i<3;i++) halls.push(mkBuilding("musterhall",0,k.x+260+i*150,k.y-200,true))');
  tickOn(3);
  const pr = run('groupProduction(halls)');
  eq(pr.total, 0, 'nothing in production');
  eq(pr.idle, 3, 'all three idle');
  eq(pr.soonest, null, 'and nothing to wait for');
});

test('a selection with nothing that produces reports nothing', () => {
  arena('concord');
  run('var k=ents.find(function(e){return !e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone";})');
  run('var us=[]');
  run('for(var i=0;i<4;i++) us.push(mkUnit("warden",0,k.x+200+i*30,k.y+200))');
  tickOn(3);
  eq(run('groupProduction(us)'), null, 'no production summary for a group of units');
  eq(run('groupProduction([])'), null, 'nor for an empty selection');
});

test('the panel renders the summary from that data', () => {
  const whole = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'stellar-command.html'), 'utf8');
  ok(/const pr=groupProduction\(sel\);/.test(whole), 'the panel asks for the data');
  ok(/in production/.test(whole), 'and prints the count');
  ok(/hallsIdle/.test(whole), 'and flags the idle halls');
  ok(/class="qn"/.test(whole), 'with a per-building badge on the portraits');
});


console.log('\nsiege retaliation');

test('an explicit attack order is never taken away from you', () => {
  /* Retaliation used to override an order on a BUILDING the moment the
     defenders fired back, which meant telling an army to kill a specific
     structure quietly stopped working exactly when it mattered. An order you
     gave wins; retaliation covers everything that has not been given one. */
  arena('concord');
  run('var k=ents.find(function(e){return !e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone";})');
  run('var mine=[]');
  run('for(var i=0;i<10;i++) mine.push(mkUnit("warden",0,k.x+300+(i%5)*30,k.y+300+((i/5)|0)*30))');
  run('var wall=mkBuilding("habitat",1,k.x+700,k.y+300,true)');
  run('var guards=[]');
  run('for(var i=0;i<3;i++) guards.push(mkUnit("warden",1,k.x+640+i*30,k.y+380))');
  run('setSel(mine)');
  tickOn(2);
  run('rightClick(wall.x,wall.y,false)');
  const took = run('mine.filter(function(u){return u.cmd.t==="attack"&&u.cmd.target===wall;}).length');
  eq(took, 10, 'all ten took the order');
  tickOn(120);
  const alive = run('mine.filter(function(u){return !u.dead;}).length');
  const held = run('mine.filter(function(u){return !u.dead&&u.cmd.t==="attack"&&u.cmd.target===wall;}).length');
  const firing = run('mine.filter(function(u){return !u.dead&&u.target===wall;}).length');
  ok(alive > 0, 'some survived the defenders (' + alive + '/10)');
  eq(held, alive, 'every survivor still holds the order');
  eq(firing, alive, 'and every one of them is shooting the building');
  ok(run('wall.dead||wall.hp<wall.maxHp*0.5'), 'the building actually came down');
});

test('a unit with no specific order still turns on whoever shoots it', () => {
  arena('concord');
  run('var k=ents.find(function(e){return !e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone";})');
  run('var a=mkUnit("harrower",0,k.x+400,k.y+400); a.cmd={t:"amove",x:k.x+400,y:k.y+900}');
  run('var sniper=mkUnit("sunderer",1,k.x+560,k.y+400)');
  run('sniper.cmd={t:"attack",target:a}; sniper.target=a');
  tickOn(40);
  ok(!run('a.dead'), 'the target survived long enough to react');
  /* Having killed the shooter counts as having turned on it - target is
     cleared when it dies. Asserting only on target===sniper made this a
     test of how hard a tank hits: buffing the gun let it finish the
     sunderer inside the window and the assertion broke with nothing
     actually wrong. */
  ok(run('a.target===sniper') || run('sniper.dead'),
     'a unit on attack-move turned on the shooter (target or killed it)');
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

console.log('\ntutorial covers the capital ship');

test('the tutorial teaches the shipyard and the capital ship', () => {
  run('facKey="pact"');
  run('startTutorial()');
  const steps = run('TUT_STEPS.map(function(s){return (typeof s.b==="function")?s.b():s.b;})');
  const yard = steps.findIndex(t => /Proving Ground|Heavy Works|Boneyard/i.test(t));
  const ship = steps.findIndex(t => /Land Battleship|Siege Dreadnought|Scrap Leviathan/i.test(t));
  ok(yard >= 0, 'there is a step for the shipyard');
  ok(ship > yard, 'and ordering the ship comes after building the yard');
  const last = steps.length - 1;
  ok(ship < last, 'both land before the final mission');
});

test('the shipyard step funds itself, since a training run never banks that much', () => {
  run('facKey="concord"');
  run('startTutorial()');
  const steps = run('TUT_STEPS.map(function(s){return (typeof s.b==="function")?s.b():s.b;})');
  const i = steps.findIndex(t => /Proving Ground/i.test(t));
  ok(i >= 0, 'found the shipyard step');
  run('P[0].m=0; P[0].g=0');
  run('TUT.i=' + i + '; TUT_STEPS[' + i + ']._entered=false; tutShow()');
  const cost = run('priceOf("unit","titan",0)');
  ok(run('P[0].m') >= cost.m, 'enough supply to actually reach it');
  ok(run('P[0].g') >= cost.g, 'and enough fuel');
});

test('the shipyard step walks the same build chain as the others', () => {
  run('facKey="legion"');
  run('startTutorial()');
  const steps = run('TUT_STEPS.map(function(s){return (typeof s.b==="function")?s.b():s.b;})');
  const i = steps.findIndex(t => /Heavy Works/i.test(t));
  run('TUT.i=' + i + '; tutShow()');
  run('setSel([])');
  const a = run('(function(){var f=tutFocus(); return f&&f.ent?"rings a unit":JSON.stringify(f);})()');
  ok(/rings a unit/.test(a), 'with nothing selected it points at a Sapper');
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


console.log('\nprices: quoted, demanded, charged');

test('what you must hold is exactly what you are charged', () => {
  /* In Blitz the build button tested the list price while startBuild charged
     the real one - it made you hold the full amount and then took half. */
  for (const sc of ['standard', 'blitz']) {
    run('scaleKey="' + sc + '"; modeKey="duel"; terrainKey="open"; facKey="concord"');
    run('startGame("veteran"); BOTS=[false,false,false,false]');
    run('var k=ents.find(function(e){return !e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone";})');
    run('var w=ents.find(function(e){return !e.dead&&e.kind==="unit"&&e.owner===0&&UDEF[e.type].worker;})');
    const price = run('bldCost("habitat",0)');
    // exactly the quoted price in the bank must be enough
    run('P[0].m=' + price.m + '; P[0].g=' + price.g);
    const before = run('P[0].m');
    const built = run('!!startBuild("habitat",k.x+300,k.y+300,0,[w])');
    const charged = before - run('P[0].m');
    ok(built, sc + ': the quoted price was enough to build it');
    eq(charged, price.m, sc + ': and that is exactly what it took');
  }
});

test('the build button lets you through at the quoted price', () => {
  for (const sc of ['standard', 'blitz']) {
    run('scaleKey="' + sc + '"; modeKey="duel"; terrainKey="open"; facKey="concord"');
    run('startGame("veteran"); BOTS=[false,false,false,false]');
    run('var w=ents.find(function(e){return !e.dead&&e.kind==="unit"&&e.owner===0&&UDEF[e.type].worker;})');
    run('setSel([w]); cardMode="build"; refreshUI()');
    const price = run('bldCost("habitat",0).m');
    run('P[0].m=' + price + '; placing=null');
    const allowed = run('(function(){var b=cardButtons.filter(function(x){' +
      'return !x.empty&&/Billet|Camp|Bunkhouse/.test(x.name);})[0];' +
      'if(!b) return false; b.act(); return !!placing;})()');
    run('placing=null; cardMode="main"');
    ok(allowed, sc + ': the button accepted exactly the price it quoted (' + price + ')');
  }
});

test('a unit is demanded and charged the same amount', () => {
  for (const sc of ['standard', 'blitz']) {
    run('scaleKey="' + sc + '"; modeKey="duel"; terrainKey="open"; facKey="concord"');
    run('startGame("veteran"); BOTS=[false,false,false,false]');
    run('var k=ents.find(function(e){return !e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone";})');
    const price = run('priceOf("unit","delver",0)');
    run('P[0].m=' + price.m);
    const before = run('P[0].m');
    const ok1 = run('tryTrain(k,"delver")');
    ok(ok1, sc + ': trained with exactly the quoted price');
    eq(before - run('P[0].m'), price.m, sc + ': and charged that');
  }
});

test('repairs are billed against what the thing cost you', () => {
  /* Buildings fell through to the raw definition, so in Blitz a hull that cost
     half still billed repairs against the full list price. */
  const share = {};
  for (const sc of ['standard', 'blitz']) {
    run('scaleKey="' + sc + '"; modeKey="duel"; terrainKey="open"; facKey="concord"');
    run('startGame("veteran"); BOTS=[false,false,false,false]');
    run('var k=ents.find(function(e){return !e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone";})');
    run('var h=mkBuilding("habitat",0,k.x+300,k.y+300,true)');
    const price = run('priceOf("building","habitat",0).m');
    const full = run('(function(){var t=h,_fr=facOf(0);' +
      'return (priceOf(t.kind,t.type,t.owner).m||0)*.35*(_fr.repairMul||1);})()');
    share[sc] = full / price;
    ok(price > 0, sc + ': habitat has a price');
  }
  near(share.blitz, share.standard, 0.001,
       'a full repair costs the same share of the price in both scales');
});

test('nothing reads a price straight off a definition any more', () => {
  const whole = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'stellar-command.html'), 'utf8');
  const code = whole.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/canAfford\([^,]+,\s*BDEF\[/.test(code), 'no affordability check against a raw definition');
  ok(!/(BDEF|UDEF)\[[^\]]+\]\.(m|g)\b/.test(code), 'no direct cost reads off a definition');
  ok(/function costRateFor/.test(code), 'one place decides what a scale does to prices');
});


console.log('\nblitz');

function scaleStart(sc, mode) {
  run('scaleKey="' + sc + '"; modeKey="' + (mode || 'duel') + '"; terrainKey="open"; facKey="concord"');
  run('startGame("veteran")');
}

test('blitz is the standard map at half price and double speed', () => {
  scaleStart('standard');
  const std = run('({map:MAP_W,cost:COST_RATE,build:BUILD_RATE,train:TRAIN_RATE,eco:ECO})');
  scaleStart('blitz');
  const bz = run('({map:MAP_W,cost:COST_RATE,build:BUILD_RATE,train:TRAIN_RATE,eco:ECO})');
  eq(bz.map, std.map, 'same size map as standard');
  eq(bz.cost, 0.5, 'everything is half price');
  eq(bz.build, 2, 'structures go up twice as fast');
  eq(bz.train, 2, 'and units train twice as fast');
  eq(run('BLITZ'), true, 'the flag is set');
  eq(run('GRAND'), false, 'and it is not grand war');
});

test('half price applies to units and structures alike', () => {
  scaleStart('standard');
  const su = run('priceOf("unit","warden",0)'), sb = run('priceOf("building","habitat",0)');
  const st = run('priceOf("unit","titan",0)');
  scaleStart('blitz');
  const bu = run('priceOf("unit","warden",0)'), bb = run('priceOf("building","habitat",0)');
  const bt = run('priceOf("unit","titan",0)');
  eq(bu.m, Math.round(su.m / 2), 'a unit costs half (' + su.m + ' -> ' + bu.m + ')');
  eq(bb.m, Math.round(sb.m / 2), 'a structure costs half (' + sb.m + ' -> ' + bb.m + ')');
  eq(bt.m, Math.round(st.m / 2), 'even the capital ship (' + st.m + ' -> ' + bt.m + ')');
  eq(bt.g, Math.round(st.g / 2), 'ichor too');
});

test('the price on the card is the price you are charged', () => {
  /* The build card quoted BDEF straight while startBuild charged priceOf, so
     in Blitz it said 400 and took 200. */
  scaleStart('blitz');
  run('var k=ents.find(function(e){return !e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone";})');
  run('var w=ents.find(function(e){return !e.dead&&e.kind==="unit"&&e.owner===0&&UDEF[e.type].worker;})');
  run('setSel([w]); cardMode="build"; refreshUI()');
  const shown = run('(function(){var b=cardButtons.filter(function(x){return !x.empty&&x.cost&&/Billet|Camp|Bunkhouse/.test(x.name);})[0];' +
                    'return b?b.cost.m:-1;})()');
  run('cardMode="main"');
  run('P[0].m=5000');
  const before = run('P[0].m');
  run('startBuild("habitat",k.x+300,k.y+300,0,[w])');
  const charged = before - run('P[0].m');
  eq(shown, charged, 'card said ' + shown + ', charged ' + charged);
});

test('the blitz starts really are side by side, and evenly paired', () => {
  scaleStart('standard', 'duel');
  const std = run('Math.hypot(BASES[1].tx-BASES[0].tx,BASES[1].ty-BASES[0].ty)');
  scaleStart('blitz', 'duel');
  const bz = run('Math.hypot(BASES[1].tx-BASES[0].tx,BASES[1].ty-BASES[0].ty)');
  ok(bz < std / 3, 'the two starts are far closer than standard (' +
     Math.round(bz) + ' vs ' + Math.round(std) + ' tiles)');
  ok(bz > 16, 'but far enough apart that each has its own aurite (' + Math.round(bz) + ' tiles)');
  // and a four-way blitz is still a fair draw
  scaleStart('blitz', 'ffa');
  const n = run('NPLAY'), pos = [];
  for (let i = 0; i < n; i++) pos.push(run('({x:BASES[' + i + '].tx,y:BASES[' + i + '].ty})'));
  const tally = {};
  for (let i = 0; i < n; i++) {
    let near = -1, nd = 1e18;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = Math.hypot(pos[j].x - pos[i].x, pos[j].y - pos[i].y);
      if (d < nd) { nd = d; near = j; }
    }
    tally[near] = (tally[near] || 0) + 1;
  }
  const worst = Math.max.apply(null, Object.keys(tally).map(k => tally[k]));
  ok(worst <= 1, 'no start is more than one player\'s nearest: ' + JSON.stringify(tally));
});

test('a blitz match opens far faster than a standard one', () => {
  const run1 = sc => run([
    '(function(){',
    ' scaleKey="' + sc + '"; modeKey="duel"; terrainKey="open"; facKey="concord";',
    ' startGame("warlord"); BOTS=[false,true,false,false];',
    ' var hall=null;',
    ' for(var i=0;i<2500;i++){',
    '   over=false; simTick(0.1);',
    '   if(!hall&&ents.some(function(e){return !e.dead&&e.owner===1&&e.type==="musterhall"&&e.done;})){',
    '     hall=Math.round(gameTime); break; }',
    ' }',
    ' return hall;',
    '})()'
  ].join('\n'));
  const std = run1('standard'), bz = run1('blitz');
  ok(bz !== null && std !== null, 'both got a barracks up');
  ok(bz < std, 'blitz builds one sooner (' + bz + 's vs ' + std + 's)');
});

test('the scale travels with an online match', () => {
  const whole = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'stellar-command.html'), 'utf8');
  const srv = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'server.js'), 'utf8');
  ok(/scale:sc/.test(whole), 'the host sends the scale key');
  ok(/function startOnline\(seed,grand,mode,scale\)/.test(whole), 'the client takes it');
  ok(/SCALE_OK=\{standard:1,grand:1,blitz:1\}/.test(srv), 'the relay only passes ones it knows');
  ok(/scale:sc/.test(srv), 'and hands it to every player');
  ok(/scale:g\.scale/.test(srv), 'including on a reconnect');
});


console.log('\nbots are harder');

test('the difficulty ladder is ordered on every knob', () => {
  const k = {};
  for (const d of ['recruit', 'veteran', 'warlord']) {
    run('startGame("' + d + '")');
    k[d] = run('({dec:DIFF.dec,grace:DIFF.grace,wk:DIFF.wk,halls:DIFF.halls,qd:DIFF.qd,' +
               'spires:DIFF.spires,expo:DIFF.expo,techAt:DIFF.techAt,up:DIFF.up||0,' +
               'eco:DIFF.eco,hp:DIFF.hp,dmg:DIFF.dmg})');
  }
  ok(k.recruit.dec > k.veteran.dec && k.veteran.dec > k.warlord.dec, 'thinks more often');
  ok(k.recruit.grace > k.veteran.grace && k.veteran.grace > k.warlord.grace, 'pushes sooner');
  ok(k.recruit.wk < k.veteran.wk && k.veteran.wk < k.warlord.wk, 'saturates its lines');
  ok(k.recruit.halls <= k.veteran.halls && k.veteran.halls < k.warlord.halls, 'more production');
  ok(k.recruit.expo < k.veteran.expo && k.veteran.expo < k.warlord.expo, 'expands more');
  ok(k.recruit.techAt > k.veteran.techAt && k.veteran.techAt > k.warlord.techAt, 'techs sooner');
  ok(k.recruit.up < k.veteran.up && k.veteran.up < k.warlord.up, 'researches more');
  ok(k.recruit.eco <= k.veteran.eco && k.veteran.eco < k.warlord.eco, 'brings more home');
  ok(k.warlord.qd >= k.veteran.qd, 'queues deeper');
});

test('only the hardest setting gets a stat edge, and it is modest', () => {
  const s = {};
  for (const d of ['recruit', 'veteran', 'warlord']) {
    run('startGame("' + d + '")');
    s[d] = { hp: run('DIFF.hp'), dmg: run('DIFF.dmg'), elite: run('({hp:ELITE.hp,dmg:ELITE.dmg})') };
  }
  eq(s.recruit.hp, 1, 'Recruit units are stock');
  eq(s.recruit.dmg, 1, 'in damage too');
  eq(s.veteran.hp, 1, 'Veteran is a fair fight on stats');
  eq(s.veteran.dmg, 1, 'in damage too');
  ok(s.warlord.hp > 1 && s.warlord.hp <= 1.25, 'Warlord gets a modest hull edge (' + s.warlord.hp + ')');
  ok(s.warlord.dmg > 1 && s.warlord.dmg <= 1.25, 'and a modest damage edge (' + s.warlord.dmg + ')');
  eq(s.warlord.elite.hp, s.warlord.hp, 'and it is actually applied');
  eq(s.warlord.elite.dmg, s.warlord.dmg, 'both ways');
});

test('a bot actually researches its upgrades now', () => {
  /* Not one upgrade was ever researched, at any difficulty, in a whole match:
     they were gated on holding 420 spare aurite and a bot is permanently
     broke, so a 36% damage swing sat untouched all game. */
  const res = run([
    '(function(){',
    ' scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord";',
    ' startGame("warlord"); BOTS=[false,true,false,false];',
    ' var forgeAt=null, firstUp=null;',
    ' for(var i=0;i<4000;i++){',
    '   over=false; simTick(0.1);',
    '   if(!forgeAt&&ents.some(function(e){return !e.dead&&e.owner===1&&e.type==="forgeworks"&&e.done;}))',
    '     forgeAt=Math.round(gameTime);',
    '   if(!firstUp&&UP[1]&&(UP[1].wep+UP[1].arm)>0){ firstUp=Math.round(gameTime); break; }',
    ' }',
    ' return {forgeAt:forgeAt, firstUp:firstUp, levels:(UP[1]?UP[1].wep+UP[1].arm:0)};',
    '})()'
  ].join(String.fromCharCode(10)));
  ok(res.forgeAt !== null, 'it got a Workshop up at ' + res.forgeAt + 's');
  ok(res.firstUp !== null, 'and researched something by ' + res.firstUp + 's');
});

test('upgrades are a savings goal, not a leftovers purchase', () => {
  const whole = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'stellar-command.html'), 'utf8');
  const code = whole.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/wantUp/.test(code), 'there is an appetite for research');
  ok(/saveGoal=upCost\(upKey/.test(code), 'and the bot saves for it');
  ok(!/P\[ME\]\.m>=mGate\(420\)/.test(code), 'the old spare-cash gate is gone');
  ok(/COST_RATE/.test(whole.slice(whole.indexOf('function upCost'), whole.indexOf('function upCost') + 400)),
     'research follows the scale like every other price');
});

test('a harder setting really does kill faster', () => {
  const kill = d => run([
    '(function(){',
    ' scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord";',
    ' startGame("' + d + '"); setSeed(4242); init(); BOTS=[false,true,false,false];',
    ' for(var i=0;i<6000;i++){ simTick(0.1); if(over) return Math.round(gameTime); }',
    ' return null;',
    '})()'
  ].join(String.fromCharCode(10)));
  const vet = kill('veteran'), war = kill('warlord');
  ok(vet !== null && war !== null, 'both finished the job');
  ok(war < vet, 'Warlord kills sooner than Veteran (' + war + 's vs ' + vet + 's)');
});


console.log('\ndifficulty and free-for-all');

test('Recruit is not allowed to out-expand Veteran', () => {
  /* `DIFF.expo||2` read Recruit's expo:0 as "unset" and handed it two
     expansions - the same as Warlord and one more than Veteran. The easy
     setting was quietly building a bigger economy than the medium one. */
  const whole = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'stellar-command.html'), 'utf8');
  // strip block comments, or the note explaining the old bug matches it
  const code = whole.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/DIFF\.expo\s*\|\|/.test(code), 'zero no longer reads as unset');
  ok(/DIFF\.expo===undefined\?2:DIFF\.expo/.test(code), 'it tests for undefined explicitly');
  const cap = {};
  for (const d of ['recruit', 'veteran', 'warlord']) {
    run('scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord"');
    run('startGame("' + d + '")');
    cap[d] = run('(GRAND?6:(DIFF.expo===undefined?2:DIFF.expo))');
  }
  eq(cap.recruit, 0, 'Recruit expands not at all');
  ok(cap.veteran > cap.recruit, 'Veteran expands more than Recruit');
  ok(cap.warlord > cap.veteran, 'and Warlord more than Veteran');
});

test('every difficulty knob orders the three settings correctly', () => {
  const k = {};
  for (const d of ['recruit', 'veteran', 'warlord']) {
    run('startGame("' + d + '")');
    k[d] = run('({dec:DIFF.dec,grace:DIFF.grace,thr:DIFF.thr,wk:DIFF.wk,' +
               'halls:DIFF.halls,qd:DIFF.qd,spires:DIFF.spires,' +
               'expoAt:DIFF.expoAt,techAt:DIFF.techAt})');
  }
  // harder settings think more often, open earlier, and work more patches
  ok(k.recruit.dec > k.veteran.dec && k.veteran.dec > k.warlord.dec, 'decision interval');
  ok(k.recruit.grace > k.veteran.grace && k.veteran.grace > k.warlord.grace, 'grace period');
  ok(k.recruit.wk < k.veteran.wk && k.veteran.wk < k.warlord.wk, 'worker saturation');
  ok(k.recruit.halls <= k.veteran.halls && k.veteran.halls <= k.warlord.halls, 'production halls');
  ok(k.recruit.techAt > k.veteran.techAt && k.veteran.techAt > k.warlord.techAt, 'tech timing');
});

test('a bot ranks its scouting from its own base, not from slot zero', () => {
  /* myFoeStarts() is in slot order, so ranking from its first entry meant
     every bot in a free-for-all searched around the PLAYER's start first. */
  const src = run('String(aiScoutSpots)');
  ok(/home\.x/.test(src) && /home\.y/.test(src),
     'the sort is relative to its own home');
  ok(!/myFoeStarts\(ME\)\[0\]/.test(src), 'no slot-order reference left in it');
  // and the first place each bot looks really is its own nearest neighbour
  run('scaleKey="standard"; modeKey="ffa"; terrainKey="open"; facKey="concord"');
  run('startGame("veteran")');
  for (let o = 1; o < run('NPLAY'); o++) {
    const first = run('aiScoutSpots(' + o + ')[0]');
    const home = run('(function(){var h=aiHome(' + o + '); return {x:h.x,y:h.y};})()');
    const mine = Math.hypot(first.x - home.x, first.y - home.y);
    const toPlayer = run('(function(){var b=BASES[0]; var h=aiHome(' + o + ');' +
                         'return Math.hypot(b.tx*TILE-h.x,b.ty*TILE-h.y);})()');
    ok(mine <= toPlayer + 1,
       'bot ' + o + ' looks somewhere at least as close as the player (' +
       Math.round(mine) + ' vs ' + Math.round(toPlayer) + 'px)');
  }
});

test('the free-for-all starts are evenly paired', () => {
  run('scaleKey="standard"; modeKey="ffa"; terrainKey="open"; facKey="concord"');
  run('startGame("veteran")');
  const n = run('NPLAY');
  const pos = [];
  for (let i = 0; i < n; i++) pos.push(run('({x:BASES[' + i + '].tx,y:BASES[' + i + '].ty})'));
  const tally = {};
  for (let i = 0; i < n; i++) {
    let near = -1, nd = 1e18;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = Math.hypot(pos[j].x - pos[i].x, pos[j].y - pos[i].y);
      if (d < nd) { nd = d; near = j; }
    }
    tally[near] = (tally[near] || 0) + 1;
  }
  // nobody should be everyone else's closest target
  const worst = Math.max.apply(null, Object.keys(tally).map(k => tally[k]));
  ok(worst <= 1,
     'no start is more than one player\'s nearest neighbour: ' + JSON.stringify(tally));
});


console.log('\nbots and capital ships');

test('a big building can be placed even when home is crowded', () => {
  /* aiPlace only sampled 120-300px from the anchor, so once a base filled in
     there was nothing a 112x112 footprint could fit into - the Citadel was
     unplaceable and bots never built one at all. */
  arena('concord');
  run('var k=ents.find(e=>!e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone")');
  // ring the base in buildings, the way a bot's sprawl does
  run([
    'var placed=0;',
    'for(var r=120;r<=300&&placed<14;r+=60){',
    ' for(var a=0;a<6.283&&placed<14;a+=0.5){',
    '  var x=snap(k.x+Math.cos(a)*r), y=snap(k.y+Math.sin(a)*r);',
    '  if(canPlace("habitat",x,y,0)){ mkBuilding("habitat",0,x,y,true); placed++; }',
    ' }',
    '}'
  ].join('\n'));
  ok(run('placed') >= 8, 'walled the base in with ' + run('placed') + ' buildings');
  const spot = run('aiPlace(0,"citadel",k,null)');
  ok(spot && spot.x !== undefined, 'the shipyard still found somewhere to go');
  eq(run('canPlace("citadel",' + spot.x + ',' + spot.y + ',0)'), true,
     'and the spot it picked is legal');
});

test('the shipyard gate is affordability, not an arbitrary bank', () => {
  const whole = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'stellar-command.html'), 'utf8');
  ok(/canAfford\(ME,bldCost\('citadel',ME\)\)/.test(whole),
     'the bot builds it when it can pay for it');
  ok(!/P\[ME\]\.m>=620&&P\[ME\]\.g>=260/.test(whole),
     'the old hand-picked threshold is gone');
});

test('a bot saves for the ship instead of spending it on infantry', () => {
  const whole = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'stellar-command.html'), 'utf8');
  ok(/let saveGoal=null;/.test(whole), 'it has a savings goal');
  ok(/if\(savingUp\) continue;/.test(whole), 'and production stands down while saving');
  ok(/army\.length>=\(BLITZ\?6:10\)/.test(whole),
     'but only once it has an army to hold with');
  ok(/AI\.saveBestAt/.test(whole), 'and it gives up if it stops making progress');
  // the training gate must actually clear the real price
  ok(!/P\[ME\]\.m>=720&&P\[ME\]\.g>=640/.test(whole),
     'the training gate no longer sits below the price');
});

test('a bot really does get a shipyard up in a match', () => {
  /* startGame seeds the map from Math.random(), so this used to pass or fail
     on the luck of the terrain - a flaky tripwire is worse than none. The
     seed is pinned after startGame and the world rebuilt on it, and three
     fixed maps are tried: the claim is that a Warlord bot reaches a shipyard
     on a typical map, not on every conceivable one. */
  const seeds = [12345, 777, 20260101];
  const runs = seeds.map(sd => run([
    '(function(){',
    ' scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord";',
    ' startGame("warlord");',
    ' setSeed(' + sd + '); init();',
    ' BOTS=[false,true,false,false];',
    ' var yardAt=null;',
    ' for(var i=0;i<5000;i++){',
    '   over=false; simTick(0.1);',
    '   if(!yardAt&&ents.some(function(e){return !e.dead&&e.owner===1&&',
    '     e.type==="citadel"&&e.done;})){ yardAt=Math.round(gameTime); break; }',
    ' }',
    ' return {yardAt:yardAt, at:Math.round(gameTime)};',
    '})()'
  ].join('\n')));
  const got = runs.filter(r => r.yardAt).map(r => r.yardAt + 's');
  ok(got.length >= 2,
     'a shipyard on at least 2 of 3 fixed maps (got ' + got.length + ': ' +
     (got.join(', ') || 'none') + ')');
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

test('a Sapper that gets shot keeps mining', () => {
  arena('concord');
  run('var W=ents.find(e=>!e.dead&&e.kind==="unit"&&e.owner===0&&UDEF[e.type].worker)');
  run('var F=mkUnit("warden",1,W.x+60,W.y)');
  run('damage(W,5,1,F)');
  eq(run('W.cmd.t'), 'gather', 'it is still on the aurite');
  eq(run('!!W.target'), false, 'and it did not pick a fight');
});

test('a bot that loses its last Headquarters surrenders instead of hiding', () => {
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
  // assert the wiring, not a particular letter, so remapping the defaults
  // does not false-fail this
  eq(run('hkOf("bld","habitat","Z")'), run('keyLabel(KEY_DEF["b_habitat"])'),
     'card labels come from the binding');
  run('OPT.keys={"b_habitat":"j"}');
  eq(run('hkOf("bld","habitat","H")'), 'J', 'and change with it');
  run('OPT.keys={}');
  eq(run('keyFor("c_A")'), 'a', 'clearing restores the default');
  ok(run('KEY_ACTS.length') >= 15, 'every action in the list is rebindable');
});

test('the default hotkeys are free of real conflicts', () => {
  run('OPT.keys={}');
  /* Train and build buttons never share a panel, so a letter used by both
     is fine; two train buttons on the same letter is not. */
  eq(JSON.stringify(run('keyClashes()')), '{}', 'no clash inside any one panel');
  run('OPT.keys={"u_warden":"h"}');   // same letter as the Howitzer
  ok(Object.keys(run('keyClashes()')).length > 0, 'a real clash is still reported');
  run('OPT.keys={}');
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

console.log('\nonline: what reaches the other player');

test('every unit type survives a snapshot', () => {
  /* netSnapshot drops anything netTypeIdx cannot encode, and the unit table
     was never extended when the melee unit and the capital ship were added -
     so a guest simply never saw them, its own or the enemy's. With melee at a
     quarter price that is most of an army. */
  run('scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord"');
  run('startGame("veteran")');
  const types = run('Object.keys(UDEF)');
  const missing = run('Object.keys(UDEF).filter(function(t){' +
                      'return netTypeIdx({kind:"unit",type:t})<0;})');
  eq(JSON.stringify(missing), '[]',
     'no unit type is unencodable (' + types.length + ' types)');
  const bmissing = run('Object.keys(BDEF).filter(function(t){' +
                       'return netTypeIdx({kind:"building",type:t})<0;})');
  eq(JSON.stringify(bmissing), '[]', 'and no building type is either');
});

test('a type index decodes back to the type it came from', () => {
  // the encoding is shared with saved replays, so it has to round-trip
  const bad = run('(function(){var out=[];' +
    'var kinds=[["unit",Object.keys(UDEF)],["building",Object.keys(BDEF)],' +
    '           ["res",NET_R]];' +
    'for(var k=0;k<kinds.length;k++){ var kind=kinds[k][0], list=kinds[k][1];' +
    ' for(var i=0;i<list.length;i++){ var t=list[i];' +
    '  var idx=netTypeIdx({kind:kind,type:t});' +
    '  var back=netTypeOf(idx);' +
    '  if(!back||back.kind!==kind||back.type!==t)' +
    '   out.push(kind+" "+t+" -> "+idx+" -> "+JSON.stringify(back)); } }' +
    'return out;})()');
  eq(JSON.stringify(bad), '[]', 'every type round-trips through the index');
});

test('the indices replays were recorded with have not moved', () => {
  /* Saved .scr files carry these numbers, so the original six units, the
     buildings and the two resources must keep the indices they had. */
  const expect = [['unit','delver',0],['unit','warden',1],['unit','bulwark',2],
                  ['unit','sunderer',3],['unit','harrower',4],['unit','talon',5],
                  ['building','keystone',6],['building','citadel',12],
                  ['res','aurite',13],['res','vent',14]];
  for (const [kind, type, idx] of expect) {
    eq(run('netTypeIdx({kind:"' + kind + '",type:"' + type + '"})'), idx,
       kind + ' ' + type + ' still encodes as ' + idx);
  }
});

test('a snapshot carries the whole army, not six eighths of it', () => {
  run('scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord"');
  run('startGame("veteran")');
  run('var k=ents.find(function(e){return !e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone";})');
  // one of every unit type on the field, owned by the other side
  run('Object.keys(UDEF).forEach(function(t,i){ mkUnit(t,1,k.x+200+i*40,k.y+200); })');
  const sent = run('(function(){var grab=null; var old=netRelay;' +
    'netRelay=function(o){ grab=o; };' +
    'try{ netSnapshot(); } finally { netRelay=old; }' +
    'var seen={};' +
    'for(var i=0;i<grab.e.length;i++){ var info=netTypeOf(grab.e[i][1]);' +
    ' if(info.kind==="unit") seen[info.type]=1; }' +
    'return Object.keys(seen).sort();})()');
  const want = run('Object.keys(UDEF).sort()');
  eq(JSON.stringify(sent), JSON.stringify(want),
     'the snapshot carried every unit type that was on the field');
});

console.log('\nthe roster, rewritten per army');

function asArmy(f) {
  run('scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="' + f + '"');
  run('startGame("veteran")');
}

test('prose written in Allied names is rewritten into each army\'s own', () => {
  asArmy('legion');
  eq(run('facText("Train a Rifleman.")'), 'Train a Conscript.', 'a unit');
  eq(run('facText("Raise a Bunker.")'), 'Raise a Pillbox.', 'a building');
  asArmy('pact');
  eq(run('facText("Train a Rifleman.")'), 'Train a Gun Man.', 'a unit, militia');
});

test('irregular plurals survive the rewrite', () => {
  // 'Riflemen' shares no stem with 'Rifleman', so a bare +s rule mangles it,
  // and 'Pillbox'+'s' is not a word
  asArmy('legion');
  eq(run('facText("five Riflemen")'), 'five Conscripts', 'Riflemen');
  eq(run('facText("Bunkers can shoot air")'), 'Pillboxes can shoot air', 'Pillboxes');
  asArmy('pact');
  eq(run('facText("five Riflemen")'), 'five Gun Men', 'Riflemen, militia');
});

test('a name is never rewritten twice in one pass', () => {
  /* 'Gunners' became 'Scrap Gunners', and then the pass for the singular
     'Gunner' matched inside its own output: 'Scrap Scrap Gunners'. */
  asArmy('pact');
  eq(run('facText("Gunners hold the line")'), 'Scrap Gunners hold the line',
     'the replacement is not re-scanned');
  eq(run('facText("a Gunner")'), 'a Scrap Gunner', 'and the singular still works');
});

test('names that read the same singular or plural stay singular', () => {
  /* Nothing in the text says which was meant, and taking them as plural
     turned 'a Barracks' into 'a Drill Yards'. */
  asArmy('legion');
  eq(run('facText("Raise a Barracks.")'), 'Raise a Drill Yard.', 'Barracks');
  eq(run('facText("no Headquarters left")'), 'no Command Post left', 'Headquarters');
});

test('the article agrees with whatever name replaced it', () => {
  asArmy('pact');
  const out = run('facText("Raise a Bunker and a Barracks.")');
  ok(!/ a [aeiou]/i.test(out), 'no "a" left in front of a vowel: ' + out);
});

test('Allied text is left exactly as written', () => {
  asArmy('concord');
  const src = 'Train a Rifleman, then five Riflemen, at the Barracks.';
  eq(run('facText(' + JSON.stringify(src) + ')'), src, 'the base army needs no rewrite');
});

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ': ' + pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('\nfailures:');
  for (const f of failures) console.log('  - ' + f.name + ': ' + f.message);
}
process.exit(fail ? 1 : 0);
