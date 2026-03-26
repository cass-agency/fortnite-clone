import * as THREE from 'three';

const DIST = 3;          // 3m behind
const BASE_ELEV = 0.3;   // base camera elevation angle (radians)
const RIGHT_OFFSET = 0.5; // slight right offset for over-shoulder view
const PIVOT_HEIGHT = 1.0; // pivot at player center height

export class ThirdPersonCamera {
  constructor(camera) {
    this.camera = camera;
    this._raycaster = new THREE.Raycaster();
  }

  /**
   * Update camera position and orientation.
   * @param {THREE.Vector3} playerPos
   * @param {number} yaw   - player horizontal rotation (radians)
   * @param {number} pitch - player vertical look (radians)
   * @param {THREE.Mesh[]} collidables
   */
  update(playerPos, yaw, pitch, collidables) {
    // Pivot = player upper body
    const pivot = new THREE.Vector3(playerPos.x, playerPos.y + PIVOT_HEIGHT, playerPos.z);

    // Elevation angle: base + pitch influence
    const elev = Math.max(-0.4, Math.min(0.9, BASE_ELEV + pitch * 0.55));

    const cosElev = Math.cos(elev);
    const sinElev = Math.sin(elev);
    const sinYaw  = Math.sin(yaw);
    const cosYaw  = Math.cos(yaw);

    // Camera arm from pivot:
    //   behind = (sinYaw, 0, cosYaw) because forward = (-sinYaw, 0, -cosYaw)
    //   right  = (cosYaw, 0, -sinYaw)
    const arm = new THREE.Vector3(
      sinYaw * DIST * cosElev + cosYaw * RIGHT_OFFSET,
      DIST * sinElev + 0.3,
      cosYaw * DIST * cosElev - sinYaw * RIGHT_OFFSET
    );

    const dir  = arm.clone().normalize();
    const dist = arm.length();

    // Camera collision: avoid clipping through placed blocks
    this._raycaster.set(pivot, dir);
    this._raycaster.far = dist + 0.3;

    let finalDist = dist;
    if (collidables && collidables.length > 0) {
      const hits = this._raycaster.intersectObjects(
        collidables.filter(m => m.name === 'placed_block'),
        false
      );
      if (hits.length > 0 && hits[0].distance < dist) {
        finalDist = Math.max(0.5, hits[0].distance - 0.25);
      }
    }

    const cameraPos = pivot.clone().add(dir.clone().multiplyScalar(finalDist));
    this.camera.position.copy(cameraPos);

    // Camera looks in the player's aim direction (yaw + pitch)
    const aimDir = new THREE.Vector3(
      -sinYaw,
      -Math.sin(pitch * 0.85),
      -cosYaw
    ).normalize();

    this.camera.lookAt(cameraPos.clone().addScaledVector(aimDir, 100));
  }
}
