import * as THREE from 'three';

const BLOCK_SIZE = 2;
const PLACE_DISTANCE = 5;

export class Builder {
  constructor(scene, player, socket, world, hud) {
    this.scene = scene;
    this.player = player;
    this.socket = socket;
    this.world = world;
    this.hud = hud;

    this.buildMode = false;
    this.previewMesh = null;
    this.raycaster = new THREE.Raycaster();

    this._buildPreviewMesh();
    this._setupInputListeners();
  }

  _buildPreviewMesh() {
    const geo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.4,
      wireframe: false
    });
    this.previewMesh = new THREE.Mesh(geo, mat);
    this.previewMesh.visible = false;

    // Wireframe overlay
    const edgesGeo = new THREE.EdgesGeometry(geo);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x00ff88 });
    const edges = new THREE.LineSegments(edgesGeo, edgesMat);
    this.previewMesh.add(edges);

    this.scene.add(this.previewMesh);
  }

  _setupInputListeners() {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyB') {
        this.toggleBuildMode();
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.player.isPointerLocked) return;

      if (e.button === 2) {
        // Right click: toggle build mode
        this.toggleBuildMode();
        e.preventDefault();
      }

      if (e.button === 0 && this.buildMode) {
        // Left click in build mode: place block
        this._placeBlock();
      }
    });

    // Prevent context menu
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  toggleBuildMode() {
    this.buildMode = !this.buildMode;
    this.previewMesh.visible = this.buildMode;
    this.hud.setBuildMode(this.buildMode);
  }

  _getPlacementPosition() {
    const origin = this.player.getEyePosition();
    const direction = this.player.getLookDirection();

    this.raycaster.set(origin, direction);
    this.raycaster.far = PLACE_DISTANCE;

    const collidables = this.world.getCollidableMeshes();
    const hits = this.raycaster.intersectObjects(collidables, false);

    if (hits.length > 0) {
      const hit = hits[0];
      // Place block on face normal
      const normal = hit.face?.normal?.clone() || new THREE.Vector3(0, 1, 0);
      normal.transformDirection(hit.object.matrixWorld);

      const pos = hit.point.clone().add(normal.clone().multiplyScalar(BLOCK_SIZE / 2));

      // Snap to grid
      pos.x = Math.round(pos.x / BLOCK_SIZE) * BLOCK_SIZE;
      pos.y = Math.round(pos.y / BLOCK_SIZE) * BLOCK_SIZE;
      pos.z = Math.round(pos.z / BLOCK_SIZE) * BLOCK_SIZE;

      return pos;
    } else {
      // Place block in front of player
      const pos = origin.clone().add(direction.clone().multiplyScalar(PLACE_DISTANCE));
      pos.x = Math.round(pos.x / BLOCK_SIZE) * BLOCK_SIZE;
      pos.y = Math.round(pos.y / BLOCK_SIZE) * BLOCK_SIZE;
      pos.z = Math.round(pos.z / BLOCK_SIZE) * BLOCK_SIZE;
      return pos;
    }
  }

  _placeBlock() {
    const pos = this._getPlacementPosition();
    if (!pos) return;

    // Check not placing inside player
    const playerPos = this.player.position;
    const dx = Math.abs(pos.x - playerPos.x);
    const dy = Math.abs(pos.y - playerPos.y - 0.9);
    const dz = Math.abs(pos.z - playerPos.z);

    if (dx < 1.5 && dy < 2 && dz < 1.5) {
      console.log('[BUILD] Cannot place block inside player');
      return;
    }

    // Emit to server
    this.socket.emit('placeBlock', {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      color: this.player.color
    });

    // Also add locally immediately
    this.world.addBlock(pos.x, pos.y, pos.z, this.player.color);
  }

  update() {
    if (!this.buildMode) return;

    const pos = this._getPlacementPosition();
    if (pos) {
      this.previewMesh.position.copy(pos);
      this.previewMesh.visible = true;
    } else {
      this.previewMesh.visible = false;
    }
  }
}
