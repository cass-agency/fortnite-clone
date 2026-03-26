import * as THREE from 'three';

const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.4;
const GRAVITY = -25;
const JUMP_FORCE = 10;
const MOVE_SPEED = 8;
const SPRINT_SPEED = 14;

export class Player {
  constructor(scene, camera, color) {
    this.scene = scene;
    this.camera = camera;
    this.color = color;

    // State
    this.health = 100;
    this.position = new THREE.Vector3(0, PLAYER_HEIGHT, 0);
    this.velocity = new THREE.Vector3();
    this.isOnGround = false;
    this.isPointerLocked = false;

    // Camera angles
    this.yaw = 0;
    this.pitch = 0;

    // Input state
    this.keys = {};
    this.isSprinting = false;

    // Body mesh (visible to others, hidden locally but keep for shadow)
    this._setupCamera();
    this._setupInputListeners();
  }

  _setupCamera() {
    // First-person: camera IS the player eyes
    this.camera.position.copy(this.position);
    this.camera.position.y += 0;

    // Pitch pivot
    this.pitchObject = new THREE.Object3D();
    this.pitchObject.add(this.camera);

    this.yawObject = new THREE.Object3D();
    this.yawObject.add(this.pitchObject);
    this.yawObject.position.copy(this.position);
    this.scene.add(this.yawObject);
  }

  _setupInputListeners() {
    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space' && this.isOnGround) {
        this.velocity.y = JUMP_FORCE;
        this.isOnGround = false;
      }
    });

    document.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isPointerLocked) return;

      const sensitivity = 0.002;
      this.yaw -= e.movementX * sensitivity;
      this.pitch -= e.movementY * sensitivity;

      // Clamp pitch
      this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch));

      this.yawObject.rotation.y = this.yaw;
      this.pitchObject.rotation.x = this.pitch;
    });
  }

  update(delta, world) {
    // Movement direction
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right   = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const moveDir = new THREE.Vector3();

    if (this.keys['KeyW']) moveDir.add(forward);
    if (this.keys['KeyS']) moveDir.sub(forward);
    if (this.keys['KeyA']) moveDir.sub(right);
    if (this.keys['KeyD']) moveDir.add(right);

    this.isSprinting = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    const speed = this.isSprinting ? SPRINT_SPEED : MOVE_SPEED;

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize().multiplyScalar(speed);
    }

    this.velocity.x = moveDir.x;
    this.velocity.z = moveDir.z;

    // Gravity
    if (!this.isOnGround) {
      this.velocity.y += GRAVITY * delta;
    }

    // Apply velocity
    const movement = this.velocity.clone().multiplyScalar(delta);
    this.position.add(movement);

    // Simple collision with ground (y=0)
    this._resolveCollisions(world);

    // Update camera
    this.yawObject.position.copy(this.position);
    this.yawObject.position.y += PLAYER_HEIGHT * 0.9; // eye height
  }

  _resolveCollisions(world) {
    const collidables = world.getCollidableMeshes();
    const playerBox = new THREE.Box3(
      new THREE.Vector3(
        this.position.x - PLAYER_RADIUS,
        this.position.y,
        this.position.z - PLAYER_RADIUS
      ),
      new THREE.Vector3(
        this.position.x + PLAYER_RADIUS,
        this.position.y + PLAYER_HEIGHT,
        this.position.z + PLAYER_RADIUS
      )
    );

    // Ground check
    if (this.position.y <= 0) {
      this.position.y = 0;
      this.velocity.y = 0;
      this.isOnGround = true;
    } else {
      this.isOnGround = false;
    }

    // Check collidable meshes
    const tempBox = new THREE.Box3();
    for (const mesh of collidables) {
      if (mesh.name === 'ground') continue; // handled above

      tempBox.setFromObject(mesh);

      if (playerBox.intersectsBox(tempBox)) {
        // Find overlap axis and push player out
        const overlap = this._getOverlap(playerBox, tempBox);

        // Push on the axis with smallest overlap
        if (Math.abs(overlap.y) < Math.abs(overlap.x) && Math.abs(overlap.y) < Math.abs(overlap.z)) {
          this.position.y += overlap.y;
          if (overlap.y > 0) {
            this.isOnGround = true;
            this.velocity.y = 0;
          }
        } else if (Math.abs(overlap.x) < Math.abs(overlap.z)) {
          this.position.x += overlap.x;
          this.velocity.x = 0;
        } else {
          this.position.z += overlap.z;
          this.velocity.z = 0;
        }
      }
    }

    // World boundary
    const halfMap = 64;
    this.position.x = Math.max(-halfMap, Math.min(halfMap, this.position.x));
    this.position.z = Math.max(-halfMap, Math.min(halfMap, this.position.z));
  }

  _getOverlap(boxA, boxB) {
    const centerA = new THREE.Vector3();
    const centerB = new THREE.Vector3();
    boxA.getCenter(centerA);
    boxB.getCenter(centerB);

    const sizeA = new THREE.Vector3();
    const sizeB = new THREE.Vector3();
    boxA.getSize(sizeA);
    boxB.getSize(sizeB);

    const overlapX = (sizeA.x + sizeB.x) / 2 - Math.abs(centerA.x - centerB.x);
    const overlapY = (sizeA.y + sizeB.y) / 2 - Math.abs(centerA.y - centerB.y);
    const overlapZ = (sizeA.z + sizeB.z) / 2 - Math.abs(centerA.z - centerB.z);

    return new THREE.Vector3(
      centerA.x > centerB.x ? overlapX : -overlapX,
      centerA.y > centerB.y ? overlapY : -overlapY,
      centerA.z > centerB.z ? overlapZ : -overlapZ
    );
  }

  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);
  }

  getEyePosition() {
    const pos = this.position.clone();
    pos.y += PLAYER_HEIGHT * 0.9;
    return pos;
  }

  getLookDirection() {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    return dir;
  }
}
