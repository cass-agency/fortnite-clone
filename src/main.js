import * as THREE from 'three';
import { io } from 'socket.io-client';
import { World } from './game/World.js';
import { Player } from './game/Player.js';
import { RemotePlayerManager } from './game/RemotePlayer.js';
import { Weapon } from './game/Weapon.js';
import { Builder } from './game/Builder.js';
import { HUD } from './game/HUD.js';
import { ThirdPersonCamera } from './game/ThirdPersonCamera.js';

// ─── Scene Setup ─────────────────────────────────────────────────────────────

const canvas = document.getElementById('game-canvas');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 80, 300);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.2);
sunLight.position.set(50, 100, 50);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 500;
sunLight.shadow.camera.left = -100;
sunLight.shadow.camera.right = 100;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
scene.add(sunLight);

const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x4a7c59, 0.4);
scene.add(hemiLight);

// ─── Socket.io ───────────────────────────────────────────────────────────────

const socket = io();

// ─── Game Modules ─────────────────────────────────────────────────────────────

const world = new World(scene);
const hud = new HUD();
const remotePlayerManager = new RemotePlayerManager(scene);
const thirdPersonCamera = new ThirdPersonCamera(camera);

let player = null;
let weapon = null;
let builder = null;

let gameStarted = false;
let localPlayerId = null;
let localPlayerColor = '#4d96ff';
let localPlayerName = 'Player';

// ─── Socket Events ───────────────────────────────────────────────────────────

socket.on('init', (data) => {
  localPlayerId = data.id;
  localPlayerColor = data.color;
  localPlayerName = data.name;

  for (const p of data.players) {
    if (p.id !== localPlayerId) remotePlayerManager.addPlayer(p);
  }

  // Legacy terrain blocks
  for (const block of data.placedBlocks || []) {
    world.addBlock(block.x, block.y, block.z, block.color);
  }

  // Building blocks (from previous sessions)
  for (const block of data.buildBlocks || []) {
    if (builder) builder.onBlockPlaced(block);
  }

  // Weapon chests
  for (const chest of data.weaponChests || []) {
    world.spawnChest(chest);
  }

  world.updateStorm(data.storm);
  hud.updateStorm(data.storm);

  console.log('[CLIENT] Initialized as', localPlayerId, 'color:', localPlayerColor);
});

socket.on('playerJoined', (data) => {
  if (data.id !== localPlayerId) {
    remotePlayerManager.addPlayer(data);
    hud.addKillMessage(`${data.name} joined the game`, '#4d96ff');
  }
  hud.updatePlayerCount(Object.keys(remotePlayerManager.players).length + 1);
});

socket.on('playerLeft', (data) => {
  remotePlayerManager.removePlayer(data.id);
  hud.updatePlayerCount(Object.keys(remotePlayerManager.players).length + 1);
});

socket.on('playerMoved', (data) => {
  if (data.id !== localPlayerId) {
    remotePlayerManager.updatePlayer(data.id, data.position, data.rotation);
  }
});

socket.on('hit', (data) => {
  if (player) {
    player.takeDamage(data.damage);
    hud.updateHealth(player.health);
    hud.showHitFlash();
    if (player.health <= 0) showDeathScreen();
  }
});

socket.on('stormDamage', (data) => {
  if (player) {
    player.health = data.health;
    hud.updateHealth(player.health);
    hud.showDamageWarning(true);
    if (player.health <= 0) showDeathScreen();
  }
});

socket.on('stormUpdate', (data) => {
  world.updateStorm(data);
  hud.updateStorm(data);
});

socket.on('playerDied', (data) => {
  remotePlayerManager.markDead(data.deadId);
  hud.addKillMessage(data.message, '#e74c3c');
  hud.updatePlayerCount(
    Object.keys(remotePlayerManager.getAlivePlayers()).length + (player && player.health > 0 ? 1 : 0)
  );
});

socket.on('playerRespawned', (data) => {
  remotePlayerManager.markAlive(data.id, data.position);
});

