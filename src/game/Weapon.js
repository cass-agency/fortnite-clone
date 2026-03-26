import * as THREE from 'three';

const FIRE_RATE = 0.4; // seconds between shots
const BULLET_DAMAGE = 25;
const MAX_RANGE = 150;

export class Weapon {
  constructor(scene, camera, player, socket, remotePlayerManager, hud) {
    this.scene = scene;
    this.camera = camera;
    this.player = player;
    this.socket = socket;
    this.remotePlayerManager = remotePlayerManager;
    this.hud = hud;

    this.fireCooldown = 0;
    this.isBuildMode = false;
    this.ammo = 30;
    this.isReloading = false;
    this.reloadTime = 0;

    this._buildViewModel();
    this._setupRaycaster();
    this._setupInputListeners();

    this.muzzleFlash = null;
    this.muzzleFlashTimer = 0;
  }

  _buildViewModel() {
    // Gun model in view space (attached to camera)
    this.gunGroup = new THREE.Group();

    // Main body
    const bodyGeo = new THREE.BoxGeometry(0.08, 0.1, 0.45);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    this.gunGroup.add(body);

    // Barrel
    const barrelGeo = new THREE.BoxGeometry(0.05, 0.05, 0.3);
    const barrelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0.03, -0.35);
    this.gunGroup.add(barrel);

    // Grip
    const gripGeo = new THREE.BoxGeometry(0.07, 0.15, 0.08);
    const gripMat = new THREE.MeshLambertMaterial({ color: 0x4a3728 });
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.set(0, -0.1, 0.1);
    this.gunGroup.add(grip);

    // Muzzle flash
    const flashGeo = new THREE.SphereGeometry(0.08, 6, 6);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffcc00,
      transparent: true,
      opacity: 0
    });
    this.muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
    this.muzzleFlash.position.set(0, 0.03, -0.52);
    this.gunGroup.add(this.muzzleFlash);

    // Position gun in view (bottom-right)
    this.gunGroup.position.set(0.22, -0.2, -0.45);

    // Add to camera
    this.camera.add(this.gunGroup);

    // Initial gun position for bob animation
    this.gunBobY = 0;
    this.gunKickZ = 0;
  }

  _setupRaycaster() {
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = MAX_RANGE;
  }

  _setupInputListeners() {
    document.addEventListener('mousedown', (e) => {
      if (!this.player.isPointerLocked) return;

      if (e.button === 0) {
        // Left click: shoot (if not build mode)
        if (!this.isBuildMode) {
          this._shoot();
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR') {
        this._reload();
      }
    });
  }

  _shoot() {
    if (this.fireCooldown > 0) return;
    if (this.isReloading) return;
    if (this.ammo <= 0) {
      this._reload();
      return;
    }

    this.fireCooldown = FIRE_RATE;
    this.ammo--;

    // Muzzle flash
    this.muzzleFlash.material.opacity = 1;
    this.muzzleFlashTimer = 0.08;

    // Kick animation
    this.gunKickZ = 0.1;

    // Screen shake
    this._screenShake();

    // Raycast from center of screen
    const origin = this.player.getEyePosition();
    const direction = this.player.getLookDirection();

    this.raycaster.set(origin, direction);

    // Check remote players
    let hitPlayerId = null;
    let hitPlayerDist = Infinity;
    let hitPosition = null;

    for (const [id, remotePlayer] of Object.entries(this.remotePlayerManager.players)) {
      if (remotePlayer.isDead) continue;

      // Precise mesh test
      const meshes = [];
      remotePlayer.group.traverse((child) => {
        if (child.isMesh) meshes.push(child);
      });

      const hits = this.raycaster.intersectObjects(meshes, false);
      if (hits.length > 0 && hits[0].distance < hitPlayerDist) {
        hitPlayerDist = hits[0].distance;
        hitPlayerId = id;
        hitPosition = hits[0].point.clone();
      }
    }

    // Emit shot to server
    this.socket.emit('shoot', {
      targetId: hitPlayerId,
      damage: BULLET_DAMAGE,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      direction: { x: direction.x, y: direction.y, z: direction.z },
      hitPosition: hitPosition ? { x: hitPosition.x, y: hitPosition.y, z: hitPosition.z } : null
    });

    // Visual bullet trail
    const trailEnd = origin.clone().add(direction.clone().multiplyScalar(
      hitPlayerId ? hitPlayerDist : MAX_RANGE
    ));
    this._createBulletTrail(origin, trailEnd);

    // Hit marker
    if (hitPlayerId) {
      this.hud.showHitMarker();
      this._showDamageNumber(hitPosition);
    }

    // Update ammo HUD
    this.hud.updateAmmo(this.ammo);
  }

  _reload() {
    if (this.isReloading || this.ammo >= 30) return;
    this.isReloading = true;
    this.reloadTime = 2.0;
    this.hud.showReloading(true);
  }

  _screenShake() {
    const origPitch = this.player.pitch;
    this.player.pitch -= 0.03;
    setTimeout(() => {
      this.player.pitch = origPitch;
    }, 100);
  }

  _createBulletTrail(from, to) {
    const points = [from.clone(), to.clone()];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: 0xffff88,
      transparent: true,
      opacity: 0.9
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);

    let life = 0;
    const animate = () => {
      life += 0.1;
      mat.opacity = 0.9 * (1 - life);
      if (life < 1) {
        requestAnimationFrame(animate);
      } else {
        this.scene.remove(line);
        geo.dispose();
        mat.dispose();
      }
    };
    animate();
  }

  _showDamageNumber(position) {
    if (!position) return;
    const container = document.getElementById('damage-numbers');
    const el = document.createElement('div');
    el.className = 'damage-number';
    el.textContent = `-${BULLET_DAMAGE}`;
    el.style.left = '50%';
    el.style.top = '45%';
    container.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  setBuildMode(enabled) {
    this.isBuildMode = enabled;
    // Hide/show gun in build mode
    this.gunGroup.visible = !enabled;
  }

  update(delta) {
    // Cooldown
    if (this.fireCooldown > 0) {
      this.fireCooldown -= delta;
    }

    // Muzzle flash
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= delta;
      if (this.muzzleFlashTimer <= 0) {
        this.muzzleFlash.material.opacity = 0;
      }
    }

    // Reload timer
    if (this.isReloading) {
      this.reloadTime -= delta;
      if (this.reloadTime <= 0) {
        this.ammo = 30;
        this.isReloading = false;
        this.hud.showReloading(false);
        this.hud.updateAmmo(this.ammo);
      }
    }

    // Gun bob (when moving)
    const isMoving = Object.values(this.player.keys).some(v => v);
    if (isMoving && this.player.isOnGround) {
      this.gunBobY = Math.sin(Date.now() * 0.008) * 0.01;
    } else {
      this.gunBobY *= 0.9;
    }

    // Gun kick recoil recovery
    this.gunKickZ *= 0.85;

    this.gunGroup.position.set(
      0.22,
      -0.2 + this.gunBobY,
      -0.45 + this.gunKickZ
    );
  }
}
