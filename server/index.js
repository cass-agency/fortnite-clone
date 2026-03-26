const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// ─── Constants ────────────────────────────────────────────────────────────────

const PLAYER_COLORS = [
  '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff',
  '#ff6bef', '#ff9a3c', '#6bffef', '#b66bff'
];

const SPAWN_POSITIONS = [
  { x: 10, y: 5, z: 10 }, { x: -10, y: 5, z: 10 },
  { x: 10, y: 5, z: -10 }, { x: -10, y: 5, z: -10 },
  { x: 20, y: 5, z: 0 }, { x: -20, y: 5, z: 0 },
  { x: 0, y: 5, z: 20 }, { x: 0, y: 5, z: -20 }
];

const WEAPON_CHEST_POSITIONS = [
  { x: 15, y: 1, z: 15 }, { x: -15, y: 1, z: 15 },
  { x: 15, y: 1, z: -15 }, { x: -15, y: 1, z: -15 },
  { x: 30, y: 1, z: 0 }, { x: -30, y: 1, z: 0 },
  { x: 0, y: 1, z: 30 }, { x: 0, y: 1, z: -30 },
  { x: 25, y: 1, z: -25 }, { x: -25, y: 1, z: 25 },
];

const WEAPON_TYPES = ['pistol', 'shotgun', 'sniper'];

const MATERIAL_HP = { wood: 150, stone: 300, metal: 450 };

// ─── Game state ───────────────────────────────────────────────────────────────

let colorIndex = 0;
let spawnIndex = 0;

const players = {};       // id -> player data
const placedBlocks = [];  // legacy terrain blocks

// Building blocks with HP: "x,y,z" -> { x, y, z, color, pieceType, material, rotation, hp, maxHp }
const buildBlocks = {};

// Weapon chests: id -> { id, x, y, z, weaponType, active }
const weaponChests = {};

// Init chests
WEAPON_CHEST_POSITIONS.forEach((pos, i) => {
  const id = `chest_${i}`;
  weaponChests[id] = {
    id,
    x: pos.x,
    y: pos.y,
    z: pos.z,
    weaponType: WEAPON_TYPES[i % WEAPON_TYPES.length],
    active: true,
  };
});

// Storm state
const stormState = {
  centerX: 0, centerZ: 0,
  radius: 200, targetRadius: 20,
  shrinkRate: 0.5,
  damagePerSecond: 5,
  nextShrinkIn: 30,
  phase: 0,
  shrinking: false,
};

// ─── Storm tick ───────────────────────────────────────────────────────────────

let lastStormTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt  = (now - lastStormTick) / 1000;
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
    if (stormState.nextShrinkIn <= 0) stormState.shrinking = true;
  }

  for (const [id, player] of Object.entries(players)) {
    if (player.isDead) continue;
    const dx = player.position.x - stormState.centerX;
    const dz = player.position.z - stormState.centerZ;
    if (Math.sqrt(dx * dx + dz * dz) > stormState.radius) {
      player.health -= stormState.damagePerSecond * dt;
      if (player.health < 0) player.health = 0;
      io.to(id).emit('stormDamage', { health: player.health });
      if (player.health <= 0) handlePlayerDeath(id, null);
    }
  }

  io.emit('stormUpdate', {
    radius: stormState.radius,
    centerX: stormState.centerX,
    centerZ: stormState.centerZ,
    nextShrinkIn: stormState.nextShrinkIn,
    shrinking: stormState.shrinking,
    phase: stormState.phase,
  });
}, 200);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function handlePlayerDeath(deadId, killerId) {
  const dead = players[deadId];
  if (!dead || dead.isDead) return;
  dead.isDead = true;
  const killer = killerId ? players[killerId] : null;
  const msg = killer
    ? `${killer.name} eliminated ${dead.name}`
    : `${dead.name} died in the storm`;
  io.emit('playerDied', { deadId, killerId, message: msg });
  console.log(`[DEATH] ${msg}`);
}

/**
 * Server-side hit validation.
 * Checks that origin is near the shooter's last-known position.
 */
function validateHit(shooter, data) {
  if (!shooter || !data.origin) return true; // allow if no data
  const sp = shooter.position;
  const dx = data.origin.x - sp.x;
  const dy = data.origin.y - sp.y;
  const dz = data.origin.z - sp.z;
  const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
  // Allow up to 10 units of difference (accounts for lag/third-person offset)
  return dist < 10;
}

