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

    // Camera angles (controlled by mouse)
    this.yaw = 0;
    this.pitch = 0;

    // Input state
    this.keys = {};
    this.isSprinting = false;

    // Character facing direction (lerps to movement direction)
    this._characterYaw = 0;

    // Reference to weapon (set by main.js after creation)
    this.weapon = null;

    this._buildCharacterMesh();
    this._setupInputListeners();
  }

  _buildCharacterMesh() {
    this.characterGroup = new THREE.Group();

    const playerColor = new THREE.Color(this.color);
    const darkColor   = playerColor.clone().multiplyScalar(0.6);
    const bodyMat     = new THREE.MeshLambertMaterial({ color: playerColor });
    const darkMat     = new THREE.MeshLambertMaterial({ color: darkColor });
    const skinMat     = new THREE.MeshLambertMaterial({ color: 0xffcc99 });

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.35), bodyMat);
    torso.position.y = 1.05;
    torso.castShadow = true;
    this.characterGroup.add(torso);

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skinMat);
    head.position.y = 1.7;
    head.castShadow = true;
    this.characterGroup.add(head);

    // Left arm
    const lArm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.7, 0.25), darkMat);
    lArm.position.set(-0.5, 1.05, 0);
    lArm.castShadow = true;
    this._leftArm = lArm;
    this.characterGroup.add(lArm);

    // Right arm (holds weapon)
    const rArm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.7, 0.25), darkMat);
    rArm.position.set(0.5, 1.05, 0);
    rArm.castShadow = true;
    this._rightArm = rArm;
    this.characterGroup.add(rArm);

    // Simple gun attached to right arm
    const gunBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x222222 })
    );
    gunBody.position.set(0.5, 1.0, -0.35);
    this._gunMesh = gunBody;
    this.characterGroup.add(gunBody);

    // Left leg
    const lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.8, 0.28), darkMat);
    lLeg.position.set(-0.2, 0.3, 0);
    lLeg.castShadow = true;
    this._leftLeg = lLeg;
    this.characterGroup.add(lLeg);

    // Right leg
    const rLeg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.8, 0.28), darkMat);
    rLeg.position.set(0.2, 0.3, 0);
    rLeg.castShadow = true;
    this._rightLeg = rLeg;
    this.characterGroup.add(rLeg);

    this.characterGroup.position.copy(this.position);
    this.scene.add(this.characterGroup);

    this._walkCycle = 0;
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
    });
  }

  update(delta, world) {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right   = new THREE.Vector3( Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const moveDir = new THREE.Vector3();

    if (this.keys['KeyW']) moveDir.add(forward);
    if (this.keys['KeyS']) moveDir.sub(forward);
    if (this.keys['KeyA']) moveDir.sub(right);
    if (this.keys['KeyD']) moveDir.add(right);

    this.isSprinting = !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']);
    const speed = this.isSprinting ? SPRINT_SPEED : MOVE_SPEED;

    const isMoving = moveDir.lengthSq() > 0;
    if (isMoving) {
      moveDir.normalize().multiplyScalar(speed);

      // Rotate character to face movement direction
      const targetYaw = Math.atan2(-moveDir.x, -moveDir.z);
      const diff = ((targetYaw - this._characterYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this._characterYaw += diff * Math.min(1, delta * 12);
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

    this._resolveCollisions(world);

    // Update character mesh position and rotation
    this.characterGroup.position.copy(this.position);
    this.characterGroup.rotation.y = this._characterYaw;

    // Walk animation
    if (isMoving && this.isOnGround) {
      this._walkCycle += delta * (this.isSprinting ? 12 : 8);
      const swing = Math.sin(this._walkCycle) * 0.4;
      this._leftLeg.rotation.x  =  swing;
      this._rightLeg.rotation.x = -swing;
      this._leftArm.rotation.x  = -swing * 0.6;
      this._rightArm.rotation.x =  swing * 0.6;
    } else {
      // Return to rest
      this._leftLeg.rotation.x  *= 0.8;
      this._rightLeg.rotation.x *= 0.8;
      this._leftArm.rotation.x  *= 0.8;
      this._rightArm.rotation.x *= 0.8;
    }

    // Point right arm toward aim direction (pitch)
    this._rightArm.rotation.x = -this.pitch * 0.7 + this._rightArm.rotation.x * 0.3;
    if (this._gunMesh) {
      this._gunMesh.rotation.x = -this.pitch * 0.7;
    }
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
      if (mesh.name === 'ground') continue;

      tempBox.setFromObject(mesh);

      if (playerBox.intersectsBox(tempBox)) {
        const overlap = this._getOverlap(playerBox, tempBox);

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

  // Eye position: camera position (managed by ThirdPersonCamera)
  getEyePosition() {
    return this.camera.position.clone();
  }

  // Aim direction: camera look direction
  getLookDirection() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  setWeaponType(type) {
    // Update the character-attached gun color/size to suggest weapon type
    if (!this._gunMesh) return;
    if (type === 'sniper') {
      this._gunMesh.geometry.dispose();
      this._gunMesh.geometry = new THREE.BoxGeometry(0.08, 0.08, 0.7);
    } else if (type === 'shotgun') {
      this._gunMesh.geometry.dispose();
      this._gunMesh.geometry = new THREE.BoxGeometry(0.12, 0.12, 0.45);
    } else {
      this._gunMesh.geometry.dispose();
      this._gunMesh.geometry = new THREE.BoxGeometry(0.1, 0.1, 0.5);
    }
  }

  setGunVisible(visible) {
    if (this._gunMesh) this._gunMesh.visible = visible;
  }
}
