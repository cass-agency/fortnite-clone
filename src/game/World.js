import * as THREE from 'three';

const MAP_SIZE = 64;
const BLOCK_SIZE = 2;
const HALF_MAP = (MAP_SIZE * BLOCK_SIZE) / 2;

// Color palette for terrain blocks
const GRASS_COLORS = [0x4a7c59, 0x5a8c69, 0x3d6b4a, 0x4f8060];
const DIRT_COLORS  = [0x8B6914, 0x7a5c10, 0x9a7820];
const ROCK_COLORS  = [0x7a7a7a, 0x8a8a8a, 0x6a6a6a];

export class World {
  constructor(scene) {
    this.scene = scene;
    this.blocks = new Map(); // "x,y,z" -> mesh
    this.collidableMeshes = []; // for raycasting
    this.stormMesh = null;
    this.stormRadius = 200;
    this.stormCenterX = 0;
    this.stormCenterZ = 0;
    this.stormWall = null;

    this._buildTerrain();
    this._buildStormZone();
    this._buildEnvironment();
  }

  _buildTerrain() {
    // Use instanced mesh for performance
    const geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);

    // Ground base - single large plane for performance
    const groundGeo = new THREE.PlaneGeometry(MAP_SIZE * BLOCK_SIZE + 20, MAP_SIZE * BLOCK_SIZE + 20);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x3d6b4a });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.scene.add(ground);
    this.collidableMeshes.push(ground);

    // Place voxel blocks for terrain features
    // Grid terrain with some height variation
    const terrainData = this._generateTerrain();

    // Use instanced mesh for terrain blocks
    const count = terrainData.length;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });

    // We'll batch blocks by color group
    const grassMat = new THREE.MeshLambertMaterial({ color: 0x4a7c59 });
    const dirtMat  = new THREE.MeshLambertMaterial({ color: 0x8B6914 });
    const rockMat  = new THREE.MeshLambertMaterial({ color: 0x777777 });

    // Create instanced meshes
    const grassInstances = [];
    const dirtInstances  = [];
    const rockInstances  = [];

    for (const block of terrainData) {
      const key = `${block.x},${block.y},${block.z}`;
      if (block.type === 'grass') grassInstances.push(block);
      else if (block.type === 'dirt') dirtInstances.push(block);
      else rockInstances.push(block);
    }

    this._createInstancedBlocks(grassInstances, grassMat, geometry);
    this._createInstancedBlocks(dirtInstances, dirtMat, geometry);
    this._createInstancedBlocks(rockInstances, rockMat, geometry);

    // Create invisible collision boxes for terrain blocks
    // (only the raised ones, flat ground is handled by the ground plane)
    const collisionGeo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    const collisionMat = new THREE.MeshBasicMaterial({ visible: false });

    // Add a few hills as collidable
    for (const block of terrainData) {
      if (block.y > 0) {
        const mesh = new THREE.Mesh(collisionGeo, collisionMat);
        mesh.position.set(block.x, block.y, block.z);
        mesh.name = 'terrain';
        this.scene.add(mesh);
        this.collidableMeshes.push(mesh);
      }
    }
  }

  _createInstancedBlocks(blocks, material, geometry) {
    if (blocks.length === 0) return;
    const mesh = new THREE.InstancedMesh(geometry, material, blocks.length);
    mesh.receiveShadow = true;
    mesh.castShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < blocks.length; i++) {
      dummy.position.set(blocks[i].x, blocks[i].y, blocks[i].z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    return mesh;
  }

  _generateTerrain() {
    const blocks = [];
    const step = 4; // Place blocks every N units for performance

    for (let gx = -MAP_SIZE / 2; gx < MAP_SIZE / 2; gx += step) {
      for (let gz = -MAP_SIZE / 2; gz < MAP_SIZE / 2; gz += step) {
        const wx = gx * BLOCK_SIZE;
        const wz = gz * BLOCK_SIZE;

        // Simple noise-based height
        const height = this._noise(gx * 0.15, gz * 0.15);
        const blockHeight = Math.floor(height * 3);

        if (blockHeight > 0) {
          for (let y = 1; y <= blockHeight; y++) {
            const wy = y * BLOCK_SIZE - BLOCK_SIZE / 2;
            const type = y === blockHeight ? 'grass' : (y > blockHeight / 2 ? 'dirt' : 'rock');
            blocks.push({ x: wx, y: wy, z: wz, type });
          }
        }
      }
    }

    // Some random rocks/hills
    for (let i = 0; i < 30; i++) {
      const rx = (Math.random() - 0.5) * MAP_SIZE * BLOCK_SIZE * 0.8;
      const rz = (Math.random() - 0.5) * MAP_SIZE * BLOCK_SIZE * 0.8;
      const rh = Math.floor(Math.random() * 3) + 1;
      for (let y = 1; y <= rh; y++) {
        blocks.push({ x: Math.round(rx / BLOCK_SIZE) * BLOCK_SIZE, y: y * BLOCK_SIZE - BLOCK_SIZE / 2, z: Math.round(rz / BLOCK_SIZE) * BLOCK_SIZE, type: 'rock' });
      }
    }

    return blocks;
  }

  _noise(x, z) {
    // Simple deterministic pseudo-noise
    return (Math.sin(x * 1.3 + z * 0.7) + Math.sin(x * 0.5 - z * 1.1) + Math.sin(x * 2.1 + z * 1.9)) / 6 + 0.5;
  }

  _buildEnvironment() {
    // Trees
    for (let i = 0; i < 40; i++) {
      const tx = (Math.random() - 0.5) * (MAP_SIZE * BLOCK_SIZE - 20);
      const tz = (Math.random() - 0.5) * (MAP_SIZE * BLOCK_SIZE - 20);
      this._placeTree(tx, tz);
    }

    // Border fence/wall visual
    this._buildBorderWalls();
  }

  _placeTree(x, z) {
    const trunkHeight = Math.random() * 2 + 2;
    const trunkGeo = new THREE.BoxGeometry(0.8, trunkHeight, 0.8);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, trunkHeight / 2, z);
    trunk.castShadow = true;
    trunk.name = 'tree';
    this.scene.add(trunk);
    this.collidableMeshes.push(trunk);

    // Leaves
    const leafSize = 3 + Math.random() * 2;
    const leafGeo = new THREE.BoxGeometry(leafSize, leafSize * 0.8, leafSize);
    const leafColors = [0x2d6a4f, 0x1b4332, 0x40916c, 0x52b788];
    const leafMat = new THREE.MeshLambertMaterial({ color: leafColors[Math.floor(Math.random() * leafColors.length)] });
    const leaves = new THREE.Mesh(leafGeo, leafMat);
    leaves.position.set(x, trunkHeight + leafSize * 0.3, z);
    leaves.castShadow = true;
    this.scene.add(leaves);
  }

  _buildBorderWalls() {
    const wallSize = MAP_SIZE * BLOCK_SIZE;
    const wallHeight = 20;
    const wallMat = new THREE.MeshLambertMaterial({
      color: 0x444466,
      transparent: true,
      opacity: 0.5
    });

    const positions = [
      { x: 0, z: wallSize / 2 + 1, rx: 0, w: wallSize + 2, h: wallHeight, d: 2 },
      { x: 0, z: -wallSize / 2 - 1, rx: 0, w: wallSize + 2, h: wallHeight, d: 2 },
      { x: wallSize / 2 + 1, z: 0, rx: 0, w: 2, h: wallHeight, d: wallSize + 2 },
      { x: -wallSize / 2 - 1, z: 0, rx: 0, w: 2, h: wallHeight, d: wallSize + 2 }
    ];

    for (const p of positions) {
      const geo = new THREE.BoxGeometry(p.w, p.h, p.d);
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.position.set(p.x, p.h / 2, p.z);
      this.scene.add(mesh);
    }
  }

  _buildStormZone() {
    // Storm wall: a large semi-transparent cylinder
    const geometry = new THREE.CylinderGeometry(200, 200, 200, 64, 1, true);
    const material = new THREE.MeshBasicMaterial({
      color: 0x9b59b6,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.stormWall = new THREE.Mesh(geometry, material);
    this.stormWall.position.set(0, 100, 0);
    this.scene.add(this.stormWall);

    // Storm floor ring (optional ground indicator)
    const ringGeo = new THREE.RingGeometry(198, 202, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xa855f7,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    });
    this.stormRing = new THREE.Mesh(ringGeo, ringMat);
    this.stormRing.rotation.x = -Math.PI / 2;
    this.stormRing.position.y = 0.1;
    this.scene.add(this.stormRing);
  }

  updateStorm(data) {
    this.stormRadius = data.radius;
    this.stormCenterX = data.centerX;
    this.stormCenterZ = data.centerZ;

    if (this.stormWall) {
      this.stormWall.geometry.dispose();
      this.stormWall.geometry = new THREE.CylinderGeometry(data.radius, data.radius, 200, 64, 1, true);
      this.stormWall.position.set(data.centerX, 100, data.centerZ);
    }

    if (this.stormRing) {
      const r = data.radius;
      this.stormRing.geometry.dispose();
      this.stormRing.geometry = new THREE.RingGeometry(r - 2, r + 2, 64);
      this.stormRing.position.set(data.centerX, 0.1, data.centerZ);
    }
  }

  addBlock(x, y, z, color) {
    const key = `${x},${y},${z}`;
    if (this.blocks.has(key)) return;

    const geo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'placed_block';
    this.scene.add(mesh);

    this.blocks.set(key, mesh);
    this.collidableMeshes.push(mesh);

    return mesh;
  }

  getCollidableMeshes() {
    return this.collidableMeshes;
  }

  createHitEffect(scene, position) {
    if (!position) return;
    const geo = new THREE.SphereGeometry(0.3, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
    const spark = new THREE.Mesh(geo, mat);
    spark.position.set(position.x, position.y, position.z);
    scene.add(spark);

    let life = 0;
    const animate = () => {
      life += 0.05;
      spark.scale.setScalar(1 - life);
      if (life < 1) {
        requestAnimationFrame(animate);
      } else {
        scene.remove(spark);
        geo.dispose();
        mat.dispose();
      }
    };
    animate();
  }

  createShotTrail(scene, origin, direction) {
    if (!origin || !direction) return;
    const points = [
      new THREE.Vector3(origin.x, origin.y, origin.z),
      new THREE.Vector3(
        origin.x + direction.x * 50,
        origin.y + direction.y * 50,
        origin.z + direction.z * 50
      )
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.8 });
    const line = new THREE.Line(geo, mat);
    scene.add(line);

    let life = 0;
    const animate = () => {
      life += 0.08;
      mat.opacity = 0.8 * (1 - life);
      if (life < 1) {
        requestAnimationFrame(animate);
      } else {
        scene.remove(line);
        geo.dispose();
        mat.dispose();
      }
    };
    animate();
  }

  update(elapsed) {
    // Pulse storm effect
    if (this.stormWall) {
      this.stormWall.material.opacity = 0.15 + 0.1 * Math.sin(elapsed * 2);
    }
    if (this.stormRing) {
      this.stormRing.material.opacity = 0.4 + 0.2 * Math.sin(elapsed * 3);
    }
  }
}
