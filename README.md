# Voxel Royale

A browser-based voxel battle royale game (Fortnite-inspired clone) built with Three.js, Socket.io, and Vite.

## Features

- 3D voxel world rendered with Three.js
- First-person camera with pointer lock
- WASD movement, spacebar jump, shift sprint
- Shrinking storm zone that damages players outside it
- Pistol weapon with raycast hit detection (25 HP per hit)
- Building system: enter build mode with B or right-click, place walls with left-click
- Real-time multiplayer via Socket.io WebSockets
- Players have unique colors and names visible as name tags
- HUD: health bar, storm timer, player count, crosshair, ammo counter, kill feed
- Death and respawn system

## Requirements

- Node.js 18+
- npm 8+

## Installation

```bash
npm install
```

## Running

### Development mode (Vite dev server + Node server)

```bash
npm run dev
```

- Game client: http://localhost:5173 (Vite dev server with HMR)
- Server: http://localhost:3000

### Production mode

```bash
npm run build
npm start
```

Game available at: http://localhost:3000

## Controls

| Action | Key |
|--------|-----|
| Move | W A S D |
| Jump | Space |
| Sprint | Shift |
| Look | Mouse |
| Shoot | Left Click |
| Build mode | B or Right Click |
| Place block | Left Click (in build mode) |
| Reload | R |
| Unlock mouse | ESC |

## Architecture

```
fortnite-clone/
├── server/
│   └── index.js          # Express + Socket.io multiplayer server
├── src/
│   ├── main.js            # Entry point: Three.js scene, socket events, game loop
│   └── game/
│       ├── World.js       # Voxel terrain, storm zone, environment
│       ├── Player.js      # Local player: movement, camera, AABB physics
│       ├── RemotePlayer.js # Remote players: mesh, interpolation, name tags
│       ├── Weapon.js      # Raycast shooting, ammo, hit detection
│       ├── Builder.js     # Build mode, block placement
│       └── HUD.js         # DOM overlay: health, storm, crosshair, kill feed
├── index.html             # Game shell + HUD markup
├── vite.config.js         # Vite config with Socket.io proxy
└── package.json
```

## Game Design

### World
- 64×64 voxel grid terrain with procedural height variation
- Trees, rocks, and environmental features
- Storm zone: purple/red shrinking cylinder that damages players outside it

### Multiplayer
- Players connect via Socket.io
- Position/rotation broadcast at 20Hz
- Server authoritative: health, damage, death, respawn
- Each player gets a unique color from a palette

### Storm Phases
- Storm starts at radius 200, shrinks toward center
- Each phase: 30s wait, then shrinks to a smaller radius
- 5 HP/s damage outside the zone

## License

MIT
