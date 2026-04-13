/**
 * UI.js — Screen management, HUD updates, settings bindings.
 * Manages all overlay transitions and syncs settings to InputHandler.
 */
class UIManager {
  constructor(input) {
    this.input    = input;
    this.current  = 'menu';
    this._killFeedTimers = [];

    /* Missile cooldown animation state */
    this._missileCD      = 0;
    this._missileCDTotal = Config.MISSILE_COOLDOWN;

    /* Respawn overlay state */
    this._respawnTotal = Config.RESPAWN_TIME;

    /* Bind settings sliders/toggles */
    this._bindSettings('sensitivity-slider',     'sensitivity-value',     (v) => { input.setSensitivity(v); });
    this._bindSettings('sensitivity-slider-hud', 'sensitivity-value-hud', (v) => { input.setSensitivity(v); });

    /* Sync initial values */
    this._syncSettingsUI();
  }

  /* ──────────────────────────────────────────────
     SCREEN SWITCHING
  ────────────────────────────────────────────── */

  showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(`screen-${name}`);
    if (el) el.classList.add('active');
    this.current = name;
  }

  /* ──────────────────────────────────────────────
     HUD
  ────────────────────────────────────────────── */

  updateScore(score) {
    const el = document.getElementById('score-value');
    if (el) el.textContent = score;
  }

  updateAliveCount(n) {
    const el = document.getElementById('alive-count');
    if (el) el.textContent = n;
  }

  addKillFeed(killerName, victimName) {
    const feed = document.getElementById('kill-feed');
    if (!feed) return;
    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    entry.textContent = `${killerName} ✈ ${victimName}`;
    feed.prepend(entry);
    /* Remove after animation */
    const t = setTimeout(() => { entry.remove(); }, 3200);
    this._killFeedTimers.push(t);
    /* Max 5 entries */
    while (feed.children.length > 5) feed.removeChild(feed.lastChild);
  }

  /* Power-up button — shows when pending or active, hides otherwise */
  updatePowerUpBtn(jet) {
    if (!jet) return;
    const btn     = document.getElementById('btn-powerup');
    const iconEl  = document.getElementById('powerup-icon');
    const timerEl = document.getElementById('powerup-timer-text');
    if (!btn) return;

    const ICONS  = { shield: '🛡', rapidfire: '🔥', speed: '⚡' };
    const COLORS = { shield: '#1565c0', rapidfire: '#c62828', speed: '#2e7d32' };

    /* Determine state */
    let type = null, timerText = '', color = '';

    if (jet.hasShield) {
      type = 'shield'; color = COLORS.shield;
      timerText = Math.ceil(jet.shieldTimer) + 's';
    } else if (jet.hasRapidFire) {
      type = 'rapidfire'; color = COLORS.rapidfire;
      timerText = Math.ceil(jet.rapidFireTimer) + 's';
    } else if (jet.hasSpeedBoost) {
      type = 'speed'; color = COLORS.speed;
      timerText = Math.ceil(jet.speedTimer) + 's';
    } else if (jet.pendingPowerUp) {
      type = jet.pendingPowerUp; color = COLORS[type];
      timerText = 'USE!';
    }

    if (type) {
      btn.classList.remove('hidden');
      btn.style.background = `radial-gradient(circle, ${color}dd, ${color}88)`;
      btn.style.boxShadow  = `0 0 18px ${color}99`;
      btn.style.animation  = ''; /* don't override earned animation mid-pulse */
      if (iconEl)  iconEl.textContent  = ICONS[type];
      if (timerEl) timerEl.textContent = timerText;
    } else {
      btn.classList.add('hidden');
      btn.style.animation = '';
    }
  }

  /* Missile cooldown ring + text */
  updateMissileCooldown(cooldownRemaining) {
    const btn  = document.getElementById('btn-missile');
    const ring = document.getElementById('missile-cooldown-ring');
    const text = document.getElementById('missile-cooldown-text');
    if (!btn) return;

    if (cooldownRemaining > 0) {
      btn.classList.add('on-cooldown');
      /* Conic gradient fills clockwise as cooldown expires */
      const pct = Math.round((1 - cooldownRemaining / Config.MISSILE_COOLDOWN) * 100);
      if (ring) ring.style.background = `conic-gradient(rgba(79,195,247,0.5) ${pct}%, transparent ${pct}%)`;
      if (text) text.textContent = Math.ceil(cooldownRemaining) + 's';
    } else {
      btn.classList.remove('on-cooldown');
      if (ring) ring.style.background = 'none';
      if (text) text.textContent = 'MSLE';
    }
  }

  /* ──────────────────────────────────────────────
     RESPAWN OVERLAY
  ────────────────────────────────────────────── */

  showRespawn(totalSeconds) {
    this._respawnTotal = totalSeconds;
    const overlay = document.getElementById('respawn-overlay');
    if (overlay) overlay.classList.remove('hidden');
    this._respawnInterval = setInterval(() => this._tickRespawn(), 100);
  }

  _tickRespawn() {
    const bar      = document.getElementById('respawn-bar');
    const countdown= document.getElementById('respawn-countdown');
    /* Read from the actual jet if possible — injected by main.js */
    const remaining= this._respawnRemaining ?? this._respawnTotal;
    if (countdown) countdown.textContent = Math.ceil(remaining);
    if (bar) bar.style.width = (remaining / this._respawnTotal * 100) + '%';
    if (remaining <= 0) this.hideRespawn();
  }

  hideRespawn() {
    const overlay = document.getElementById('respawn-overlay');
    if (overlay) overlay.classList.add('hidden');
    if (this._respawnInterval) { clearInterval(this._respawnInterval); this._respawnInterval = null; }
  }

  /* ──────────────────────────────────────────────
     PAUSE / IN-GAME SETTINGS
  ────────────────────────────────────────────── */

  showPause() {
    const el = document.getElementById('pause-overlay');
    if (el) el.classList.remove('hidden');
  }
  hidePause() {
    const el = document.getElementById('pause-overlay');
    if (el) el.classList.add('hidden');
  }

  /* ──────────────────────────────────────────────
     GAME OVER
  ────────────────────────────────────────────── */

  showGameOver(stats) {
    this.showScreen('gameover');
    const statsEl = document.getElementById('gameover-stats');
    if (!statsEl) return;
    statsEl.innerHTML = `
      <div class="stat-row"><span>Score</span><span>${stats.score}</span></div>
      <div class="stat-row"><span>Kills</span><span>${stats.kills}</span></div>
      <div class="stat-row"><span>Deaths</span><span>${stats.deaths}</span></div>
    `;
  }

  /* ──────────────────────────────────────────────
     LOBBY HELPERS
  ────────────────────────────────────────────── */

  showRoomCode(code) {
    const box  = document.getElementById('room-code-display');
    const text = document.getElementById('room-code-text');
    if (box)  box.classList.remove('hidden');
    if (text) text.textContent = code;
  }

  setLobbyMode(isHost) {
    const modeSec  = document.getElementById('mode-section');
    const startBtn = document.getElementById('btn-start-game');
    if (modeSec)  modeSec.classList.toggle('hidden', !isHost);
    if (startBtn) startBtn.classList.toggle('hidden', !isHost);
  }

  updatePlayerList(players) {
    const ul    = document.getElementById('players-list');
    const count = document.getElementById('player-count');
    if (!ul) return;
    ul.innerHTML = '';
    players.forEach(p => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="player-dot" style="background:${p.color}"></span>
        <span>${p.name}</span>
        ${p.ready ? '<span class="player-ready-badge">✓ Ready</span>' : ''}
      `;
      ul.appendChild(li);
    });
    if (count) count.textContent = players.length;
  }

  setJoinError(msg) {
    const el = document.getElementById('join-error');
    if (el) el.textContent = msg;
  }

  /* ──────────────────────────────────────────────
     SETTINGS BINDING HELPERS
  ────────────────────────────────────────────── */

  _bindSettings(sliderId, valueId, onChange) {
    const slider = document.getElementById(sliderId);
    const label  = document.getElementById(valueId);
    if (!slider) return;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value).toFixed(1);
      if (label) label.textContent = v;
      onChange(v);
      /* Keep both slider pairs in sync */
      this._syncSettingsUI();
    });
  }

  _bindToggle(toggleId, onChange) {
    const el = document.getElementById(toggleId);
    if (!el) return;
    el.addEventListener('change', () => {
      onChange(el.checked);
      this._syncSettingsUI();
    });
  }

  _syncSettingsUI() {
    /* Sync slider values */
    ['sensitivity-slider', 'sensitivity-slider-hud'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = this.input.sensitivity;
    });
    ['sensitivity-value', 'sensitivity-value-hud'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = this.input.sensitivity.toFixed(1);
    });
  }
}
