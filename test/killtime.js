/* How long each difficulty takes to finish off a player who does nothing.
   The attention budget slowed bots down on purpose; this says by how much,
   and whether any setting has been slowed to the point of never closing. */
const { loadGame } = require('./harness.js');

function kill(d) {
  const g = loadGame();
  g.run('scaleKey="standard"; modeKey="duel"; terrainKey="open"; facKey="concord"');
  g.run('startGame("' + d + '"); setSeed(4242); init(); BOTS=[false,true,false,false]');
  for (let i = 0; i < 9000; i++) {
    g.run('simTick(0.1)');
    if (g.run('over')) return Math.round(g.run('gameTime'));
  }
  return null;
}
for (const d of ['recruit', 'veteran', 'warlord']) {
  const t = kill(d);
  console.log('  ' + d.padEnd(8) + (t === null ? 'never finished in 900s' : t + 's'));
}
