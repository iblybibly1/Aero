/**
 * InputHandler.js
 * Manages:
 *   - DeviceOrientation API (gyroscope) with iOS 13+ permission
 *   - Touch buttons (fire, missile) with zero-latency touchstart
 *   - Draggable HUD button repositioning (saved to localStorage)
 */
class InputHandler {
  constructor() {
    /* Gyroscope state */
    this.tiltX = 0;      // beta  (front-back tilt, -180..180)
    this.tiltY = 0;      // gamma (left-right tilt, -90..90)
    this.gyroEnabled  = false;
    this.gyroPermission = 'unknown'; // 'granted' | 'denied' | 'unknown'

    /* Settings */
    this.sensitivity = parseFloat(localStorage.getItem('aero_sensitivity') ?? Config.DEFAULT_SENSITIVITY);
    this.invertY     = localStorage.getItem('aero_invertY') === 'true';

    /* Button pressed states */
    this.firing      = false;
    this.missileFired= false; // pulse flag — read once per frame

    /* Virtual joystick (fallback when no gyro) */
    this._joystickActive = false;
    this._joystickTurn   = 0;   // -1 (left) to +1 (right)
    this._joystickTouchId= null;
    this._joystickBaseX  = 0;
    this._joystickBaseY  = 0;

    /* Drag state */
    this.layoutMode  = false;
    this._dragBtn    = null;
    this._dragOffX   = 0;
    this._dragOffY   = 0;

    /* Callbacks */
    this.onFire    = null;
    this.onMissile = null;

    this._bindOrientationEvent = this._onOrientation.bind(this);
  }

  /* ──────────────────────────────────────────────────────
     GYROSCOPE
  ────────────────────────────────────────────────────── */

