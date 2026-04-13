/**
 * InputHandler.js — Joystick steering + touch fire/missile buttons.
 * Gyroscope removed entirely. Joystick is the only steering input.
 */
class InputHandler {
  constructor() {
    /* Settings */
    this.sensitivity = parseFloat(localStorage.getItem('aero_sensitivity') ?? Config.DEFAULT_SENSITIVITY);

    /* Joystick state */
    this._joystickActive  = false;
    this._joystickTurn    = 0;        // -1 (hard left) … +1 (hard right)
    this._joystickTouchId = null;
    this._joystickBaseX   = 0;
    this._joystickBaseY   = 0;
    this._joystickDX      = 0;
    this._joystickDY      = 0;

    /* Fire button state */
    this.firing = false;

    /* Drag-to-reposition state */
    this.layoutMode = false;
    this._dragBtn   = null;
    this._dragOffX  = 0;
    this._dragOffY  = 0;

    /* Callbacks */
    this.onMissile  = null;
    this.onPowerUp  = null;
  }

  /* ─────────────────────────────────────────
     TURN RATE  (called every frame by engine)
  ───────────────────────────────────────── */
  getTurnRate() {
    if (!this._joystickActive) return 0;
    const sens = this.sensitivity / Config.DEFAULT_SENSITIVITY;
    return this._joystickTurn * Config.JET_TURN_SPEED * sens;
  }

  /* ─────────────────────────────────────────
     JOYSTICK SETUP  (call once on game start)
  ───────────────────────────────────────── */
  setupJoystick() {
    const zone = document.getElementById('joystick-zone');
    if (!zone) return;
    zone.classList.remove('hidden');

    const DEAD  = 8;   // px deadzone radius
    const MAX   = 52;  // px max travel from base

    const start = (id, cx, cy) => {
      if (this._joystickTouchId !== null) return;
      this._joystickTouchId = id;
      this._joystickBaseX   = cx;
      this._joystickBaseY   = cy;
      this._joystickActive  = false; // not active until outside deadzone
      this._joystickTurn    = 0;
      this._setKnob(0, 0);
      zone.classList.add('active');
    };

    const move = (id, cx, cy) => {
      if (this._joystickTouchId !== id) return;
      const dx = cx - this._joystickBaseX;
      const dy = cy - this._joystickBaseY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < DEAD) {
        this._joystickActive = false;
        this._joystickTurn   = 0;
        this._setKnob(0, 0);
        return;
      }

      this._joystickActive = true;
      /* Clamp knob travel to MAX radius */
      const clampedDX = Math.max(-MAX, Math.min(MAX, dx));
      const clampedDY = Math.max(-MAX, Math.min(MAX, dy));
      /* Only horizontal axis steers the jet */
      this._joystickTurn = Math.max(-1, Math.min(1, dx / MAX));
      this._setKnob(clampedDX, clampedDY);
    };

    const end = (id) => {
      if (this._joystickTouchId !== id) return;
      this._joystickTouchId = null;
      this._joystickActive  = false;
      this._joystickTurn    = 0;
      this._setKnob(0, 0);
      zone.classList.remove('active');
    };

