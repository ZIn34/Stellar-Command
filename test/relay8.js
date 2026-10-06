/* Does the relay actually seat eight?

   Asked of the live one, hosting a room called ffa8 came back as mode "duel"
   with max 2 - it keeps its own list of modes and quietly answers with a duel
   for anything it has not heard of, so an eight-commander room silently
   became a 1v1. This drives the patched server directly: one host and seven
   guests join the same room, the host begins, and every client's start
   message is checked. */
const PORT = process.env.PORT || 8123;
const WS = 'ws://127.0.0.1:' + PORT;


/* No dependencies anywhere in this project, so the handshake is done by hand
   over a raw socket - the same thing the server speaks. */
const net = require('net');
const crypto = require('crypto');

function connect(onMsg) {
  return new Promise((res, rej) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(PORT, '127.0.0.1', () => {
      sock.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n' +
        'Connection: Upgrade\r\nSec-WebSocket-Key: ' + key +
        '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    let got = Buffer.alloc(0), up = false;
    sock.on('data', d => {
      got = Buffer.concat([got, d]);
      if (!up) {
        const i = got.indexOf('\r\n\r\n');
        if (i < 0) return;
        up = true; got = got.slice(i + 4); res(api);
      }
      // frames: server never masks, payloads here are small
      while (got.length >= 2) {
        const len0 = got[1] & 127;
        let off = 2, len = len0;
        if (len0 === 126) { len = got.readUInt16BE(2); off = 4; }
        else if (len0 === 127) { len = Number(got.readBigUInt64BE(2)); off = 10; }
        if (got.length < off + len) return;
        const body = got.slice(off, off + len).toString('utf8');
        got = got.slice(off + len);
        try { onMsg(JSON.parse(body)); } catch (e) {}
      }
    });
    sock.on('error', rej);
    const api = {
      send(o) {
        const b = Buffer.from(JSON.stringify(o), 'utf8');
        const mask = crypto.randomBytes(4);
        const head = b.length < 126
          ? Buffer.from([0x81, 0x80 | b.length])
          : Buffer.concat([Buffer.from([0x81, 0xFE]), (() => {
              const t = Buffer.alloc(2); t.writeUInt16BE(b.length); return t; })()]);
        const masked = Buffer.alloc(b.length);
        for (let i = 0; i < b.length; i++) masked[i] = b[i] ^ mask[i % 4];
        sock.write(Buffer.concat([head, mask, masked]));
      },
      close() { try { sock.destroy(); } catch (e) {} }
    };
  });
}

(async () => {
  const starts = [], rosters = [];
  let code = null;

  const host = await connect(m => {
    if (m.t === 'hosted') code = m.code;
    if (m.t === 'roster') rosters.push(m);
    if (m.t === 'start') starts.push(m);
  });
  host.send({ t: 'host', mode: 'ffa8', fac: 'concord', pub: false });
  await new Promise(r => setTimeout(r, 400));
  if (!code) { console.log('FAIL: no room'); process.exit(1); }

  const guests = [];
  for (let i = 0; i < 7; i++) {
    const g = await connect(m => { if (m.t === 'start') starts.push(m); });
    g.send({ t: 'join', code, fac: 'concord' });
    guests.push(g);
    await new Promise(r => setTimeout(r, 120));
  }
  await new Promise(r => setTimeout(r, 400));

  const last = rosters[rosters.length - 1] || {};
  console.log('room says: mode ' + last.mode + ', max ' + last.max + ', in ' + last.n);

  host.send({ t: 'begin', mode: 'ffa8', grand: false, scale: 'standard',
              terrain: 'ridge', seed: 4242 });
  await new Promise(r => setTimeout(r, 600));

  const ok = [];
  ok.push(['mode survives', last.mode === 'ffa8']);
  ok.push(['room seats eight', last.max === 8]);
  ok.push(['all eight joined', last.n === 8]);
  ok.push(['everyone got a start', starts.length === 8]);
  const slots = starts.map(s => s.slot).sort((a, b) => a - b);
  ok.push(['slots 0..7, one each', slots.join(',') === '0,1,2,3,4,5,6,7']);
  ok.push(['start names the mode', starts.every(s => s.mode === 'ffa8')]);
  ok.push(['count is eight', starts.every(s => s.count === 8)]);
  ok.push(['eight sides in a free-for-all',
           starts.every(s => new Set(s.teams.slice(0, 8)).size === 8)]);
  ok.push(['a doctrine per seat', starts.every(s => s.facs.length === 8)]);
  ok.push(['terrain travels', starts.every(s => s.terrain === 'ridge')]);

  let bad = 0;
  for (const [what, pass] of ok) { if (!pass) bad++; console.log((pass ? '  ok   ' : '  FAIL ') + what); }
  console.log(bad ? '\n' + bad + ' failed' : '\nall good');
  host.close(); guests.forEach(g => g.close());
  process.exit(bad ? 1 : 0);
})();