  /**
   * Request DeviceOrientation permission.
   * Must be called from a user gesture (touchstart / click).
   * Returns a promise that resolves to 'granted' | 'denied' | 'not-required'.
   */
  async requestGyroPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+ path
      try {
        const result = await DeviceOrientationEvent.requestPermission();
        this.gyroPermission = result;
        if (result === 'granted') this._startListening();
        return result;
      } catch (e) {
        console.warn('Gyro permission error:', e);
        this.gyroPermission = 'denied';
        return 'denied';
      }
    } else {
      // Android / desktop — no explicit permission needed
      this._startListening();
      this.gyroPermission = 'granted';
      return 'not-required';
    }
  }

  _startListening() {
    window.addEventListener('deviceorientation', this._bindOrientationEvent, true);
    this.gyroEnabled = true;
  }

  _onOrientation(e) {
    /* gamma = left-right tilt  (-90 to 90)
       beta  = front-back tilt  (-180 to 180)
       We use gamma for horizontal steering in landscape mode.
       In landscape, gamma ranges roughly -30 to 30 for normal tilt. */
    this.tiltY = e.gamma ?? 0; // steering axis (left/right)
    this.tiltX = e.beta  ?? 0; // pitch axis (forward/back)
  }

  /**
   * Get the desired jet turn rate from current tilt.
   * Returns a value in radians/second to ADD to jet angle.
   */
  getTurnRate() {
    /* Virtual joystick overrides gyro if being used */
    if (this._joystickActive) {
      return this._joystickTurn * Config.JET_TURN_SPEED * (this.sensitivity / Config.DEFAULT_SENSITIVITY);
    }
    if (!this.gyroEnabled) return 0;
    /* In landscape mode, gamma (tiltY) drives left/right. */
    let raw = this.tiltY; // degrees
    if (this.invertY) raw = -raw;
    /* Deadzone ±3° to avoid drift */
    if (Math.abs(raw) < 3) return 0;
    /* Normalise to -1..1 range over ±45° */
    const norm = Math.max(-1, Math.min(1, raw / 45));
    return norm * Config.JET_TURN_SPEED * (this.sensitivity / Config.DEFAULT_SENSITIVITY);
  }

  stop() {
    window.removeEventListener('deviceorientation', this._bindOrientationEvent, true);
    this.gyroEnabled = false;
  }

  /* ──────────────────────────────────────────────────────
     VIRTUAL JOYSTICK  (shown when gyro unavailable)
  ────────────────────────────────────────────────────── */
  setupJoystick() {
    const stick = document.getElementById('joystick-zone');
    if (!stick) return;

    /* Show joystick zone always — hide if gyro ends up working */
    stick.classList.remove('hidden');

    const onStart = (id, cx, cy) => {
      if (this._joystickTouchId !== null) return;
      this._joystickTouchId = id;
      this._joystickBaseX   = cx;
      this._joystickBaseY   = cy;
      this._joystickActive  = true;
      this._updateStickVisual(0, 0);
      stick.classList.add('active');
    };
    const onMove = (id, cx, cy) => {
      if (this._joystickTouchId !== id) return;
      const dx  = cx - this._joystickBaseX;
      const dy  = cy - this._joystickBaseY;
      const max = 55; // px travel
      /* Horizontal = steer, vertical = ignored (jet always moves forward) */
      this._joystickTurn = Math.max(-1, Math.min(1, dx / max));
      this._updateStickVisual(
        Math.max(-max, Math.min(max, dx)),
        Math.max(-max, Math.min(max, dy))
      );
    };
    const onEnd = (id) => {
      if (this._joystickTouchId !== id) return;
      this._joystickTouchId = null;
      this._joystickActive  = false;
      this._joystickTurn    = 0;
      this._updateStickVisual(0, 0);
      stick.classList.remove('active');
    };

    stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      onStart(t.identifier, t.clientX, t.clientY);
    }, { passive: false });
    stick.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) onMove(t.identifier, t.clientX, t.clientY);
    }, { passive: false });
    stick.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) onEnd(t.identifier);
    });
    stick.addEventListener('touchcancel', (e) => {
      for (const t of e.changedTouches) onEnd(t.identifier);
    });

    /* Mouse fallback for desktop testing */
    let mouseDown = false;
    stick.addEventListener('mousedown', (e) => { mouseDown = true; onStart('mouse', e.clientX, e.clientY); });
    window.addEventListener('mousemove', (e) => { if (mouseDown) onMove('mouse', e.clientX, e.clientY); });
    window.addEventListener('mouseup',   ()  => { if (mouseDown) { mouseDown = false; onEnd('mouse'); } });
  }

  _updateStickVisual(dx, dy) {
    const knob = document.getElementById('joystick-knob');
    if (knob) knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  hideJoystick() {
    const stick = document.getElementById('joystick-zone');
    if (stick) stick.classList.add('hidden');
  }

  /* ──────────────────────────────────────────────────────
     TOUCH BUTTONS
  ────────────────────────────────────────────────────── */

  /**
   * Attach touch/mouse listeners to the fire & missile buttons.
   * Call once when the HUD is visible.
   */
  bindButtons() {
    const fireBtn    = document.getElementById('btn-fire');
    const missileBtn = document.getElementById('btn-missile');

    /* === FIRE button — touchstart begins continuous fire === */
    fireBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (!this.layoutMode) {
        this.firing = true;
        fireBtn.classList.add('pressed');
      }
    }, { passive: false });

    fireBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.firing = false;
      fireBtn.classList.remove('pressed');
    }, { passive: false });

    /* Mouse fallback (for desktop testing) */
    fireBtn.addEventListener('mousedown', () => { if (!this.layoutMode) this.firing = true;  });
    fireBtn.addEventListener('mouseup',   () => { this.firing = false; });

    /* === MISSILE button — single tap, then cooldown === */
    missileBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (!this.layoutMode && this.onMissile) this.onMissile();
    }, { passive: false });

    missileBtn.addEventListener('mousedown', () => {
      if (!this.layoutMode && this.onMissile) this.onMissile();
    });

    /* === Draggable buttons === */
    this._setupDrag(fireBtn);
    this._setupDrag(missileBtn);

    /* Restore saved positions */
    this._restorePositions();
  }

  /* ──────────────────────────────────────────────────────
     DRAGGABLE HUD
  ────────────────────────────────────────────────────── */

  toggleLayoutMode() {
    this.layoutMode = !this.layoutMode;
    const hud = document.getElementById('hud');
    if (this.layoutMode) {
      hud.classList.add('layout-mode');
    } else {
      hud.classList.remove('layout-mode');
      this._savePositions();
    }
    return this.layoutMode;
  }

  _setupDrag(el) {
    const onStart = (clientX, clientY) => {
      if (!this.layoutMode) return;
      this._dragBtn = el;
      const rect = el.getBoundingClientRect();
      this._dragOffX = clientX - rect.left;
      this._dragOffY = clientY - rect.top;
      el.style.transition = 'none';
    };
    const onMove = (clientX, clientY) => {
      if (this._dragBtn !== el) return;
      /* Position relative to viewport — convert to "bottom/right" style */
      const vw = window.innerWidth, vh = window.innerHeight;
      let newLeft = clientX - this._dragOffX;
      let newTop  = clientY - this._dragOffY;
      /* Clamp to screen */
      newLeft = Math.max(0, Math.min(vw - el.offsetWidth,  newLeft));
      newTop  = Math.max(0, Math.min(vh - el.offsetHeight, newTop));
      el.style.left   = newLeft + 'px';
      el.style.top    = newTop  + 'px';
      el.style.right  = 'auto';
      el.style.bottom = 'auto';
    };
    const onEnd = () => { this._dragBtn = null; };

    /* Touch */
    el.addEventListener('touchstart', (e) => { if (this.layoutMode) { e.preventDefault(); onStart(e.touches[0].clientX, e.touches[0].clientY); } }, { passive: false });
    el.addEventListener('touchmove',  (e) => { if (this._dragBtn === el) { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); } }, { passive: false });
    el.addEventListener('touchend',   onEnd);
    /* Mouse */
    el.addEventListener('mousedown', (e) => onStart(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => { if (this._dragBtn === el) onMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup',   onEnd);
  }

  _savePositions() {
    const save = (id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      localStorage.setItem(`aero_btn_${id}`, JSON.stringify({ left: rect.left, top: rect.top }));
    };
    save('btn-fire');
    save('btn-missile');
  }

  _restorePositions() {
    const restore = (id) => {
      const raw = localStorage.getItem(`aero_btn_${id}`);
      if (!raw) return;
      try {
        const pos = JSON.parse(raw);
        const el  = document.getElementById(id);
        if (!el) return;
        const vw = window.innerWidth, vh = window.innerHeight;
        el.style.left   = Math.min(pos.left, vw - el.offsetWidth)  + 'px';
        el.style.top    = Math.min(pos.top,  vh - el.offsetHeight) + 'px';
        el.style.right  = 'auto';
        el.style.bottom = 'auto';
      } catch(_) {}
    };
    restore('btn-fire');
    restore('btn-missile');
  }

  resetPositions() {
    localStorage.removeItem('aero_btn_btn-fire');
    localStorage.removeItem('aero_btn_btn-missile');
    const fireBtn    = document.getElementById('btn-fire');
    const missileBtn = document.getElementById('btn-missile');
    if (fireBtn)    { fireBtn.style.cssText    = ''; }
    if (missileBtn) { missileBtn.style.cssText = ''; }
  }

  /* ──────────────────────────────────────────────────────
     SETTINGS PERSISTENCE
  ────────────────────────────────────────────────────── */

  setSensitivity(v) {
    this.sensitivity = parseFloat(v);
    localStorage.setItem('aero_sensitivity', v);
  }
  setInvertY(v) {
    this.invertY = v;
    localStorage.setItem('aero_invertY', String(v));
  }
}
