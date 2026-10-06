/* Authors the built-in boards and prints them as share codes.

   The TERRAIN options used to be a rock count fed to the random generator,
   so "CHOKEPOINTS" meant 95 blobs scattered wherever. These are laid out
   instead: a shape per board, eight starts spaced evenly on a circle so
   every mode from a duel to an eight-way has somewhere to put everyone, and
   resources mirrored around that circle so no seat opens richer than
   another. Every board is validated with the game's own cmapProblem before
   it is printed.

   Run: node test/makemaps.js   then paste the output into BUILTIN_BOARDS. */
const { loadGame } = require('./harness.js');
const g = loadGame();

const TAU = Math.PI * 2;

function board(N) {
  return { N, rock: new Uint8Array(N * N), res: [], starts: [] };
}
const inB = (b, x, y) => x >= 1 && y >= 1 && x < b.N - 1 && y < b.N - 1;
function put(b, x, y) {
  x = Math.round(x); y = Math.round(y);
  if (inB(b, x, y)) b.rock[y * b.N + x] = 1;
}
function disc(b, cx, cy, r) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++)
      if (Math.hypot(x - cx, y - cy) <= r) put(b, x, y);
}
function clearDisc(b, cx, cy, r) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++)
      if (Math.hypot(x - cx, y - cy) <= r && inB(b, x, y)) b.rock[y * b.N + x] = 0;
}
function band(b, x0, y0, x1, y1, w) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(b, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w);
  }
}
function ring(b, cx, cy, r, w) {
  const steps = Math.ceil(TAU * r) * 2;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * TAU;
    disc(b, cx + Math.cos(a) * r, cy + Math.sin(a) * r, w);
  }
}
/* Eight seats on a circle, and the ground each one needs. A headquarters
   wants a clear patch; two supply patches and a fuel well sit just outside
   it, turned with the seat so every opening is the same one rotated. */
function seats(b, radius) {
  const c = (b.N - 1) / 2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2;
    const sx = Math.round(c + Math.cos(a) * radius);
    const sy = Math.round(c + Math.sin(a) * radius);
    b.starts.push([sx, sy]);
    clearDisc(b, sx, sy, 9);
    const inward = a + Math.PI;
    const at = (d, off) => [Math.round(sx + Math.cos(inward + off) * d),
                            Math.round(sy + Math.sin(inward + off) * d)];
    const [ax, ay] = at(11, -0.42), [bx, by] = at(11, 0.42), [vx, vy] = at(15, 0);
    for (const [k, x, y] of [['a', ax, ay], ['a', bx, by], ['v', vx, vy]]) {
      if (inB(b, x, y)) { b.res.push([k, x, y]); clearDisc(b, x, y, 3); }
    }
  }
}
/* Contested ground in the middle, the reason to leave home. */
function middle(b, radius, nA, nV) {
  const c = (b.N - 1) / 2;
  for (let i = 0; i < nA; i++) {
    const a = (i / nA) * TAU;
    const x = Math.round(c + Math.cos(a) * radius), y = Math.round(c + Math.sin(a) * radius);
    if (inB(b, x, y)) { b.res.push(['a', x, y]); clearDisc(b, x, y, 3); }
  }
  for (let i = 0; i < nV; i++) {
    const a = (i / nV) * TAU + Math.PI / nV;
    const x = Math.round(c + Math.cos(a) * radius * 0.55);
    const y = Math.round(c + Math.sin(a) * radius * 0.55);
    if (inB(b, x, y)) { b.res.push(['v', x, y]); clearDisc(b, x, y, 3); }
  }
}

