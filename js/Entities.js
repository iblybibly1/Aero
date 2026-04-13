/**
 * Entities.js — All game entity classes.
 * Jet, Bullet, Missile, PowerUp, Explosion (particle).
 * Each class has update(dt) and draw(ctx, camX, camY) methods.
 */

/* ─────────────────────────────────────────────────
   Unique ID generator (lightweight)
───────────────────────────────────────────────── */
let _eid = 0;
function genId() { return ++_eid; }

/* ─────────────────────────────────────────────────
   Helper — angle difference normalised to [-π, π]
───────────────────────────────────────────────── */
function angleDiff(a, b) {
  let d = a - b;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* ═══════════════════════════════════════════════
   JET — player or enemy aircraft
═══════════════════════════════════════════════ */
class Jet {
  /**
   * @param {object} opts
   * @param {string} opts.id        - Network/local unique ID
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {string} opts.color     - CSS hex color
   * @param {string} opts.name      - Display name
   * @param {string} opts.team      - 'red' | 'blue' | 'none'
   * @param {boolean} opts.isLocal  - Is this the local player?
   * @param {boolean} opts.isAI     - Controlled by AI bot?
   */
  constructor(opts) {
    this.id       = opts.id    ?? String(genId());
    this.x        = opts.x    ?? 200;
    this.y        = opts.y    ?? 200;
    this.color    = opts.color ?? '#4fc3f7';
    this.name     = opts.name  ?? 'Player';
    this.team     = opts.team  ?? 'none';
    this.isLocal  = opts.isLocal ?? false;
    this.isAI     = opts.isAI    ?? false;

    this.angle    = 0;      // radians — 0 = pointing up
    this.radius   = Config.JET_RADIUS;
    this.speed    = Config.JET_SPEED;
    this.alive    = true;
    this.score    = 0;
    this.kills    = 0;
    this.deaths   = 0;

    /* Respawn */
    this.respawnTimer = 0;

    /* Power-up states */
    this.hasShield      = false; this.shieldTimer    = 0;
    this.hasRapidFire   = false; this.rapidFireTimer = 0;
    this.hasSpeedBoost  = false; this.speedTimer     = 0;

    /* Weapons */
    this.lastBulletTime = 0;
    this.missileCooldown = 0;  // seconds remaining
    this.get missileReady() { return this.missileCooldown <= 0; }

    /* Visual */
    this.damageFlash    = 0;   // countdown in seconds
    this._thrusterPulse = 0;   // oscillation for thruster glow

    /* AI state (ignored for human players) */
    this.ai = { state: 'wander', wanderAngle: Math.random() * Math.PI * 2,
                wanderTimer: 0, target: null };
  }

  /* ── Getters for current rates ── */
  get fireRateMs() {
    return this.hasRapidFire ? Config.RAPID_FIRE_MS : Config.FIRE_RATE_MS;
  }
  get currentSpeed() {
    return this.hasSpeedBoost ? this.speed * Config.SPEED_BOOST : this.speed;
  }

  /* ── Apply power-up ── */
  applyPowerUp(type) {
    if (type === 'shield')    { this.hasShield    = true; this.shieldTimer    = Config.SHIELD_DURATION; }
    if (type === 'rapidfire') { this.hasRapidFire = true; this.rapidFireTimer = Config.RAPIDFIRE_DURATION; }
    if (type === 'speed')     { this.hasSpeedBoost= true; this.speedTimer     = Config.SPEED_DURATION; }
  }

  /* ── Physics update ── */
  update(dt) {
    if (!this.alive) {
      this.respawnTimer = Math.max(0, this.respawnTimer - dt);
      return;
    }

    /* Move in facing direction */
    this.x += Math.sin(this.angle) * this.currentSpeed * dt;
    this.y -= Math.cos(this.angle) * this.currentSpeed * dt;

    /* Wrap world */
    const W = Config.WORLD_W, H = Config.WORLD_H;
    if (this.x <  0) this.x += W;
    if (this.x >= W) this.x -= W;
    if (this.y <  0) this.y += H;
    if (this.y >= H) this.y -= H;

    /* Power-up countdowns */
    if (this.hasShield)    { this.shieldTimer    -= dt; if (this.shieldTimer    <= 0) this.hasShield    = false; }
    if (this.hasRapidFire) { this.rapidFireTimer -= dt; if (this.rapidFireTimer <= 0) this.hasRapidFire = false; }
    if (this.hasSpeedBoost){ this.speedTimer      -= dt; if (this.speedTimer     <= 0) this.hasSpeedBoost= false; }

    /* Missile cooldown */
    if (this.missileCooldown > 0) this.missileCooldown -= dt;

    /* Visuals */
    if (this.damageFlash > 0) this.damageFlash -= dt;
    this._thrusterPulse += dt * 8;
  }

  /* ── Circle collision ── */
  collidesWith(other) {
    const dx = this.x - other.x, dy = this.y - other.y;
    return Math.sqrt(dx*dx + dy*dy) < (this.radius + other.radius);
  }

  /* ── Kill this jet ── */
  kill(killer) {
    this.alive = false;
    this.respawnTimer = Config.RESPAWN_TIME;
    this.deaths++;
    if (killer && killer !== this) { killer.score++; killer.kills++; }
    /* Remove power-ups on death */
    this.hasShield = this.hasRapidFire = this.hasSpeedBoost = false;
  }

  /* ── Respawn at random world edge ── */
  respawn() {
    this.alive = true;
    const edge = Math.floor(Math.random() * 4);
    const W = Config.WORLD_W, H = Config.WORLD_H;
    const margin = 80;
    if (edge === 0) { this.x = Math.random() * W; this.y = margin; }
    else if (edge === 1) { this.x = W - margin; this.y = Math.random() * H; }
    else if (edge === 2) { this.x = Math.random() * W; this.y = H - margin; }
    else                 { this.x = margin; this.y = Math.random() * H; }
    this.angle = Math.random() * Math.PI * 2;
    this.missileCooldown = 0;
  }

  /* ── Drawing ── */
  draw(ctx, camX, camY) {
    const sx = this.x - camX;
    const sy = this.y - camY;

    // Skip if off-screen (with generous margin)
    const margin = 60;
    if (sx < -margin || sx > ctx.canvas.width + margin ||
        sy < -margin || sy > ctx.canvas.height + margin) return;

    if (!this.alive) return;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(this.angle);

    /* === Thruster glow === */
    const tPulse = 0.7 + 0.3 * Math.sin(this._thrusterPulse);
    const grd = ctx.createRadialGradient(0, 14, 0, 0, 14, 16 * tPulse);
    grd.addColorStop(0, 'rgba(80, 200, 255, 0.9)');
    grd.addColorStop(1, 'rgba(80, 200, 255, 0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(0, 18, 7 * tPulse, 10 * tPulse, 0, 0, Math.PI * 2);
    ctx.fill();

    /* === Jet body === */
    const flash = this.damageFlash > 0 && Math.floor(this.damageFlash * 10) % 2 === 0;
    const bodyColor = flash ? '#ff4444' : this.color;

    // Fuselage
    ctx.beginPath();
    ctx.moveTo(0, -22);    // nose
    ctx.lineTo(4, -8);
    ctx.lineTo(6, 10);
    ctx.lineTo(0, 8);
    ctx.lineTo(-6, 10);
    ctx.lineTo(-4, -8);
    ctx.closePath();
    ctx.fillStyle = bodyColor;
    ctx.fill();

    // Left wing
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(-20, 12);
    ctx.lineTo(-8, 12);
    ctx.closePath();
    ctx.fillStyle = bodyColor;
    ctx.fill();

    // Right wing
    ctx.beginPath();
    ctx.moveTo(4, 0);
    ctx.lineTo(20, 12);
    ctx.lineTo(8, 12);
    ctx.closePath();
    ctx.fillStyle = bodyColor;
    ctx.fill();

    // Tail fins
    ctx.beginPath();
    ctx.moveTo(-3, 8); ctx.lineTo(-10, 16); ctx.lineTo(-3, 14); ctx.closePath();
    ctx.fillStyle = bodyColor; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(3, 8); ctx.lineTo(10, 16); ctx.lineTo(3, 14); ctx.closePath();
    ctx.fillStyle = bodyColor; ctx.fill();

    // Highlight on fuselage
    ctx.beginPath();
    ctx.moveTo(0, -22); ctx.lineTo(2, -6); ctx.lineTo(0, 4); ctx.lineTo(-2, -6);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();

    /* === Shield effect === */
    if (this.hasShield) {
      const alphaPulse = 0.4 + 0.3 * Math.sin(Date.now() * 0.006);
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 180, 255, ${alphaPulse})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      const shgrd = ctx.createRadialGradient(0,0,10,0,0,30);
      shgrd.addColorStop(0, 'rgba(0,180,255,0)');
      shgrd.addColorStop(1, `rgba(0,180,255,${alphaPulse * 0.15})`);
      ctx.fillStyle = shgrd;
      ctx.fill();
    }

    ctx.restore();

    /* === Name label (above jet) === */
    ctx.save();
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.hasShield ? '#4fc3f7' : '#dde';
    ctx.fillText(this.name, sx, sy - 28);
    ctx.restore();
  }

  /* ── Serialise for network ── */
  toNetState() {
    return {
      id: this.id, x: this.x, y: this.y, angle: this.angle,
      color: this.color, name: this.name, team: this.team,
      alive: this.alive, respawnTimer: this.respawnTimer,
      score: this.score, kills: this.kills, deaths: this.deaths,
      hasShield: this.hasShield, shieldTimer: this.shieldTimer,
      hasRapidFire: this.hasRapidFire,
      hasSpeedBoost: this.hasSpeedBoost,
      missileCooldown: this.missileCooldown,
    };
  }

  /* ── Restore from network state ── */
  fromNetState(s) {
    this.x = s.x; this.y = s.y; this.angle = s.angle;
    this.alive = s.alive; this.respawnTimer = s.respawnTimer;
    this.score = s.score; this.kills = s.kills; this.deaths = s.deaths;
    this.hasShield = s.hasShield; this.shieldTimer = s.shieldTimer;
    this.hasRapidFire = s.hasRapidFire;
    this.hasSpeedBoost = s.hasSpeedBoost;
    this.missileCooldown = s.missileCooldown;
  }
}

/* ═══════════════════════════════════════════════
   BULLET — machine gun round
═══════════════════════════════════════════════ */
class Bullet {
  constructor(x, y, angle, ownerId, ownerTeam) {
    this.id       = String(genId());
    this.x        = x;
    this.y        = y;
    this.angle    = angle;
    this.ownerId  = ownerId;
    this.ownerTeam= ownerTeam;
    this.radius   = Config.BULLET_RADIUS;
    this.speed    = Config.BULLET_SPEED;
    this.vx       = Math.sin(angle) * this.speed;
    this.vy       = -Math.cos(angle) * this.speed;
    this.lifetime = Config.BULLET_LIFETIME;
    this.active   = true;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    /* Wrap */
    const W = Config.WORLD_W, H = Config.WORLD_H;
    if (this.x < 0) this.x += W; if (this.x >= W) this.x -= W;
    if (this.y < 0) this.y += H; if (this.y >= H) this.y -= H;
    this.lifetime -= dt;
    if (this.lifetime <= 0) this.active = false;
  }

  collidesWith(other) {
    const dx = this.x - other.x, dy = this.y - other.y;
    return Math.sqrt(dx*dx + dy*dy) < (this.radius + other.radius);
  }

  draw(ctx, camX, camY) {
    const sx = this.x - camX, sy = this.y - camY;
    ctx.save();
    // Bullet trail
    ctx.strokeStyle = 'rgba(255,220,50,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - this.vx * 0.04, sy - this.vy * 0.04);
    ctx.stroke();
    // Bullet dot
    ctx.fillStyle = '#ffeb3b';
    ctx.shadowColor = '#ff9800';
    ctx.shadowBlur  = 6;
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  toNetState() { return { id: this.id, x: this.x, y: this.y, angle: this.angle, ownerId: this.ownerId, ownerTeam: this.ownerTeam }; }
}

/* ═══════════════════════════════════════════════
   MISSILE — heat-seeking, 1-hit kill
═══════════════════════════════════════════════ */
class Missile {
  constructor(x, y, angle, ownerId, ownerTeam) {
    this.id        = String(genId());
    this.x         = x;
    this.y         = y;
    this.angle     = angle;
    this.ownerId   = ownerId;
    this.ownerTeam = ownerTeam;
    this.radius    = Config.MISSILE_RADIUS;
    this.speed     = Config.MISSILE_SPEED;
    this.trackTime = Config.MISSILE_TRACK_SEC;
    this.lifetime  = Config.MISSILE_LIFETIME;
    this.active    = true;
    this.target    = null; // Jet reference — only used host-side
    this._smoke    = [];   // particle trail
  }

  /* Find nearest enemy in forward cone — call once on spawn */
  acquireTarget(jets, ownerTeam) {
    let best = null, bestDist = Infinity;
    for (const j of jets) {
      if (j.id === this.ownerId || !j.alive) continue;
      if (ownerTeam !== 'none' && j.team === ownerTeam) continue; // no team-kill
      const dx = j.x - this.x, dy = j.y - this.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > 1200) continue;
      const toTarget = Math.atan2(dx, -dy);
      const diff = Math.abs(angleDiff(toTarget, this.angle));
      if (diff < Config.MISSILE_CONE && dist < bestDist) {
        best = j; bestDist = dist;
      }
    }
    this.target = best;
  }

  update(dt, jets) {
    if (this.trackTime > 0 && this.target) {
      /* Re-check target validity */
      if (!this.target.alive) { this.target = null; }
      else {
        const dx = this.target.x - this.x, dy = this.target.y - this.y;
        const desired = Math.atan2(dx, -dy);
        const diff = angleDiff(desired, this.angle);
        const turn = Math.min(Math.abs(diff), Config.MISSILE_TURN * dt);
        this.angle += Math.sign(diff) * turn;
      }
      this.trackTime -= dt;
    }

    this.x += Math.sin(this.angle) * this.speed * dt;
    this.y -= Math.cos(this.angle) * this.speed * dt;

    /* Wrap */
    const W = Config.WORLD_W, H = Config.WORLD_H;
    if (this.x < 0) this.x += W; if (this.x >= W) this.x -= W;
    if (this.y < 0) this.y += H; if (this.y >= H) this.y -= H;

    /* Smoke trail */
    this._smoke.push({ x: this.x, y: this.y, life: 0.5 });
    for (const s of this._smoke) s.life -= dt;
    this._smoke = this._smoke.filter(s => s.life > 0);

    this.lifetime -= dt;
    if (this.lifetime <= 0) this.active = false;
  }

  collidesWith(other) {
    const dx = this.x - other.x, dy = this.y - other.y;
    return Math.sqrt(dx*dx + dy*dy) < (this.radius + other.radius);
  }

  draw(ctx, camX, camY) {
    /* Smoke trail */
    for (const s of this._smoke) {
      const alpha = s.life * 1.5;
      ctx.fillStyle = `rgba(180,180,180,${Math.min(alpha, 0.4)})`;
      ctx.beginPath();
      ctx.arc(s.x - camX, s.y - camY, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    const sx = this.x - camX, sy = this.y - camY;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(this.angle);

    /* Body */
    ctx.fillStyle = '#e0e0e0';
    ctx.beginPath();
    ctx.ellipse(0, 0, 4, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    /* Warhead tip */
    ctx.fillStyle = '#ff5722';
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(3, -6); ctx.lineTo(-3, -6); ctx.closePath();
    ctx.fill();

    /* Exhaust flame */
    const flame = 0.7 + 0.3 * Math.sin(Date.now() * 0.03);
    ctx.fillStyle = `rgba(255, 160, 0, ${flame})`;
    ctx.beginPath();
    ctx.ellipse(0, 14, 3, 6 * flame, 0, 0, Math.PI * 2);
    ctx.fill();

    /* Homing lock indicator (flashing) */
    if (this.trackTime > 0 && this.target) {
      ctx.strokeStyle = `rgba(255,50,50,${0.5 + 0.5 * Math.sin(Date.now() * 0.015)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  toNetState() { return { id: this.id, x: this.x, y: this.y, angle: this.angle, trackTime: this.trackTime, ownerId: this.ownerId }; }
}

/* ═══════════════════════════════════════════════
   POWER-UP — collectible dropped on enemy death
═══════════════════════════════════════════════ */
class PowerUp {
  /** @param {'shield'|'rapidfire'|'speed'} type */
  constructor(x, y, type) {
    this.id       = String(genId());
    this.x        = x;
    this.y        = y;
    this.type     = type;
    this.radius   = Config.POWERUP_RADIUS;
    this.lifetime = Config.POWERUP_LIFETIME;
    this.active   = true;
    this._rot     = 0;
  }

  static COLORS = { shield: '#2196f3', rapidfire: '#f44336', speed: '#4caf50' };
  static ICONS  = { shield: '🛡',     rapidfire: '🔥',      speed: '⚡' };
  static LABELS = { shield: 'SHIELD', rapidfire: 'RAPID',   speed: 'SPEED' };

  update(dt) {
    this.lifetime -= dt;
    this._rot += dt * 1.5;
    if (this.lifetime <= 0) this.active = false;
  }

  collidesWith(jet) {
    const dx = this.x - jet.x, dy = this.y - jet.y;
    return Math.sqrt(dx*dx + dy*dy) < (this.radius + jet.radius);
  }

  draw(ctx, camX, camY) {
    /* Flicker when near expiry */
    if (this.lifetime < Config.POWERUP_FLICKER_AT &&
        Math.floor(this.lifetime * 5) % 2 === 0) return;

    const sx = this.x - camX, sy = this.y - camY;
    const color = PowerUp.COLORS[this.type];
    const icon  = PowerUp.ICONS[this.type];

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(this._rot);

    /* Outer ring */
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this._rot * 2);
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.stroke();

    /* Fill */
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.rotate(-this._rot); // keep icon upright
    ctx.font = `${this.radius}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, 0, 0);

    ctx.restore();

    /* Lifetime bar */
    const barW = 36, barH = 4;
    const progress = this.lifetime / Config.POWERUP_LIFETIME;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(sx - barW/2, sy + this.radius + 4, barW, barH);
    ctx.fillStyle = color;
    ctx.fillRect(sx - barW/2, sy + this.radius + 4, barW * progress, barH);
  }

  toNetState() { return { id: this.id, x: this.x, y: this.y, type: this.type, lifetime: this.lifetime }; }
}

/* ═══════════════════════════════════════════════
   EXPLOSION — visual-only particle burst
═══════════════════════════════════════════════ */
class Explosion {
  constructor(x, y, color = '#ff9800') {
    this.x = x; this.y = y;
    this.particles = [];
    const count = 20 + Math.floor(Math.random() * 15);
    for (let i = 0; i < count; i++) {
      const spd = 60 + Math.random() * 200;
      const ang = Math.random() * Math.PI * 2;
      this.particles.push({
        x: 0, y: 0,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 0.5 + Math.random() * 0.7,
        maxLife: 0,
        size: 2 + Math.random() * 5,
        color,
      });
      this.particles[i].maxLife = this.particles[i].life;
    }
    this.done = false;
  }

  update(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
      p.life -= dt;
    }
    this.done = this.particles.every(p => p.life <= 0);
  }

  draw(ctx, camX, camY) {
    const ox = this.x - camX, oy = this.y - camY;
    ctx.save();
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(ox + p.x, oy + p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
