import * as THREE from 'three';

export class RemotePlayer {
  constructor(scene, data) {
    this.scene = scene;
    this.id = data.id;
    this.name = data.name || 'Player';
    this.color = data.color || '#ff6b6b';
    this.health = data.health || 100;
    this.isDead = data.isDead || false;

    // Interpolation targets
    this.targetPosition = new THREE.Vector3(
      data.position?.x || 0,
      data.position?.y || 0,
      data.position?.z || 0
    );
    this.targetRotationY = data.rotation?.y || 0;

    this._buildMesh();
    this._buildNameTag();
  }

  _buildMesh() {
    this.group = new THREE.Group();

    // Body
    const bodyGeo = new THREE.BoxGeometry(0.8, 1.4, 0.5);
    const bodyMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(this.color) });
    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.bodyMesh.position.y = 0.7;
    this.bodyMesh.castShadow = true;
    this.group.add(this.bodyMesh);

    // Head
    const headGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    const headMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(this.color).multiplyScalar(0.85) });
    this.headMesh = new THREE.Mesh(headGeo, headMat);
    this.headMesh.position.y = 1.75;
    this.headMesh.castShadow = true;
    this.group.add(this.headMesh);

    // Arms
    const armGeo = new THREE.BoxGeometry(0.25, 1.0, 0.25);
    const armMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(this.color).multiplyScalar(0.9) });

    this.leftArm = new THREE.Mesh(armGeo, armMat);
    this.leftArm.position.set(-0.525, 0.9, 0);
    this.group.add(this.leftArm);

    this.rightArm = new THREE.Mesh(armGeo, armMat);
    this.rightArm.position.set(0.525, 0.9, 0);
    this.group.add(this.rightArm);

    // Legs
    const legGeo = new THREE.BoxGeometry(0.35, 0.9, 0.35);
    const legMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(this.color).multiplyScalar(0.7) });

    this.leftLeg = new THREE.Mesh(legGeo, legMat);
    this.leftLeg.position.set(-0.2, -0.05, 0);
    this.group.add(this.leftLeg);

    this.rightLeg = new THREE.Mesh(legGeo, legMat);
    this.rightLeg.position.set(0.2, -0.05, 0);
    this.group.add(this.rightLeg);

    // Weapon (simple box)
    const weaponGeo = new THREE.BoxGeometry(0.1, 0.15, 0.6);
    const weaponMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    this.weaponMesh = new THREE.Mesh(weaponGeo, weaponMat);
    this.weaponMesh.position.set(0.65, 0.9, -0.35);
    this.group.add(this.weaponMesh);

    // Set initial position
    this.group.position.copy(this.targetPosition);
    this.scene.add(this.group);
  }

  _buildNameTag() {
    // Create canvas texture for name tag
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 8);
    ctx.fill();

    ctx.fillStyle = this.color;
    ctx.font = 'bold 28px Segoe UI';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.name, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const geo = new THREE.PlaneGeometry(2.5, 0.6);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    });

    this.nameTag = new THREE.Mesh(geo, mat);
    this.nameTag.position.y = 2.8;
    this.group.add(this.nameTag);
  }

  update(delta, elapsed) {
    // Interpolate position
    this.group.position.lerp(this.targetPosition, Math.min(1, 10 * delta));

    // Smooth rotation
    const currentY = this.group.rotation.y;
    let diff = this.targetRotationY - currentY;
    // Normalize
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.group.rotation.y += diff * Math.min(1, 10 * delta);

    // Name tag always faces camera
    this.nameTag.rotation.copy(new THREE.Euler(0, -this.group.rotation.y, 0));

    // Walk animation
    const walkSpeed = 4;
    const walkAmt = Math.sin(elapsed * walkSpeed) * 0.3;
    this.leftLeg.rotation.x = walkAmt;
    this.rightLeg.rotation.x = -walkAmt;
    this.leftArm.rotation.x = -walkAmt * 0.5;
    this.rightArm.rotation.x = walkAmt * 0.5;
  }

  setPosition(position, rotationY) {
    this.targetPosition.set(position.x, position.y, position.z);
    this.targetRotationY = rotationY || 0;
  }

  markDead() {
    this.isDead = true;
    // Tilt body to show death
    this.group.rotation.z = Math.PI / 2;
    this.group.position.y -= 0.5;
    if (this.nameTag) {
      this.nameTag.visible = false;
    }
  }

  markAlive(position) {
    this.isDead = false;
    this.group.rotation.z = 0;
    if (position) {
      this.group.position.set(position.x, position.y, position.z);
      this.targetPosition.set(position.x, position.y, position.z);
    }
    if (this.nameTag) {
      this.nameTag.visible = true;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    // Dispose geometries
    this.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }

  getBoundingBox() {
    const box = new THREE.Box3();
    box.setFromObject(this.group);
    return box;
  }
}

export class RemotePlayerManager {
  constructor(scene) {
    this.scene = scene;
    this.players = {}; // id -> RemotePlayer
  }

  addPlayer(data) {
    if (this.players[data.id]) return;
    this.players[data.id] = new RemotePlayer(this.scene, data);
  }

  removePlayer(id) {
    if (this.players[id]) {
      this.players[id].dispose();
      delete this.players[id];
    }
  }

  updatePlayer(id, position, rotation) {
    if (this.players[id]) {
      this.players[id].setPosition(position, rotation?.y || 0);
    }
  }

  markDead(id) {
    if (this.players[id]) {
      this.players[id].markDead();
    }
  }

  markAlive(id, position) {
    if (this.players[id]) {
      this.players[id].markAlive(position);
    }
  }

  getAlivePlayers() {
    const alive = {};
    for (const [id, p] of Object.entries(this.players)) {
      if (!p.isDead) alive[id] = p;
    }
    return alive;
  }

  getAllPlayerMeshes() {
    return Object.values(this.players).map(p => p.group);
  }

  getPlayerById(id) {
    return this.players[id] || null;
  }

  update(delta, elapsed) {
    for (const player of Object.values(this.players)) {
      player.update(delta, elapsed);
    }
  }
}