const DESIGNS = [
  {
    key: 'bowl', n: 'OPEN BOWL', d: 'room to manoeuvre, rock only at the rim',
    build() {
      const b = board(128), c = 63.5;
      ring(b, c, c, 58, 2.5);            // a rim you fight inside of
      for (let i = 0; i < 8; i++) {      // broken, not a wall
        const a = (i / 8) * TAU + Math.PI / 8;
        clearDisc(b, c + Math.cos(a) * 58, c + Math.sin(a) * 58, 7);
      }
      seats(b, 44); middle(b, 17, 6, 2);
      return b;
    }
  },
  {
    key: 'ridge', n: 'RIDGELINE', d: 'one spine across the middle, two ways through',
    build() {
      const b = board(144), c = 71.5;
      band(b, 14, 30, 130, 114, 4.5);    // the spine, corner to corner
      clearDisc(b, c - 26, c - 19, 11);  // and the gaps either side of centre
      clearDisc(b, c + 26, c + 19, 11);
      seats(b, 52); middle(b, 19, 6, 2);
      return b;
    }
  },
  {
    key: 'cross', n: 'FOUR BASINS', d: 'quartered by rock, open in the centre',
    build() {
      const b = board(144), c = 71.5;
      band(b, c, 10, c, 134, 4);
      band(b, 10, c, 134, c, 4);
      clearDisc(b, c, c, 20);            // the crossroads everyone wants
      seats(b, 52); middle(b, 13, 4, 2);
      return b;
    }
  },
  {
    key: 'ring', n: 'THE REDOUBT', d: 'a walled plateau in the middle, four ways in',
    build() {
      const b = board(144), c = 71.5;
      ring(b, c, c, 26, 3.5);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        clearDisc(b, c + Math.cos(a) * 26, c + Math.sin(a) * 26, 8);
      }
      seats(b, 54); middle(b, 15, 4, 2);
      return b;
    }
  },
  {
    key: 'lanes', n: 'CORRIDORS', d: 'rock bands and lanes, flanks cost time',
    build() {
      const b = board(144), c = 71.5;
      for (const x of [34, 71.5, 109]) {
        band(b, x, 20, x, 124, 3.5);
        clearDisc(b, x, c - 34, 9);      // a way through, high and low
        clearDisc(b, x, c + 34, 9);
      }
      seats(b, 54); middle(b, 16, 4, 2);
      return b;
    }
  },
  {
    key: 'river', n: 'THE CROSSINGS', d: 'a broad divide with three bridges',
    build() {
      const b = board(160), c = 79.5;
      band(b, 16, c - 8, 144, c + 8, 7);
      for (const t of [0.25, 0.5, 0.75]) clearDisc(b, 16 + 128 * t, c, 11);
      seats(b, 58); middle(b, 22, 6, 2);
      return b;
    }
  }
];

const out = [];
for (const dz of DESIGNS) {
  const b = dz.build();
  // through the game's own encoder, so the code is the real thing
  g.run('var __r=' + JSON.stringify(Array.from(b.rock)));
  g.run('var __n=' + b.N);
  const packed = g.run('cmapPackRock(new Uint8Array(__r),__n,__n)');
  const map = {
    w: b.N, h: b.N, starts: b.starts, rock: packed,
    res: b.res, blds: [], name: dz.n, rules: {}
  };
  const problem = g.run('cmapProblem(' + JSON.stringify(map) + ')');
  if (problem) { console.log('REJECTED ' + dz.n + ': ' + problem); continue; }
  const code = g.run('cmapEncode(' + JSON.stringify(map) + ')');
  const back = g.run('cmapDecode(' + JSON.stringify(code) + ')');
  if (back.err) { console.log('ROUND TRIP FAILED ' + dz.n + ': ' + back.err); continue; }
  const notes = g.run('cmapNotes(' + JSON.stringify(map) + ')');
  let rocks = 0; for (const v of b.rock) if (v) rocks++;
  out.push({ key: dz.key, n: dz.n, d: dz.d, code });
  console.log(dz.n.padEnd(14) + b.N + 'x' + b.N +
    '  starts ' + b.starts.length + '  res ' + b.res.length +
    '  rock ' + (rocks / (b.N * b.N) * 100).toFixed(1) + '%' +
    '  code ' + code.length + 'ch' +
    (notes.length ? '  notes: ' + notes.join('; ') : ''));
}

console.log('\n----- paste into BUILTIN_BOARDS -----');
console.log(out.map(o =>
  "  " + o.key + ":{n:'" + o.n + "', d:'" + o.d + "',\n    code:'" + o.code + "'}"
).join(',\n'));
