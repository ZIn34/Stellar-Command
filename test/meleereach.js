/* Can a short-ranged unit actually reach a building, from every side?
   inRange treats a building as a circle of max(w,h)*0.42 around its centre,
   but buildings are rectangles, so the corners stick out further than the
   circle and a unit standing on one is "out of range" while touching it. */
const { loadGame } = require('./harness.js');
const g = loadGame();
const run = e => g.run(e);

run('scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord"');
run('startGame("veteran"); BOTS=[false,false,false,false]');
run('var k=ents.find(function(e){return !e.dead&&e.kind==="building"&&e.owner===0&&e.type==="keystone";})');
run('var B=mkBuilding("musterhall",1,k.x+700,k.y+700); B.done=true; B.prog=1');

const W = run('B.w'), H = run('B.h');
console.log('target ' + W + 'x' + H + '  circle used by inRange: r=' +
            run('hitRadius(B)').toFixed(1) + '  real half-extent: ' + (W / 2));

const spots = [
  ['left face',   -1,  0], ['right face',  1,  0],
  ['top face',     0, -1], ['bottom face', 0,  1],
  ['top-left',    -1, -1], ['top-right',   1, -1],
  ['bottom-left', -1,  1], ['bottom-right',1,  1]
];

for (const type of ['delver', 'breaker']) {
  const rng = run('UDEF.' + type + '.rng'), r = run('UDEF.' + type + '.r');
  console.log('\n' + type + '  (rng ' + rng + ', r ' + r + ')');
  for (const [name, sx, sy] of spots) {
    // stand it as close as a body can get: just outside the footprint
    const px = 'B.x+' + sx + '*(B.w/2+' + r + ')';
    const py = 'B.y+' + sy + '*(B.h/2+' + r + ')';
    run('var u=mkUnit("' + type + '",0,' + px + ',' + py + ')');
    const ok = run('inRange(u,B)');
    const edge = run('edgeDist(u,B)');
    console.log('  ' + name.padEnd(13) +
      (ok ? 'in range' : 'OUT OF RANGE') +
      '   (edge gap ' + edge.toFixed(1) + 'px, needs <= ' + rng + ')');
    run('u.dead=true');
  }
}
