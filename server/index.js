const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Serve static files from dist folder in production
app.use(express.static(path.join(__dirname, '../dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// ─── Game State ──────────────────────────────────────────────────────────────

const PLAYER_COLORS = [
  '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff',
  '#ff6bef', '#ff9a3c', '#6bffef', '#b66bff'
];

const SPAWN_POSITIONS = [
  { x: 10, y: 5, z: 10 },
  { x: -10, y: 5, z: 10 },
  { x: 10, y: 5, z: -10 },
  { x: -10, y: 5, z: -10 },
  { x: 20, y: 5, z: 0 },
  { x: -20, y: 5, z: 0 },
  { x: 0, y: 5, z: 20 },
  { x: 0, y: 5, z: -20 }
];

let colorIndex = 0;
let spawnIndex = 0;

const players = {}; // id -> player data
const placedBlocks = []; // shared world blocks

// Storm state
const stormState = {
  centerX: 0,
  centerZ: 0,
  radius: 200,
  targetRadius: 20,
  shrinkRate: 0.5, // units per second
  damagePerSecond: 5,
  nextShrinkIn: 30, // seconds until next shrink phase
  phase: 0,
  shrinking: false
};

// Storm tick
let lastStormTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastStormTick) / 1000;
  lastStormTick = now;

  if (stormState.shrinking) {
    stormState.radius = Math.max(stormState.targetRadius, stormState.radius - stormState.shrinkRate * dt);
    if (stormState.radius <= stormState.targetRadius) {
      stormState.shrinking = false;
      stormState.nextShrinkIn = 30;
      stormState.phase++;
      stormState.targetRadius = Math.max(5, stormState.targetRadius - 15);
    }
  } else {
    stormState.nextShrinkIn -= dt;
    if (stormState.nextShrinkIn <= 0) {
      stormState.shrinking = true;
    }
  }

  // Apply storm damage to players outside
  for (const [id, player] of Object.entries(players)) {
    const dx = player.position.x - stormState.centerX;
    const dz = player.position.z - stormState.centerZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > stormState.radius) {
      player.health -= stormState.damagePerSecond * dt;
      if (player.health < 0) player.health = 0;
      io.to(id).emit('stormDamage', { health: player.health });
      if (player.health <= 0) {
        handlePlayerDeath(id, null);
      }
    }
  }

  // Broadcast storm state
  io.emit('stormUpdate', {
    radius: stormState.radius,
    centerX: stormState.centerX,
    centerZ: stormState.centerZ,
    nextShrinkIn: stormState.nextShrinkIn,
    shrinking: stormState.shrinking,
    phase: stormState.phase
  });
}, 200);

// ─── Socket.io Events ────────────────────────────────────────────────────────

function handlePlayerDeath(deadId, killerId) {
  const dead = players[deadId];
  if (!dead || dead.isDead) return;
  dead.isDead = true;

  const killer = killerId ? players[killerId] : null;
  const msg = killer
    ? `${killer.name} eliminated ${dead.name}`
    : `${dead.name} died in the storm`;

  io.emit('playerDied', {
    deadId,
    killerId,
    message: msg
  });

  console.log(`[DEATH] ${msg}`);
}

io.on('connection', (socket) => {
  console.log(`[CONNECT] Player connected: ${socket.id}`);

  // Assign color and spawn
  const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
  colorIndex++;
  const spawn = SPAWN_POSITIONS[spawnIndex % SPAWN_POSITIONS.length];
  spawnIndex++;

  const playerName = `Player${Math.floor(Math.random() * 9000) + 1000}`;

  players[socket.id] = {
    id: socket.id,
    name: playerName,
    color,
    position: { ...spawn },
    rotation: { y: 0 },
    health: 100,
    isDead: false
  };

  // Send initial state to the new player
  socket.emit('init', {
    id: socket.id,
    players: Object.values(players),
    placedBlocks,
    storm: stormState,
    name: playerName,
    color
  });

  // Notify others
  socket.broadcast.emit('playerJoined', players[socket.id]);

  // ── Player position/rotation update
  socket.on('playerUpdate', (data) => {
    const player = players[socket.id];
    if (!player || player.isDead) return;
    player.position = data.position;
    player.rotation = data.rotation;
    socket.broadcast.emit('playerMoved', {
      id: socket.id,
      position: data.position,
      rotation: data.rotation
    });
  });

  // ── Shoot event
  socket.on('shoot', (data) => {
    const shooter = players[socket.id];
    if (!shooter || shooter.isDead) return;

    // data: { targetId, damage, origin, direction }
    if (data.targetId && players[data.targetId]) {
      const target = players[data.targetId];
      if (target.isDead) return;

      target.health -= data.damage || 25;
      if (target.health < 0) target.health = 0;

      // Tell the target they got hit
      io.to(data.targetId).emit('hit', {
        damage: data.damage || 25,
        health: target.health,
        shooterId: socket.id
      });

      // Broadcast hit effect to all
      io.emit('hitEffect', {
        position: data.hitPosition || target.position,
        targetId: data.targetId
      });

      if (target.health <= 0) {
        handlePlayerDeath(data.targetId, socket.id);
      }
    }

    // Broadcast shot visual
    socket.broadcast.emit('playerShot', {
      id: socket.id,
      origin: data.origin,
      direction: data.direction
    });
  });

  // ── Build event
  socket.on('placeBlock', (data) => {
    // data: { x, y, z, color }
    const block = {
      x: data.x,
      y: data.y,
      z: data.z,
      color: players[socket.id]?.color || '#8B4513',
      placedBy: socket.id
    };
    placedBlocks.push(block);

    // Broadcast to all players
    io.emit('blockPlaced', block);
    console.log(`[BUILD] Block placed at ${data.x},${data.y},${data.z}`);
  });

  // ── Respawn
  socket.on('respawn', () => {
    const player = players[socket.id];
    if (!player) return;
    const spawn = SPAWN_POSITIONS[Math.floor(Math.random() * SPAWN_POSITIONS.length)];
    player.position = { ...spawn };
    player.health = 100;
    player.isDead = false;

    socket.emit('respawned', {
      position: player.position,
      health: player.health
    });
    io.emit('playerRespawned', {
      id: socket.id,
      position: player.position
    });
  });

  // ── Disconnect
  socket.on('disconnect', () => {
    console.log(`[DISCONNECT] Player disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerLeft', { id: socket.id });
  });
});

server.listen(PORT, () => {
  console.log(`[SERVER] Voxel Battle Royale running at http://localhost:${PORT}`);
});
