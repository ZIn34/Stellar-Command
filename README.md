# Stellar Command

A real-time strategy game that runs in the browser. One self-contained HTML file for
the game itself, plus a small zero-dependency Node server for online play and assets.

![theatre](https://img.shields.io/badge/engine-vanilla%20JS-4bd6ff) ![deps](https://img.shields.io/badge/dependencies-none-35d18a)

## Play

```bash
node server.js
```

Then open <http://localhost:8080>. Others on your network join at `http://<your-ip>:8080`.

You can also open `stellar-command.html` directly, but the theme music, the recorded
sound effects and online play all need the file to be served, so the server is the way to go.

## The war

**Azure Concord** (you) against the **Ember Legion**. Harvest **aurite** from crystal
seams and **ichor** from vents, raise a base, and destroy everything the other side owns.

### Units

| Unit | From | Cost | Role |
|---|---|---|---|
| Delver | Keystone | 50 | Harvests, builds every structure |
| Warden | Muster Hall | 50 | Ranged infantry, the backbone |
| Bulwark | Muster Hall | 200 | Exactly double a Warden in HP, damage, attack speed and move speed |
| Sunderer | Forgeworks | 125 + 50 | Long-range artillery with splash |
| Harrower | Forgeworks | 150 + 75 | Assault walker: brutal up close, very hard to kill |

### Structures

Keystone (command hub, +10 pop) · Habitat (+8 pop) · Muster Hall · Siphon (built on a
vent for ichor) · Forgeworks · Watchspire (automated defence)

Destroying enemy units pays a **salvage bounty** — 20% of a unit's cost, 15% of a building's.

## Controls

| | |
|---|---|
| Select | Left-drag a box, or click. `F2` selects your whole army |
| Orders | Right-click to move, attack, harvest or resume construction |
| Attack-move | `A` then click |
| Build | `B`, pick a structure, click to place |
| Camera | Arrow keys, screen edges, mouse wheel to zoom, or drag the minimap |
| Groups | `Ctrl+1-9` to set, `1-9` to recall |
| Pause | `Esc` or the button top-left |

On touch devices: drag to pan, pinch to zoom, tap to select, tap the ground to order,
hold-then-drag to box select. Landscape only; installable as a PWA.

## Modes

- **Theatres** — Recruit, Veteran, Warlord. The Legion's troops are individually tougher
  than yours at every level, so win with numbers, position and tech.
- **Grand War** — ten times the map, seven times the income and build speed. Combat still
  runs at normal pace, so battles stay readable while armies get enormous.
- **Online** — Quick Play, or host and share a four-digit code. Host-authoritative
  netcode: the host simulates, the guest sends orders and renders snapshots.

## The enemy

The Legion plays with the same information you have. It only knows what it has actually
seen, sends a scout to find you, masses its army before committing, focuses fire, pulls
workers to defend its base, retreats when a fight turns, and expands when it is ahead.

## Layout

```
stellar-command.html   the entire game
server.js              lobby + relay + static server, zero dependencies
sfx.json               which sound files exist
*.wav                  18 sound effects
theme.mp4              theme music
tools/                 offline sound-design helpers
```

## Audio

Swap any sound by dropping a file named after it (`rifle.wav`, `boom.wav`, ...) beside the
game and listing it in `sfx.json`. Anything missing falls back to a synthesised version
built into the game. Replace `theme.mp4` with your own track to change the music.