// Legacy block placement (terrain)
socket.on('blockPlaced', (data) => {
  world.addBlock(data.x, data.y, data.z, data.color);
});

// New building block events
socket.on('buildBlockPlaced', (data) => {
  if (builder) builder.onBlockPlaced(data);
});

socket.on('blockDamaged', (data) => {
  if (builder) builder.onBlockDamaged(data);
});

socket.on('blockDestroyed', (data) => {
  if (builder) builder.onBlockDamaged({ ...data, hp: 0 });
});

// Weapon chests
socket.on('chestSpawned', (data) => {
  world.spawnChest(data);
});

socket.on('chestRemoved', (data) => {
  world.removeChest(data.id);
});

socket.on('weaponPickedUp', (data) => {
  if (weapon) weapon.equipWeapon(data.weaponType);
});

socket.on('hitEffect', (data) => {
  world.createHitEffect(scene, data.position);
});

socket.on('playerShot', (data) => {
  world.createShotTrail(scene, data.origin, data.direction);
});

socket.on('respawned', (data) => {
  if (player) {
    player.position.copy(new THREE.Vector3(data.position.x, data.position.y, data.position.z));
    player.health = data.health;
    player.velocity.set(0, 0, 0);
    hud.updateHealth(player.health);
    document.getElementById('death-screen').style.display = 'none';
  }
});

// ─── Start Game ───────────────────────────────────────────────────────────────

function startGame() {
  gameStarted = true;
  document.getElementById('start-screen').style.display = 'none';

  player = new Player(scene, camera, localPlayerColor || '#4d96ff');
  weapon = new Weapon(scene, camera, player, socket, remotePlayerManager, hud);
  builder = new Builder(scene, player, socket, world, hud);

  canvas.requestPointerLock();

  hud.updateHealth(player.health);
  hud.updatePlayerCount(1);
}

document.getElementById('play-btn').addEventListener('click', startGame);

document.getElementById('respawn-btn').addEventListener('click', () => {
  socket.emit('respawn');
});

function showDeathScreen() {
  document.getElementById('death-screen').style.display = 'flex';
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (player) player.isPointerLocked = locked;
});

document.addEventListener('click', () => {
  if (gameStarted && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
  }
});

// ─── Resize ───────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── Game Loop ────────────────────────────────────────────────────────────────

const clock = new THREE.Clock();
let lastNetworkUpdate = 0;
const NETWORK_UPDATE_RATE = 1 / 20; // 20 Hz

const PICKUP_RADIUS = 2.5;

function gameLoop() {
  requestAnimationFrame(gameLoop);

  const delta   = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  if (gameStarted && player) {
    player.update(delta, world);
    weapon.update(delta);
    builder.update();

    // Third-person camera
    thirdPersonCamera.update(
      player.position,
      player.yaw,
      player.pitch,
      world.getCollidableMeshes()
    );

    // Network: send position at 20 Hz
    lastNetworkUpdate += delta;
    if (lastNetworkUpdate >= NETWORK_UPDATE_RATE) {
      lastNetworkUpdate = 0;
      socket.emit('playerUpdate', {
        position: { x: player.position.x, y: player.position.y, z: player.position.z },
        rotation: { y: player.yaw },
      });
    }

    // Storm damage indicator
    const dx = player.position.x - world.stormCenterX;
    const dz = player.position.z - world.stormCenterZ;
    hud.showDamageWarning(Math.sqrt(dx * dx + dz * dz) > world.stormRadius);

    // Weapon chest proximity pickup (E key or auto-pickup when very close)
    for (const [id, chestGroup] of world.getChests()) {
      const cp = chestGroup.position;
      const cdx = player.position.x - cp.x;
      const cdz = player.position.z - cp.z;
      if (Math.sqrt(cdx * cdx + cdz * cdz) < PICKUP_RADIUS) {
        socket.emit('pickupChest', { id });
        world.removeChest(id);
        break; // only one per frame
      }
    }
  }

  remotePlayerManager.update(delta, elapsed);
  world.update(elapsed);
  renderer.render(scene, camera);
}

gameLoop();