    /* Touch events */
    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      start(t.identifier, t.clientX, t.clientY);
    }, { passive: false });

    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) move(t.identifier, t.clientX, t.clientY);
    }, { passive: false });

    zone.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) end(t.identifier);
    });
    zone.addEventListener('touchcancel', (e) => {
      for (const t of e.changedTouches) end(t.identifier);
    });

    /* Mouse fallback for desktop testing */
    let down = false;
    zone.addEventListener('mousedown', (e) => {
      down = true;
      start('mouse', e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => {
      if (down) move('mouse', e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', () => {
      if (down) { down = false; end('mouse'); }
    });
  }

  _setKnob(dx, dy) {
    const knob = document.getElementById('joystick-knob');
    if (knob) knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  /* ─────────────────────────────────────────
     ACTION BUTTONS  (fire, missile, power-up)
  ───────────────────────────────────────── */
  bindButtons() {
    this._bindFireBtn();
    this._bindMissileBtn();
    this._bindPowerUpBtn();
    this._setupDrag(document.getElementById('btn-fire'));
    this._setupDrag(document.getElementById('btn-missile'));
    this._restorePositions();
  }

  _bindFireBtn() {
    const btn = document.getElementById('btn-fire');
    if (!btn) return;
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.layoutMode) return;
      this.firing = true;
      btn.classList.add('pressed');
    }, { passive: false });
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.firing = false;
      btn.classList.remove('pressed');
    }, { passive: false });
    btn.addEventListener('mousedown', () => { if (!this.layoutMode) this.firing = true; });
    btn.addEventListener('mouseup',   () => { this.firing = false; });
  }

  _bindMissileBtn() {
    const btn = document.getElementById('btn-missile');
    if (!btn) return;
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (!this.layoutMode && this.onMissile) this.onMissile();
    }, { passive: false });
    btn.addEventListener('mousedown', () => {
      if (!this.layoutMode && this.onMissile) this.onMissile();
    });
  }

  _bindPowerUpBtn() {
    const btn = document.getElementById('btn-powerup');
    if (!btn) return;
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.onPowerUp) this.onPowerUp();
    }, { passive: false });
    btn.addEventListener('mousedown', () => {
      if (this.onPowerUp) this.onPowerUp();
    });
  }

  /* ─────────────────────────────────────────
     DRAGGABLE HUD BUTTONS
  ───────────────────────────────────────── */
  toggleLayoutMode() {
    this.layoutMode = !this.layoutMode;
    document.getElementById('hud').classList.toggle('layout-mode', this.layoutMode);
    if (!this.layoutMode) this._savePositions();
    return this.layoutMode;
  }

  _setupDrag(el) {
    if (!el) return;
    const onStart = (cx, cy) => {
      if (!this.layoutMode) return;
      this._dragBtn  = el;
      const r = el.getBoundingClientRect();
      this._dragOffX = cx - r.left;
      this._dragOffY = cy - r.top;
      el.style.transition = 'none';
    };
    const onMove = (cx, cy) => {
      if (this._dragBtn !== el) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      el.style.left   = Math.max(0, Math.min(vw - el.offsetWidth,  cx - this._dragOffX)) + 'px';
      el.style.top    = Math.max(0, Math.min(vh - el.offsetHeight, cy - this._dragOffY)) + 'px';
      el.style.right  = 'auto';
      el.style.bottom = 'auto';
    };
    const onEnd = () => { this._dragBtn = null; };

    el.addEventListener('touchstart', (e) => { if (this.layoutMode) { e.preventDefault(); onStart(e.touches[0].clientX, e.touches[0].clientY); } }, { passive: false });
    el.addEventListener('touchmove',  (e) => { if (this._dragBtn === el) { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); } }, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('mousedown', (e) => onStart(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => { if (this._dragBtn === el) onMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup', onEnd);
  }

  _savePositions() {
    ['btn-fire','btn-missile'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      localStorage.setItem(`aero_btn_${id}`, JSON.stringify({ left: r.left, top: r.top }));
    });
  }

  _restorePositions() {
    ['btn-fire','btn-missile'].forEach(id => {
      const raw = localStorage.getItem(`aero_btn_${id}`);
      if (!raw) return;
      try {
        const pos = JSON.parse(raw);
        const el  = document.getElementById(id);
        if (!el) return;
        el.style.left   = Math.min(pos.left, window.innerWidth  - el.offsetWidth)  + 'px';
        el.style.top    = Math.min(pos.top,  window.innerHeight - el.offsetHeight) + 'px';
        el.style.right  = 'auto';
        el.style.bottom = 'auto';
      } catch(_) {}
    });
  }

  resetPositions() {
    ['btn-fire','btn-missile'].forEach(id => {
      localStorage.removeItem(`aero_btn_${id}`);
      const el = document.getElementById(id);
      if (el) el.style.cssText = '';
    });
  }

  setSensitivity(v) {
    this.sensitivity = parseFloat(v);
    localStorage.setItem('aero_sensitivity', v);
  }

  stop() { this.firing = false; }
}
