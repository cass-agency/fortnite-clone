export class HUD {
  constructor() {
    this.healthBar = document.getElementById('health-bar');
    this.healthValue = document.getElementById('health-value');
    this.stormCountdown = document.getElementById('storm-countdown');
    this.stormDamageWarning = document.getElementById('storm-damage-warning');
    this.playerCountValue = document.getElementById('player-count-value');
    this.modeIndicator = document.getElementById('mode-indicator');
    this.ammoCurrentEl = document.getElementById('ammo-current');
    this.killFeed = document.getElementById('kill-feed');
    this.hitFlash = document.getElementById('hit-flash');

    this.hitMarkerTimeout = null;
    this.hitMarkerEl = null;
    this._buildHitMarker();
  }

  _buildHitMarker() {
    this.hitMarkerEl = document.createElement('div');
    this.hitMarkerEl.id = 'hit-marker';
    this.hitMarkerEl.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 26px;
      height: 26px;
      pointer-events: none;
      z-index: 30;
      opacity: 0;
      transition: opacity 0.1s;
    `;
    this.hitMarkerEl.innerHTML = `
      <svg viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
        <line x1="0" y1="13" x2="8" y2="13" stroke="#ff4444" stroke-width="2.5"/>
        <line x1="18" y1="13" x2="26" y2="13" stroke="#ff4444" stroke-width="2.5"/>
        <line x1="13" y1="0" x2="13" y2="8" stroke="#ff4444" stroke-width="2.5"/>
        <line x1="13" y1="18" x2="13" y2="26" stroke="#ff4444" stroke-width="2.5"/>
      </svg>
    `;
    document.body.appendChild(this.hitMarkerEl);
  }

  updateHealth(health) {
    const pct = Math.max(0, Math.min(100, health));
    this.healthBar.style.width = `${pct}%`;
    this.healthValue.textContent = `${Math.round(pct)} / 100`;

    this.healthBar.className = '';
    if (pct > 60) {
      this.healthBar.classList.add('high');
    } else if (pct > 30) {
      this.healthBar.classList.add('medium');
    }
  }

  updateStorm(data) {
    const secs = Math.max(0, Math.ceil(data.nextShrinkIn || 0));
    if (data.shrinking) {
      this.stormCountdown.textContent = 'SHRINKING!';
      this.stormCountdown.style.color = '#ff6b6b';
    } else {
      this.stormCountdown.textContent = `${secs}s`;
      this.stormCountdown.style.color = '#fff';
    }
  }

  showDamageWarning(show) {
    this.stormDamageWarning.style.display = show ? 'block' : 'none';
  }

  updatePlayerCount(count) {
    this.playerCountValue.textContent = count;
  }

  setBuildMode(enabled) {
    if (enabled) {
      this.modeIndicator.textContent = '🧱 BUILD MODE';
      this.modeIndicator.className = 'build-mode';
    } else {
      this.modeIndicator.textContent = '🔫 COMBAT';
      this.modeIndicator.className = '';
    }
  }

  updateAmmo(ammo, weaponName) {
    this.ammoCurrentEl.textContent = ammo;
    if (ammo === 0) {
      this.ammoCurrentEl.style.color = '#ff4444';
    } else if (ammo <= 5) {
      this.ammoCurrentEl.style.color = '#ffd93d';
    } else {
      this.ammoCurrentEl.style.color = '#fff';
    }
    const labelEl = document.getElementById('ammo-label');
    if (labelEl && weaponName) labelEl.textContent = weaponName.toUpperCase();
  }

  showReloading(show) {
    const ammoContainer = document.getElementById('ammo-container');
    if (show) {
      this.ammoCurrentEl.textContent = 'RELOADING';
      this.ammoCurrentEl.style.color = '#ffd93d';
      this.ammoCurrentEl.style.fontSize = '18px';
    } else {
      this.ammoCurrentEl.style.fontSize = '';
    }
  }

  showHitFlash() {
    this.hitFlash.style.background = 'rgba(255, 0, 0, 0.25)';
    setTimeout(() => {
      this.hitFlash.style.background = 'rgba(255, 0, 0, 0)';
    }, 150);
  }

  showHitMarker() {
    this.hitMarkerEl.style.opacity = '1';
    if (this.hitMarkerTimeout) clearTimeout(this.hitMarkerTimeout);
    this.hitMarkerTimeout = setTimeout(() => {
      this.hitMarkerEl.style.opacity = '0';
    }, 300);
  }

  addKillMessage(message, color = '#fff') {
    const el = document.createElement('div');
    el.className = 'kill-message';
    el.style.borderLeftColor = color;
    el.textContent = message;
    this.killFeed.appendChild(el);

    setTimeout(() => el.remove(), 3000);

    // Keep max 5 messages
    while (this.killFeed.children.length > 5) {
      this.killFeed.removeChild(this.killFeed.firstChild);
    }
  }
}
