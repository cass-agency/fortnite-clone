import * as THREE from 'three';

const MAX_RANGE = 150;

export const WEAPON_DEFS = {
  pistol: {
    name: 'Pistol',
    damage: 25,
    fireRate: 0.4,
    ammo: 15,
    maxAmmo: 15,
    reload: 1.5,
    spread: 0,
    pellets: 1,
    color: 0x333333,
  },
  shotgun: {
    name: 'Shotgun',
    damage: 15,
    fireRate: 0.8,
    ammo: 8,
    maxAmmo: 8,
    reload: 2.5,
    spread: 0.08,
    pellets: 6,
    color: 0x8B4513,
  },
  sniper: {
    name: 'Sniper',
    damage: 100,
    fireRate: 1.5,
    ammo: 5,
    maxAmmo: 5,
    reload: 3.0,
    spread: 0,
    pellets: 1,
    color: 0x1a3a5a,
  },
};

export class Weapon {
  constructor(scene, camera, player, socket, remotePlayerManager, hud) {
    this.scene = scene;
    this.camera = camera;
    this.player = player;
    this.socket = socket;
    this.remotePlayerManager = remotePlayerManager;
    this.hud = hud;

    this.currentWeaponType = 'pistol';
    this.def = WEAPON_DEFS.pistol;
    this.ammo = this.def.ammo;
    this.fireCooldown = 0;
    this.isBuildMode = false;
    this.isReloading = false;
    this.reloadTime = 0;

    this._setupRaycaster();
    this._setupInputListeners();

    hud.updateAmmo(this.ammo, this.def.name);
  }

  _setupRaycaster() {
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = MAX_RANGE;
  }

  _setupInputListeners() {
    document.addEventListener('mousedown', (e) => {
      if (!this.player.isPointerLocked) return;
      if (e.button === 0 && !this.isBuildMode) {
        this._shoot();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR') this._reload();
      if (e.code === 'Digit1') this.equipWeapon('pistol');
      if (e.code === 'Digit2') this.equipWeapon('shotgun');
      if (e.code === 'Digit3') this.equipWeapon('sniper');
    });
  }

  equipWeapon(type) {
    if (!WEAPON_DEFS[type]) return;
    const prev = this.currentWeaponType;
    this.currentWeaponType = type;
    this.def = WEAPON_DEFS[type];
    this.ammo = this.def.ammo;
    this.fireCooldown = 0;
    this.isReloading = false;

    if (this.player.setWeaponType) this.player.setWeaponType(type);
    this.hud.updateAmmo(this.ammo, this.def.name);
    this.hud.addKillMessage(`Picked up ${this.def.name}`, '#ffd93d');
    console.log(`[WEAPON] Equipped ${type}`);
  }

  _shoot() {
    if (this.fireCooldown > 0) return;
    if (this.isReloading) return;
    if (this.ammo <= 0) {
      this._reload();
      return;
    }

    this.fireCooldown = this.def.fireRate;
    this.ammo--;
    this.hud.updateAmmo(this.ammo, this.def.name);

    const origin = this.player.getEyePosition();

    for (let p = 0; p < this.def.pellets; p++) {
      const baseDir = this.player.getLookDirection();

      // Apply spread
      if (this.def.spread > 0) {
        baseDir.x += (Math.random() - 0.5) * this.def.spread * 2;
        baseDir.y += (Math.random() - 0.5) * this.def.spread * 2;
        baseDir.z += (Math.random() - 0.5) * this.def.spread * 2;
        baseDir.normalize();
      }

      this.raycaster.set(origin, baseDir);

      let hitPlayerId = null;
      let hitPlayerDist = Infinity;
      let hitPosition = null;

      for (const [id, remotePlayer] of Object.entries(this.remotePlayerManager.players)) {
        if (remotePlayer.isDead) continue;
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

      // Emit shot to server (server validates and applies damage)
      this.socket.emit('shoot', {
        targetId: hitPlayerId,
        damage: this.def.damage,
        weaponType: this.currentWeaponType,
        origin: { x: origin.x, y: origin.y, z: origin.z },
        direction: { x: baseDir.x, y: baseDir.y, z: baseDir.z },
        hitPosition: hitPosition ? { x: hitPosition.x, y: hitPosition.y, z: hitPosition.z } : null,
      });

      // Visual bullet trail
      const trailEnd = origin.clone().add(
        baseDir.clone().multiplyScalar(hitPlayerId ? hitPlayerDist : MAX_RANGE)
      );
      this._createBulletTrail(origin, trailEnd);

      if (hitPlayerId && p === 0) {
        this.hud.showHitMarker();
        this._showDamageNumber(hitPosition, this.def.damage);
      }
    }
  }

  _reload() {
    if (this.isReloading || this.ammo >= this.def.maxAmmo) return;
    this.isReloading = true;
    this.reloadTime = this.def.reload;
    this.hud.showReloading(true);
  }

  _createBulletTrail(from, to) {
    const points = [from.clone(), to.clone()];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const color = this.currentWeaponType === 'sniper' ? 0x00ffff : 0xffff88;
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);

    let life = 0;
    const animate = () => {
      life += this.currentWeaponType === 'sniper' ? 0.04 : 0.1;
      mat.opacity = 0.9 * (1 - life);
      if (life < 1) requestAnimationFrame(animate);
      else {
        this.scene.remove(line);
        geo.dispose();
        mat.dispose();
      }
    };
    animate();
  }

  _showDamageNumber(position, damage) {
    const container = document.getElementById('damage-numbers');
    const el = document.createElement('div');
    el.className = 'damage-number';
    el.textContent = `-${damage}`;
    el.style.left = '50%';
    el.style.top = '45%';
    container.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  setBuildMode(enabled) {
    this.isBuildMode = enabled;
    if (this.player.setGunVisible) this.player.setGunVisible(!enabled);
  }

  update(delta) {
    if (this.fireCooldown > 0) this.fireCooldown -= delta;

    if (this.isReloading) {
      this.reloadTime -= delta;
      if (this.reloadTime <= 0) {
        this.ammo = this.def.maxAmmo;
        this.isReloading = false;
        this.hud.showReloading(false);
        this.hud.updateAmmo(this.ammo, this.def.name);
      }
    }
  }
}