// ─── Socket.io ───────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

  const color = PLAYER_COLORS[colorIndex++ % PLAYER_COLORS.length];
  const spawn = SPAWN_POSITIONS[spawnIndex++ % SPAWN_POSITIONS.length];
  const playerName = `Player${Math.floor(Math.random() * 9000) + 1000}`;

  players[socket.id] = {
    id: socket.id,
    name: playerName,
    color,
    position: { ...spawn },
    rotation: { y: 0 },
    health: 100,
    isDead: false,
  };

  // Send initial state
  socket.emit('init', {
    id: socket.id,
    players: Object.values(players),
    placedBlocks,
    buildBlocks: Object.values(buildBlocks),
    weaponChests: Object.values(weaponChests).filter(c => c.active),
    storm: stormState,
    name: playerName,
    color,
  });

  socket.broadcast.emit('playerJoined', players[socket.id]);

  // ── Position update
  socket.on('playerUpdate', (data) => {
    const player = players[socket.id];
    if (!player || player.isDead) return;
    player.position = data.position;
    player.rotation = data.rotation;
    socket.broadcast.emit('playerMoved', {
      id: socket.id,
      position: data.position,
      rotation: data.rotation,
    });
  });

  // ── Shoot
  socket.on('shoot', (data) => {
    const shooter = players[socket.id];
    if (!shooter || shooter.isDead) return;

    // Server-side validation
    if (!validateHit(shooter, data)) {
      console.warn(`[CHEAT] Invalid shot origin from ${socket.id}`);
      return;
    }

    if (data.targetId && players[data.targetId]) {
      const target = players[data.targetId];
      if (target.isDead) return;

      const dmg = Math.min(data.damage || 25, 100); // clamp max damage
      target.health = Math.max(0, target.health - dmg);

      io.to(data.targetId).emit('hit', {
        damage: dmg,
        health: target.health,
        shooterId: socket.id,
      });
      io.emit('hitEffect', {
        position: data.hitPosition || target.position,
        targetId: data.targetId,
      });
      if (target.health <= 0) handlePlayerDeath(data.targetId, socket.id);
    }

    // Also check if any building blocks were hit by the bullet
    if (data.hitPosition) {
      const hx = Math.round(data.hitPosition.x / 2) * 2;
      const hy = Math.round(data.hitPosition.y / 2) * 2;
      const hz = Math.round(data.hitPosition.z / 2) * 2;
      const bKey = `${hx},${hy},${hz}`;
      if (buildBlocks[bKey]) {
        const block = buildBlocks[bKey];
        const dmg = data.damage || 25;
        block.hp = Math.max(0, block.hp - dmg);
        io.emit('blockDamaged', { x: hx, y: hy, z: hz, hp: block.hp });
        if (block.hp <= 0) {
          delete buildBlocks[bKey];
          io.emit('blockDestroyed', { x: hx, y: hy, z: hz });
        }
      }
    }

    socket.broadcast.emit('playerShot', {
      id: socket.id,
      origin: data.origin,
      direction: data.direction,
    });
  });

  // ── Place building block
  socket.on('placeBlock', (data) => {
    const player = players[socket.id];
    if (!player) return;

    const material = data.material || 'wood';
    const maxHp    = MATERIAL_HP[material] || 150;

    const block = {
      x: data.x, y: data.y, z: data.z,
      color: player.color,
      pieceType: data.pieceType || 'wall',
      material,
      rotation: data.rotation || 0,
      hp: maxHp,
      maxHp,
      placedBy: socket.id,
    };

    const key = `${data.x},${data.y},${data.z}`;
    buildBlocks[key] = block;

    io.emit('buildBlockPlaced', block);
    console.log(`[BUILD] ${data.pieceType}/${material} at ${data.x},${data.y},${data.z}`);
  });

  // ── Legacy placeBlock (kept for compatibility)
  socket.on('placeBlockLegacy', (data) => {
    const block = {
      x: data.x, y: data.y, z: data.z,
      color: players[socket.id]?.color || '#8B4513',
      placedBy: socket.id,
    };
    placedBlocks.push(block);
    io.emit('blockPlaced', block);
  });

  // ── Damage a building block (client-triggered)
  socket.on('damageBlock', (data) => {
    const key = `${data.x},${data.y},${data.z}`;
    if (!buildBlocks[key]) return;
    const block = buildBlocks[key];
    block.hp = Math.max(0, block.hp - (data.damage || 25));
    io.emit('blockDamaged', { x: data.x, y: data.y, z: data.z, hp: block.hp });
    if (block.hp <= 0) {
      delete buildBlocks[key];
      io.emit('blockDestroyed', { x: data.x, y: data.y, z: data.z });
    }
  });

  // ── Weapon chest pickup
  socket.on('pickupChest', (data) => {
    const chest = weaponChests[data.id];
    if (!chest || !chest.active) return;
    chest.active = false;

    // Give weapon to player
    io.to(socket.id).emit('weaponPickedUp', {
      chestId: data.id,
      weaponType: chest.weaponType,
    });
    io.emit('chestRemoved', { id: data.id });

    // Respawn chest after 60 seconds with different weapon
    setTimeout(() => {
      chest.weaponType = WEAPON_TYPES[Math.floor(Math.random() * WEAPON_TYPES.length)];
      chest.active = true;
      io.emit('chestSpawned', chest);
    }, 60000);
  });

  // ── Respawn
  socket.on('respawn', () => {
    const player = players[socket.id];
    if (!player) return;
    const spawn = SPAWN_POSITIONS[Math.floor(Math.random() * SPAWN_POSITIONS.length)];
    player.position = { ...spawn };
    player.health = 100;
    player.isDead = false;
    socket.emit('respawned', { position: player.position, health: player.health });
    io.emit('playerRespawned', { id: socket.id, position: player.position });
  });

  // ── Disconnect
  socket.on('disconnect', () => {
    console.log(`[DISCONNECT] ${socket.id}`);
    delete players[socket.id];
    io.emit('playerLeft', { id: socket.id });
  });
});

server.listen(PORT, () => {
  console.log(`[SERVER] Voxel Battle Royale V2 running at http://localhost:${PORT}`);
});
