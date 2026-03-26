import * as THREE from 'three';

const BLOCK_SIZE = 2;
const PLACE_DISTANCE = 6;

// ─── Piece types ─────────────────────────────────────────────────────────────

function createWallGeometry() {
  return new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, 0.25);
}

function createFloorGeometry() {
  return new THREE.BoxGeometry(BLOCK_SIZE, 0.25, BLOCK_SIZE);
}

function createRampGeometry() {
  // Triangular prism: slope from back-bottom to front-top
  const geo = new THREE.BufferGeometry();
  const s = BLOCK_SIZE;

  const verts = new Float32Array([
    // front-bottom-left  0
    -s/2, -s/2, s/2,
    // front-bottom-right 1
     s/2, -s/2, s/2,
    // back-bottom-left   2
    -s/2, -s/2, -s/2,
    // back-bottom-right  3
     s/2, -s/2, -s/2,
    // back-top-left      4
    -s/2,  s/2, -s/2,
    // back-top-right     5
     s/2,  s/2, -s/2,
  ]);

  const indices = [
    // bottom
    0, 3, 1,   0, 2, 3,
    // back wall
    2, 4, 5,   2, 5, 3,
    // slope (top)
    0, 1, 5,   0, 5, 4,
    // left triangle
    0, 4, 2,
    // right triangle
    1, 3, 5,
  ];

  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createPyramidGeometry() {
  const geo = new THREE.CylinderGeometry(0, BLOCK_SIZE * 0.707, BLOCK_SIZE, 4, 1);
  geo.rotateY(Math.PI / 4); // align to grid axes
  return geo;
}

const PIECE_TYPES = ['wall', 'floor', 'ramp', 'pyramid'];
const PIECE_LABELS = { wall: 'Wall', floor: 'Floor', ramp: 'Ramp', pyramid: 'Pyramid' };

function buildGeometry(type) {
  switch (type) {
    case 'wall':    return createWallGeometry();
    case 'floor':   return createFloorGeometry();
    case 'ramp':    return createRampGeometry();
    case 'pyramid': return createPyramidGeometry();
    default:        return createWallGeometry();
  }
}

// ─── Materials ───────────────────────────────────────────────────────────────

const MATERIALS = [
  { id: 'wood',  name: 'Wood',  maxHp: 150, color: 0x8B5E3C },
  { id: 'stone', name: 'Stone', maxHp: 300, color: 0x888888 },
  { id: 'metal', name: 'Metal', maxHp: 450, color: 0x607080 },
];

// ─── Builder class ───────────────────────────────────────────────────────────

export class Builder {
  constructor(scene, player, socket, world, hud) {
    this.scene = scene;
    this.player = player;
    this.socket = socket;
    this.world = world;
    this.hud = hud;

    this.buildMode = false;
    this.pieceIndex = 0;   // current piece type index
    this.matIndex = 0;     // current material index
    this.previewRotation = 0; // Y rotation of preview (scroll-to-rotate)

    this.previewMesh = null;
    this.previewEdges = null;
    this.raycaster = new THREE.Raycaster();

    // Track placed building blocks with HP: key -> { mesh, hp, maxHp, hpBar }
    this.buildingBlocks = new Map();

    this._buildPreviewMesh();
    this._setupInputListeners();
  }

  _buildPreviewMesh() {
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
    }

    const type = PIECE_TYPES[this.pieceIndex];
    const mat  = MATERIALS[this.matIndex];

    const geo = buildGeometry(type);
    const material = new THREE.MeshBasicMaterial({
      color: 0x0088ff,      // blue overlay
      transparent: true,
      opacity: 0.45,
    });
    this.previewMesh = new THREE.Mesh(geo, material);
    this.previewMesh.visible = false;
    this.previewMesh.rotation.y = this.previewRotation;

    // Wireframe edge overlay
    const edgesGeo = new THREE.EdgesGeometry(geo);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x44aaff });
    const edges = new THREE.LineSegments(edgesGeo, edgesMat);
    this.previewMesh.add(edges);
    this.previewEdges = edges;

    this.scene.add(this.previewMesh);
  }

  _setupInputListeners() {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyB') this.toggleBuildMode();

      // Cycle piece type with Q
      if (e.code === 'KeyQ' && this.buildMode) {
        this.pieceIndex = (this.pieceIndex + 1) % PIECE_TYPES.length;
        this._buildPreviewMesh();
        this.previewMesh.visible = true;
        this._updateBuildHUD();
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.player.isPointerLocked) return;

      if (e.button === 2) {
        this.toggleBuildMode();
        e.preventDefault();
      }
      if (e.button === 0 && this.buildMode) {
        this._placeBlock();
      }
    });

    // Scroll in build mode: rotate piece or change material
    document.addEventListener('wheel', (e) => {
      if (!this.buildMode) return;
      if (e.shiftKey) {
        // Shift+Scroll: change material
        if (e.deltaY > 0) {
          this.matIndex = (this.matIndex + 1) % MATERIALS.length;
        } else {
          this.matIndex = (this.matIndex - 1 + MATERIALS.length) % MATERIALS.length;
        }
        this._buildPreviewMesh();
        this.previewMesh.visible = true;
      } else {
        // Scroll: rotate piece
        this.previewRotation += e.deltaY > 0 ? Math.PI / 2 : -Math.PI / 2;
        if (this.previewMesh) this.previewMesh.rotation.y = this.previewRotation;
      }
      this._updateBuildHUD();
    });

    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _updateBuildHUD() {
    const type = PIECE_TYPES[this.pieceIndex];
    const mat  = MATERIALS[this.matIndex];
    const el = document.getElementById('build-mode-detail');
    if (el) el.textContent = `${PIECE_LABELS[type]} | ${mat.name} (${mat.maxHp} HP)`;
  }

  toggleBuildMode() {
    this.buildMode = !this.buildMode;
    this.previewMesh.visible = this.buildMode;
    this.hud.setBuildMode(this.buildMode);
    if (this.buildMode) this._updateBuildHUD();
    else {
      const el = document.getElementById('build-mode-detail');
      if (el) el.textContent = '';
    }
  }

  _getPlacementTransform() {
    const origin    = this.player.getEyePosition();
    const direction = this.player.getLookDirection();

    this.raycaster.set(origin, direction);
    this.raycaster.far = PLACE_DISTANCE;

    const collidables = this.world.getCollidableMeshes();
    const hits = this.raycaster.intersectObjects(collidables, false);

    let pos, rotation;

    if (hits.length > 0) {
      const hit = hits[0];
      const normal = hit.face?.normal?.clone() || new THREE.Vector3(0, 1, 0);
      normal.transformDirection(hit.object.matrixWorld);

      pos = hit.point.clone().add(normal.clone().multiplyScalar(BLOCK_SIZE / 2));
    } else {
      pos = origin.clone().add(direction.clone().multiplyScalar(PLACE_DISTANCE));
    }

    // Snap to grid
    pos.x = Math.round(pos.x / BLOCK_SIZE) * BLOCK_SIZE;
    pos.y = Math.round(pos.y / BLOCK_SIZE) * BLOCK_SIZE;
    pos.z = Math.round(pos.z / BLOCK_SIZE) * BLOCK_SIZE;

    // Adjust y for floor pieces (they sit on top of the grid line)
    const type = PIECE_TYPES[this.pieceIndex];
    if (type === 'floor') {
      pos.y = Math.max(0.125, pos.y);
    }

    return pos;
  }

  _placeBlock() {
    const pos = this._getPlacementTransform();
    if (!pos) return;

    // Check not placing inside player
    const px = this.player.position;
    if (Math.abs(pos.x - px.x) < 1.5 &&
        Math.abs(pos.y - px.y - 0.9) < 2 &&
        Math.abs(pos.z - px.z) < 1.5) return;

    const type = PIECE_TYPES[this.pieceIndex];
    const mat  = MATERIALS[this.matIndex];

    this.socket.emit('placeBlock', {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      color: '#' + new THREE.Color(mat.color).getHexString(),
      pieceType: type,
      material: mat.id,
      rotation: this.previewRotation,
    });

    // Add locally immediately
    this._addBuildingBlock({
      x: pos.x, y: pos.y, z: pos.z,
      color: '#' + new THREE.Color(mat.color).getHexString(),
      pieceType: type,
      material: mat.id,
      rotation: this.previewRotation,
      hp: mat.maxHp,
      maxHp: mat.maxHp,
    });
  }

  _addBuildingBlock(data) {
    const key = `${data.x},${data.y},${data.z}`;
    if (this.buildingBlocks.has(key)) return;

    const mat = MATERIALS.find(m => m.id === data.material) || MATERIALS[0];
    const geo = buildGeometry(data.pieceType || 'wall');
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({ color: new THREE.Color(data.color) })
    );
    mesh.position.set(data.x, data.y, data.z);
    mesh.rotation.y = data.rotation || 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'placed_block';

    this.scene.add(mesh);
    this.world.registerBuildingBlock(mesh);

    // HP bar (canvas-based sprite above block)
    const hpBar = this._createHPBar(data.hp, data.maxHp);
    hpBar.position.set(data.x, data.y + BLOCK_SIZE * 0.75, data.z);
    this.scene.add(hpBar);

    this.buildingBlocks.set(key, {
      mesh, hpBar,
      hp: data.hp,
      maxHp: data.maxHp,
    });
  }

  _createHPBar(hp, maxHp) {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 20;
    const ctx = canvas.getContext('2d');
    const pct = hp / maxHp;
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, 128, 20);
    ctx.fillStyle = pct > 0.5 ? '#2ecc71' : pct > 0.25 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(2, 2, (128 - 4) * pct, 16);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.5, 0.25, 1);
    sprite.name = 'hp_bar';
    return sprite;
  }

  _updateHPBar(blockData) {
    const { hpBar, hp, maxHp } = blockData;
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 20;
    const ctx = canvas.getContext('2d');
    const pct = Math.max(0, hp) / maxHp;
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, 128, 20);
    ctx.fillStyle = pct > 0.5 ? '#2ecc71' : pct > 0.25 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(2, 2, (128 - 4) * pct, 16);
    hpBar.material.map.dispose();
    hpBar.material.map = new THREE.CanvasTexture(canvas);
    hpBar.material.map.needsUpdate = true;
  }

  /**
   * Called when server broadcasts that a block was damaged/destroyed.
   */
  onBlockDamaged(data) {
    const key = `${data.x},${data.y},${data.z}`;
    const blockData = this.buildingBlocks.get(key);
    if (!blockData) return;

    blockData.hp = data.hp;
    this._updateHPBar(blockData);

    if (data.hp <= 0) {
      this._destroyBlock(key, blockData);
    }
  }

  _destroyBlock(key, blockData) {
    this.scene.remove(blockData.mesh);
    this.scene.remove(blockData.hpBar);
    blockData.mesh.geometry.dispose();
    blockData.hpBar.material.map.dispose();
    this.world.unregisterBuildingBlock(blockData.mesh);
    this.buildingBlocks.delete(key);

    // Rubble debris particles
    const pos = blockData.mesh.position.clone();
    this._spawnRubble(pos);
  }

  _spawnRubble(pos) {
    const count = 8;
    const rubbleMat = new THREE.MeshLambertMaterial({ color: 0x888866 });
    for (let i = 0; i < count; i++) {
      const size = 0.15 + Math.random() * 0.2;
      const geo  = new THREE.BoxGeometry(size, size, size);
      const mesh = new THREE.Mesh(geo, rubbleMat);
      mesh.position.copy(pos);
      mesh.position.x += (Math.random() - 0.5) * BLOCK_SIZE;
      mesh.position.y += (Math.random() - 0.5) * BLOCK_SIZE * 0.5;
      mesh.position.z += (Math.random() - 0.5) * BLOCK_SIZE;
      this.scene.add(mesh);

      // Remove rubble after 3 seconds
      setTimeout(() => {
        this.scene.remove(mesh);
        geo.dispose();
      }, 3000);
    }
  }

  /**
   * Handle blockPlaced event from server (for non-local placements).
   */
  onBlockPlaced(data) {
    const mat = MATERIALS.find(m => m.id === data.material) || MATERIALS[0];
    this._addBuildingBlock({
      ...data,
      hp: mat.maxHp,
      maxHp: mat.maxHp,
    });
  }

  update() {
    if (!this.buildMode) return;

    const pos = this._getPlacementTransform();
    if (pos) {
      this.previewMesh.position.copy(pos);
      this.previewMesh.visible = true;
    } else {
      this.previewMesh.visible = false;
    }
  }
}
