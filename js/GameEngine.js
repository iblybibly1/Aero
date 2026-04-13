/**
 * GameEngine.js
 * Core game loop, world state, rendering, AI, collision, power-ups.
 *
 * Works in two modes:
 *   SINGLEPLAYER — host authority, local player, AI enemies.
 *   MULTIPLAYER  — host runs authoritative sim; clients render received state.
 */
class GameEngine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {InputHandler}      input
   * @param {NetworkManager|null} net  null → singleplayer
   * @param {object} playerInfo  { id, name, color, team }
   * @param {object} gameOpts   { mode:'solo'|'team', isHost, isSinglePlayer }
   */
  constructor(canvas, input, net, playerInfo, gameOpts) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.input   = input;
    this.net     = net;
    this.opts    = gameOpts;

    /* ── Resize canvas ── */
    this._resize();
    window.addEventListener('resize', () => this._resize());

    /* ── World entities ── */
    this.jets      = [];   // Jet[]
    this.bullets   = [];   // Bullet[]
    this.missiles  = [];   // Missile[]
    this.powerups  = [];   // PowerUp[]
    this.explosions= [];   // Explosion[]

    /* ── Local player ── */
    this.localJet = null;

    /* ── Camera ── */
    this.camX = 0;
    this.camY = 0;

    /* ── Background clouds (decorative, static world objects) ── */
    this._clouds = this._genClouds(60);

    /* ── Timing ── */
    this._lastTime   = 0;
    this._rafId      = null;
    this._running    = false;

    /* ── AI spawn timer (singleplayer) ── */
    this._aiSpawnTimer    = 3;
    this._aiSpawnInterval = 5; // seconds between AI spawns
    this._maxAI           = 8;

    /* ── Host sync timer (multiplayer host) ── */
    this._syncTimer = 0;
    this._syncPeriod = 1 / Config.HOST_SYNC_HZ;

    /* ── UI callbacks ── */
    this.onKillFeed    = null; // (killerName, victimName)
    this.onLocalDeath  = null; // ()  — show respawn overlay
    this.onLocalRespawn= null; // ()  — hide respawn overlay
    this.onScoreUpdate = null; // (score)
    this.onPlayerCountUpdate = null; // (aliveCount)

    /* Spawn local player */
    this._spawnLocalPlayer(playerInfo);

    /* Multiplayer client: hook into network */
    if (net && !gameOpts.isHost) {
      net.onStateReceived = (state) => this._applyNetState(state);
    }
    if (net && gameOpts.isHost) {
      net.onPlayerJoined = (info) => this._addNetPlayer(info);
      net.onPlayerLeft   = (pid)  => this._removeNetPlayer(pid);
    }
  }

  /* ──────────────────────────────────────────────
     INIT
  ────────────────────────────────────────────── */

  _spawnLocalPlayer(info) {
    const jet = new Jet({
      id:      info.id ?? 'local',
      name:    info.name ?? 'You',
      color:   info.color ?? '#4fc3f7',
      team:    info.team  ?? 'none',
      x:       Config.WORLD_W / 2 + (Math.random() - 0.5) * 600,
      y:       Config.WORLD_H / 2 + (Math.random() - 0.5) * 600,
      isLocal: true,
      isAI:    false,
    });
    this.jets.push(jet);
    this.localJet = jet;
  }

  _spawnAI() {
    if (this.jets.filter(j => j.isAI).length >= this._maxAI) return;
    const colors = ['#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e91e63'];
    const names  = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Ghost','Hawk'];
    const jet = new Jet({
      id:    'ai_' + Date.now(),
      name:  names[Math.floor(Math.random() * names.length)],
      color: colors[Math.floor(Math.random() * colors.length)],
      team:  'none',
      isAI:  true,
    });
    jet.respawn();
    this.jets.push(jet);
  }

  _addNetPlayer(info) {
    /* Don't duplicate */
    if (this.jets.find(j => j.id === info.peerId)) return;
    const jet = new Jet({
      id:    info.peerId,
      name:  info.name  ?? 'Pilot',
      color: info.color ?? '#e74c3c',
      team:  info.team  ?? 'none',
      isLocal: false,
      isAI:    false,
    });
    jet.respawn();
    this.jets.push(jet);
  }

  _removeNetPlayer(pid) {
    this.jets = this.jets.filter(j => j.id !== pid);
  }

  _genClouds(count) {
    const clouds = [];
    for (let i = 0; i < count; i++) {
      clouds.push({
        x: Math.random() * Config.WORLD_W,
        y: Math.random() * Config.WORLD_H,
        r: 40 + Math.random() * 120,
        alpha: 0.03 + Math.random() * 0.05,
      });
    }
    return clouds;
  }

  /* ──────────────────────────────────────────────
     GAME LOOP
  ────────────────────────────────────────────── */

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    this._rafId = requestAnimationFrame((t) => this._loop(t));
  }

  stop() {
    this._running = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  _loop(timestamp) {
    if (!this._running) return;
    /* Fixed timestep capped at 100ms to avoid spiral of death */
    const dt = Math.min((timestamp - this._lastTime) / 1000, 0.1);
    this._lastTime = timestamp;

    this._update(dt);
    this._render();

    this._rafId = requestAnimationFrame((t) => this._loop(t));
  }

  /* ──────────────────────────────────────────────
     UPDATE
  ────────────────────────────────────────────── */

  _update(dt) {
    const isAuthoritative = this.opts.isSinglePlayer || this.opts.isHost;

    /* ── Local player input → jet angle ── */
    if (this.localJet && this.localJet.alive) {
      const turnRate = this.input.getTurnRate();
      this.localJet.angle += turnRate * dt;

      /* Fire machine gun */
      if (this.input.firing) {
        this._tryFireBullet(this.localJet);
      }
    }

    /* ── Multiplayer client: send input to host ── */
    if (this.net && !this.opts.isHost && this.localJet) {
      this.net.sendInput({
        angle:        this.localJet.angle,
        firing:       this.input.firing,
        missileFired: false, // handled separately via callback
      });
      /* Client does NOT run physics — just render */
      this._render();
      return;
    }

    /* ── Authoritative: apply client inputs (host) ── */
    if (this.net && this.opts.isHost) {
      const inputs = this.net.flushClientInputs();
      for (const [id, inp] of Object.entries(inputs)) {
        const jet = this.jets.find(j => j.id === id);
        if (!jet || !jet.alive) continue;
        jet.angle = inp.angle;
        if (inp.firing)       this._tryFireBullet(jet);
        if (inp.missileFired) this._tryFireMissile(jet);
      }
    }

    /* ── AI behaviour ── */
    if (this.opts.isSinglePlayer) {
      this._aiSpawnTimer -= dt;
      if (this._aiSpawnTimer <= 0) {
        this._spawnAI();
        this._aiSpawnTimer = this._aiSpawnInterval;
      }
      for (const jet of this.jets.filter(j => j.isAI)) {
        this._updateAI(jet, dt);
      }
    }

    /* ── Physics ── */
    for (const jet of this.jets)       jet.update(dt);
    for (const b   of this.bullets)    b.update(dt);
    for (const m   of this.missiles)   m.update(dt, this.jets);
    for (const ex  of this.explosions) ex.update(dt);

    /* ── Respawns ── */
    for (const jet of this.jets) {
      if (!jet.alive && jet.respawnTimer <= 0) {
        jet.respawn();
        if (jet.isLocal && this.onLocalRespawn) this.onLocalRespawn();
      }
    }

    /* ── Collision detection (authoritative only) ── */
    if (isAuthoritative) {
      this._checkCollisions();
    }

    /* ── Clean up dead entities ── */
    this.bullets    = this.bullets.filter(b => b.active);
    this.missiles   = this.missiles.filter(m => m.active);

    this.explosions = this.explosions.filter(e => !e.done);

    /* ── UI callbacks ── */
    if (this.localJet && this.onScoreUpdate) this.onScoreUpdate(this.localJet.score);
    const alive = this.jets.filter(j => j.alive).length;
    if (this.onPlayerCountUpdate) this.onPlayerCountUpdate(alive);

    /* ── Multiplayer host: broadcast state ── */
    if (this.net && this.opts.isHost) {
      this._syncTimer -= dt;
      if (this._syncTimer <= 0) {
        this._syncTimer = this._syncPeriod;
        this.net.broadcastState(this._buildNetState());
      }
    }
  }

  /* ──────────────────────────────────────────────
     WEAPONS
  ────────────────────────────────────────────── */

  _tryFireBullet(jet) {
    const now = performance.now();
    if (now - jet.lastBulletTime < jet.fireRateMs) return;
    jet.lastBulletTime = now;

    /* Spawn at nose of jet */
    const nx = jet.x + Math.sin(jet.angle) * 26;
    const ny = jet.y - Math.cos(jet.angle) * 26;
    this.bullets.push(new Bullet(nx, ny, jet.angle, jet.id, jet.team));
  }

  tryFireMissile(jet) {
    if (!jet || !jet.alive || !jet.missileReady) return;
    jet.missileCooldown = Config.MISSILE_COOLDOWN;

    const nx = jet.x + Math.sin(jet.angle) * 28;
    const ny = jet.y - Math.cos(jet.angle) * 28;
    const m  = new Missile(nx, ny, jet.angle, jet.id, jet.team);
    m.acquireTarget(this.jets, jet.team);
    this.missiles.push(m);
  }

  /* ──────────────────────────────────────────────
     COLLISION (authoritative)
  ────────────────────────────────────────────── */

  _checkCollisions() {
    const livingJets = this.jets.filter(j => j.alive);

    /* Bullets vs jets */
    for (const bullet of this.bullets) {
      if (!bullet.active) continue;
      for (const jet of livingJets) {
        if (jet.id === bullet.ownerId) continue;
        if (jet.team !== 'none' && jet.team === bullet.ownerTeam) continue; // no team-kill
        if (!bullet.collidesWith(jet)) continue;
        if (jet.hasShield) { bullet.active = false; continue; }
        bullet.active = false;
        this._killJet(jet, this.jets.find(j => j.id === bullet.ownerId));
        break;
      }
    }

    /* Missiles vs jets */
    for (const missile of this.missiles) {
      if (!missile.active) continue;
      for (const jet of livingJets) {
        if (jet.id === missile.ownerId) continue;
        if (jet.team !== 'none' && jet.team === missile.ownerTeam) continue;
        if (!missile.collidesWith(jet)) continue;
        if (jet.hasShield) { missile.active = false; continue; }
        missile.active = false;
        this._killJet(jet, this.jets.find(j => j.id === missile.ownerId));
        break;
      }
    }

    /* Power-ups are awarded directly on kill — no world pickup needed */
  }

  _killJet(jet, killer) {
    const killerName = killer ? killer.name : 'Unknown';
    jet.kill(killer);
    this.explosions.push(new Explosion(jet.x, jet.y, jet.color));

    /* Award power-up directly to killer (50% chance) */
    if (killer && Math.random() < Config.POWERUP_DROP_CHANCE) {
      const types = ['shield', 'rapidfire', 'speed'];
      const type  = types[Math.floor(Math.random() * types.length)];
      killer.pendingPowerUp = type; // stored, not yet active
      if (killer.isLocal && this.onPowerUpEarned) this.onPowerUpEarned(type);
    }

    /* Kill feed */
    if (this.onKillFeed) this.onKillFeed(killerName, jet.name);
    if (this.net && this.opts.isHost) this.net.broadcastKill(killerName, jet.name);

    /* Local player death */
    if (jet.isLocal && this.onLocalDeath) this.onLocalDeath(jet.respawnTimer);
  }

  /* Called when local player taps the power-up button */
  activatePowerUp() {
    const jet = this.localJet;
    if (!jet || !jet.pendingPowerUp) return;
    jet.applyPowerUp(jet.pendingPowerUp);
    jet.pendingPowerUp = null;
    if (this.onPowerUpActivated) this.onPowerUpActivated();
  }

  /* ──────────────────────────────────────────────
     AI BEHAVIOUR
  ────────────────────────────────────────────── */

  _updateAI(jet, dt) {
    if (!jet.alive) return;
    const ai = jet.ai;

    /* Find nearest non-AI player as target */
    let target = null, bestDist = Infinity;
    for (const j of this.jets) {
      if (j.id === jet.id || !j.alive || j.isAI) continue;
      const dx = j.x - jet.x, dy = j.y - jet.y;
      const d  = Math.sqrt(dx*dx + dy*dy);
      if (d < bestDist) { bestDist = d; target = j; }
    }
    ai.target = target;

    /* State transitions */
    if (!target) { ai.state = 'wander'; }
    else if (bestDist < Config.AI_EVADE_RANGE)  { ai.state = 'evade'; }
    else if (bestDist < Config.AI_PURSUE_RANGE) { ai.state = 'pursue'; }
    else { ai.state = 'wander'; }

    /* State actions */
    if (ai.state === 'wander') {
      ai.wanderTimer -= dt;
      if (ai.wanderTimer <= 0) {
        ai.wanderAngle = Math.random() * Math.PI * 2;
        ai.wanderTimer = 2 + Math.random() * 3;
      }
      const diff = angleDiff(ai.wanderAngle, jet.angle);
      jet.angle += Math.sign(diff) * Math.min(Math.abs(diff), Config.JET_TURN_SPEED * dt * 0.6);
    }
    else if (ai.state === 'pursue' || ai.state === 'evade') {
      const dx = target.x - jet.x, dy = target.y - jet.y;
      let desired = Math.atan2(dx, -dy);
      if (ai.state === 'evade') desired += Math.PI; // flee
      const diff = angleDiff(desired, jet.angle);
      jet.angle += Math.sign(diff) * Math.min(Math.abs(diff), Config.JET_TURN_SPEED * dt * 0.8);
    }

    /* Shooting */
    if (target && bestDist < Config.AI_SHOOT_RANGE && ai.state === 'pursue') {
      /* Check if player is roughly in front */
      const dx = target.x - jet.x, dy = target.y - jet.y;
      const toTarget = Math.atan2(dx, -dy);
      if (Math.abs(angleDiff(toTarget, jet.angle)) < 0.4) {
        if (Math.random() < Config.AI_SHOOT_CHANCE) this._tryFireBullet(jet);
        if (Math.random() < Config.AI_MISSILE_CHANCE) this.tryFireMissile(jet);
      }
    }
  }

  /* ──────────────────────────────────────────────
     NET STATE (multiplayer)
  ────────────────────────────────────────────── */

  _buildNetState() {
    return {
      jets:     this.jets.map(j => j.toNetState()),
      bullets:  this.bullets.map(b => b.toNetState()),
      missiles: this.missiles.map(m => m.toNetState()),
      powerups: this.powerups.map(p => p.toNetState()),
    };
  }

  _applyNetState(state) {
    /* ── Jets ── */
    for (const ns of state.jets) {
      let jet = this.jets.find(j => j.id === ns.id);
      if (!jet) {
        jet = new Jet({ id: ns.id, name: ns.name, color: ns.color, team: ns.team });
        this.jets.push(jet);
      }
      if (ns.id !== this.net.localId) jet.fromNetState(ns); // don't overwrite local
    }
    /* Remove departed jets */
    const ids = new Set(state.jets.map(j => j.id));
    this.jets = this.jets.filter(j => j.isLocal || ids.has(j.id));

    /* ── Bullets (just positions) ── */
    this.bullets = state.bullets.map(b => {
      const blt = new Bullet(b.x, b.y, b.angle, b.ownerId, b.ownerTeam);
      blt.id = b.id;
      return blt;
    });

    /* ── Missiles ── */
    this.missiles = state.missiles.map(m => {
      const mis = new Missile(m.x, m.y, m.angle, m.ownerId, '');
      mis.id = m.id;
      mis.trackTime = m.trackTime;
      return mis;
    });

    /* ── Power-ups ── */
    this.powerups = state.powerups.map(p => {
      const pu = new PowerUp(p.x, p.y, p.type);
      pu.id = p.id;
      pu.lifetime = p.lifetime;
      return pu;
    });
  }

  /* ──────────────────────────────────────────────
     RENDER
  ────────────────────────────────────────────── */

  _resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _render() {
    const ctx    = this.ctx;
    const W      = this.canvas.width;
    const H      = this.canvas.height;

    /* Camera: centre on local jet (or last known position) */
    if (this.localJet) {
      this.camX = this.localJet.x - W / 2;
      this.camY = this.localJet.y - H / 2;
    }
    const cx = this.camX, cy = this.camY;

    /* === Background === */
    ctx.fillStyle = Config.BG_COLOR;
    ctx.fillRect(0, 0, W, H);

    /* Grid */
    ctx.strokeStyle = Config.GRID_COLOR;
    ctx.lineWidth   = 1;
    const gs   = Config.BG_GRID_SIZE;
    const startX = -((cx % gs + gs) % gs);
    const startY = -((cy % gs + gs) % gs);
    ctx.beginPath();
    for (let x = startX; x < W; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = startY; y < H; y += gs) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    /* Clouds */
    for (const cloud of this._clouds) {
      const sx = cloud.x - cx, sy = cloud.y - cy;
      if (sx < -cloud.r || sx > W + cloud.r || sy < -cloud.r || sy > H + cloud.r) continue;
      const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, cloud.r);
      grd.addColorStop(0, `rgba(160,180,220,${cloud.alpha})`);
      grd.addColorStop(1, 'rgba(160,180,220,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(sx, sy, cloud.r, 0, Math.PI * 2);
      ctx.fill();
    }

    /* World boundary indicator */
    ctx.strokeStyle = 'rgba(255,80,80,0.25)';
    ctx.lineWidth = 3;
    ctx.setLineDash([20, 10]);
    ctx.strokeRect(-cx, -cy, Config.WORLD_W, Config.WORLD_H);
    ctx.setLineDash([]);

    /* === Entities === */
    for (const b   of this.bullets)    b.draw(ctx, cx, cy);
    for (const m   of this.missiles)   m.draw(ctx, cx, cy);
    for (const ex  of this.explosions) ex.draw(ctx, cx, cy);
    /* Draw jets — local player last (on top) */
    const others = this.jets.filter(j => !j.isLocal);
    const local  = this.jets.filter(j =>  j.isLocal);
    for (const jet of [...others, ...local]) jet.draw(ctx, cx, cy);

    /* === Minimap === */
    this._drawMinimap();
  }

  _drawMinimap() {
    const mm = document.getElementById('minimap-canvas');
    if (!mm) return;
    const mc = mm.getContext('2d');
    const S  = Config.MINIMAP_SIZE;
    const sc = Config.MINIMAP_SCALE;

    mc.clearRect(0, 0, S, S);
    mc.fillStyle = 'rgba(6,13,26,0.85)';
    mc.fillRect(0, 0, S, S);

    /* Viewport rect */
    const vx = this.camX * sc, vy = this.camY * sc;
    const vw = this.canvas.width * sc, vh = this.canvas.height * sc;
    mc.strokeStyle = 'rgba(79,195,247,0.3)';
    mc.lineWidth   = 1;
    mc.strokeRect(vx, vy, vw, vh);

    /* Blips */
    for (const jet of this.jets) {
      if (!jet.alive) continue;
      const mx = jet.x * sc, my = jet.y * sc;
      mc.fillStyle = jet.isLocal ? '#ffffff' : jet.color;
      mc.beginPath();
      mc.arc(mx, my, jet.isLocal ? 3 : 2, 0, Math.PI * 2);
      mc.fill();
    }

  }

  /* ──────────────────────────────────────────────
     PUBLIC HELPERS
  ────────────────────────────────────────────── */

  getStats() {
    if (!this.localJet) return {};
    return {
      score:  this.localJet.score,
      kills:  this.localJet.kills,
      deaths: this.localJet.deaths,
    };
  }
}
