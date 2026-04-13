/**
 * main.js — Application bootstrap.
 * Wires together UI, InputHandler, NetworkManager, and GameEngine.
 * Handles all button events across all screens.
 */

/* ═══════════════════════════════════════════════
   GLOBALS
═══════════════════════════════════════════════ */
let ui      = null;  // UIManager
let input   = null;  // InputHandler
let net     = null;  // NetworkManager (null in singleplayer)
let engine  = null;  // GameEngine

/* Lobby state */
let lobbyPlayers   = [];
let selectedColor  = '#ffffff';
let selectedTeam   = 'none';
let selectedMode   = 'solo'; // 'solo' | 'team'
let isHost         = false;

/* ═══════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  input = new InputHandler();
  ui    = new UIManager(input);
  ui.showScreen('menu');

  _bindMenuButtons();
  _bindLobbyButtons();
  _bindSettingsButtons();
  _bindGameButtons();
  _runMenuAnimation();
  _enforceOrientation();
});

/* ═══════════════════════════════════════════════
   ORIENTATION
═══════════════════════════════════════════════ */
function _enforceOrientation() {
  /* The CSS @media (orientation: portrait) handles the overlay.
     This JS version is a fallback / runtime check. */
  const check = () => {
    const portrait = window.innerHeight > window.innerWidth;
    document.getElementById('portrait-overlay').style.display =
      portrait ? 'flex' : 'none';
  };
  window.addEventListener('resize',            check);
  window.addEventListener('orientationchange', () => setTimeout(check, 150));
  check();
}

/* ═══════════════════════════════════════════════
   ANIMATED MENU BACKGROUND
═══════════════════════════════════════════════ */
function _runMenuAnimation() {
  const canvas = document.getElementById('menu-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const jets = [];

  for (let i = 0; i < 12; i++) {
    jets.push({
      x: Math.random() * 1200, y: Math.random() * 800,
      angle: Math.random() * Math.PI * 2,
      speed: 40 + Math.random() * 60,
      color: ['#4fc3f7','#e74c3c','#2ecc71','#f39c12','#9b59b6'][i % 5],
    });
  }

  let last = performance.now();
  const loop = (now) => {
    if (document.getElementById('screen-menu').classList.contains('active')) {
      const dt = (now - last) / 1000; last = now;
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      ctx.fillStyle = 'rgba(6,13,26,0.25)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (const j of jets) {
        j.x += Math.sin(j.angle) * j.speed * dt;
        j.y -= Math.cos(j.angle) * j.speed * dt;
        if (j.x < -30) j.x = canvas.width + 30;
        if (j.x > canvas.width + 30)  j.x = -30;
        if (j.y < -30) j.y = canvas.height + 30;
        if (j.y > canvas.height + 30) j.y = -30;

        ctx.save();
        ctx.translate(j.x, j.y);
        ctx.rotate(j.angle);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = j.color;
        ctx.beginPath();
        ctx.moveTo(0,-14); ctx.lineTo(-8,10); ctx.lineTo(0,5); ctx.lineTo(8,10);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/* ═══════════════════════════════════════════════
   MENU BUTTONS
═══════════════════════════════════════════════ */
function _bindMenuButtons() {
  /* Create Room */
  _on('btn-create', async () => {
    const granted = await _requestGyro();
    if (!granted) return;
    isHost = true;
    net = new NetworkManager();
    const code = NetworkManager.generateCode();

    ui.showScreen('lobby');
    ui.showRoomCode(code);
    ui.setLobbyMode(true);
    _addSelfToLobby();

    try {
      await net.createRoom(code, _getPlayerInfo());
      _setupHostLobbyEvents();
    } catch(e) {
      alert('Could not create room: ' + e.message);
      ui.showScreen('menu');
    }
  });

  /* Join Room */
  _on('btn-join', async () => {
    const granted = await _requestGyro();
    if (!granted) return;
    isHost = false;
    ui.showScreen('join');
    document.getElementById('join-error').textContent = '';
    document.getElementById('join-code-input').value  = '';
    setTimeout(() => document.getElementById('join-code-input').focus(), 50);
  });

  /* Solo vs AI */
  _on('btn-singleplayer', async () => {
    const granted = await _requestGyro();
    if (!granted) return;
    _startSinglePlayer();
  });

  /* Settings (from menu) */
  _on('btn-settings-menu', () => ui.showScreen('settings'));
}

/* ═══════════════════════════════════════════════
   JOIN SCREEN
═══════════════════════════════════════════════ */
function _bindLobbyButtons() {
  /* Confirm join */
  _on('btn-join-confirm', async () => {
    const code = document.getElementById('join-code-input').value.trim().toUpperCase();
    if (code.length < 4) { ui.setJoinError('Enter a valid room code.'); return; }

    ui.setJoinError('Connecting…');
    net = new NetworkManager();
    net.onError = (msg) => { ui.setJoinError(msg); };

    try {
      await net.joinRoom(code, _getPlayerInfo());
      ui.showScreen('lobby');
      ui.setLobbyMode(false);
      _addSelfToLobby();
      _setupClientLobbyEvents();
    } catch(e) {
      ui.setJoinError(e.message);
    }
  });

  _on('btn-join-back', () => ui.showScreen('menu'));

  /* Color swatches */
  document.querySelectorAll('.swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedColor = sw.dataset.color;
    });
  });

  /* Mode buttons (host only) */
  _on('btn-mode-solo', () => {
    selectedMode = 'solo';
    document.getElementById('btn-mode-solo').classList.add('active-mode');
    document.getElementById('btn-mode-team').classList.remove('active-mode');
    document.getElementById('mode-desc').textContent = 'Free-for-all — max 20 players';
    document.getElementById('player-max').textContent = '20';
    document.getElementById('team-section').classList.add('hidden');
  });
  _on('btn-mode-team', () => {
    selectedMode = 'team';
    document.getElementById('btn-mode-team').classList.add('active-mode');
    document.getElementById('btn-mode-solo').classList.remove('active-mode');
    document.getElementById('mode-desc').textContent = 'Team 5v5 — max 10 players';
    document.getElementById('player-max').textContent = '10';
    document.getElementById('team-section').classList.remove('hidden');
  });

  /* Team buttons */
  document.querySelectorAll('.team-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.team-btn').forEach(b => b.style.outline = 'none');
      btn.style.outline = '3px solid white';
      selectedTeam = btn.dataset.team;
    });
  });

  /* Copy room code */
  _on('btn-copy-code', () => {
    const code = document.getElementById('room-code-text').textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(code).catch(() => {});
    document.getElementById('btn-copy-code').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('btn-copy-code').textContent = 'Copy'; }, 1500);
  });

  /* Start game (host) */
  _on('btn-start-game', () => _startMultiplayerGame());

  /* Ready (client) */
  _on('btn-lobby-ready', () => {
    if (net) net.sendInput ? null : null; // ready signal — simple pulse
    document.getElementById('btn-lobby-ready').textContent = '✓ Ready!';
    document.getElementById('btn-lobby-ready').style.background = '#2ecc71';
  });

  /* Leave lobby */
  _on('btn-lobby-back', () => {
    if (net) { net.disconnect(); net = null; }
    ui.showScreen('menu');
  });
}

function _setupHostLobbyEvents() {
  if (!net) return;
  net.onPlayerJoined = (info) => {
    if (!lobbyPlayers.find(p => p.id === info.peerId)) {
      lobbyPlayers.push({ id: info.peerId, name: info.name, color: info.color, team: info.team, ready: false });
      ui.updatePlayerList(lobbyPlayers);
    }
  };
  net.onPlayerLeft = (pid) => {
    lobbyPlayers = lobbyPlayers.filter(p => p.id !== pid);
    ui.updatePlayerList(lobbyPlayers);
  };
}

function _setupClientLobbyEvents() {
  if (!net) return;
  net.onStateReceived = (state) => {
    /* If host sent a 'start' signal embedded in state */
    if (state.gameStarted) _startMultiplayerGame(false);
  };
}

/* ═══════════════════════════════════════════════
   SETTINGS BUTTONS
═══════════════════════════════════════════════ */
function _bindSettingsButtons() {
  _on('btn-settings-back', () => ui.showScreen('menu'));
  _on('btn-layout-mode', () => {
    const on = input.toggleLayoutMode();
    document.getElementById('btn-layout-mode').textContent = on ? 'Disable Drag Mode' : 'Enable Drag Mode';
  });
  _on('btn-reset-hud', () => input.resetPositions());
  _on('btn-layout-mode-hud', () => {
    const on = input.toggleLayoutMode();
    document.getElementById('btn-layout-mode-hud').textContent = on ? 'Disable Drag' : 'Toggle Drag';
  });
}

/* ═══════════════════════════════════════════════
   IN-GAME BUTTONS
═══════════════════════════════════════════════ */
function _bindGameButtons() {
  /* Pause gear */
  _on('btn-pause-settings', () => {
    if (engine) engine.stop();
    ui.showPause();
  });
  _on('btn-resume', () => {
    ui.hidePause();
    if (engine) engine.start();
  });
  _on('btn-quit', () => {
    _stopGame();
    ui.hidePause();
    ui.showScreen('menu');
  });

  /* Game over */
  _on('btn-gameover-menu',  () => { _stopGame(); ui.showScreen('menu'); });
  _on('btn-gameover-retry', () => { _stopGame(); _startSinglePlayer(); });

  /* Missile button callback */
  // Bound after engine created — see _startGame
}

/* ═══════════════════════════════════════════════
   GAME START
═══════════════════════════════════════════════ */
function _startSinglePlayer() {
  const playerInfo = { id: 'local', name: 'You', color: selectedColor, team: 'none' };
  _startGame(playerInfo, null, { isSinglePlayer: true, isHost: false, mode: 'solo' });
}

function _startMultiplayerGame(asHost = true) {
  if (!net) return;
  const playerInfo = _getPlayerInfo();
  playerInfo.id = net.localId;
  _startGame(playerInfo, net, {
    isSinglePlayer: false,
    isHost: asHost,
    mode: selectedMode,
  });
}

function _startGame(playerInfo, netManager, opts) {
  ui.showScreen('game');
  const canvas = document.getElementById('game-canvas');

  engine = new GameEngine(canvas, input, netManager, playerInfo, opts);

  /* Wire UI callbacks */
  engine.onScoreUpdate       = (s)       => ui.updateScore(s);
  engine.onPlayerCountUpdate = (n)       => ui.updateAliveCount(n);
  engine.onKillFeed          = (kn, vn)  => ui.addKillFeed(kn, vn);
  engine.onLocalDeath        = (timer)   => {
    ui.showRespawn(timer);
    // Feed the timer to the respawn overlay
    const tick = setInterval(() => {
      if (!engine || !engine.localJet) { clearInterval(tick); return; }
      ui._respawnRemaining = engine.localJet.respawnTimer;
      if (!engine.localJet.alive && engine.localJet.respawnTimer <= 0) {
        clearInterval(tick);
      }
    }, 100);
  };
  engine.onLocalRespawn = () => ui.hideRespawn();

  /* Missile button */
  input.onMissile = () => {
    if (engine && engine.localJet) engine.tryFireMissile(engine.localJet);
  };

  /* Bind draggable fire/missile buttons */
  input.bindButtons();

  /* HUD tick (separate from game loop — for power-up display) */
  const hudInterval = setInterval(() => {
    if (!engine) { clearInterval(hudInterval); return; }
    const jet = engine.localJet;
    if (jet) {
      ui.updatePowerUps(jet);
      ui.updateMissileCooldown(jet.missileCooldown);
    }
  }, 100);

  engine.start();
}

function _stopGame() {
  if (engine) { engine.stop(); engine = null; }
  if (net)    { net.disconnect(); net = null; }
  input.stop();
  input.firing = false;
}

/* ═══════════════════════════════════════════════
   GYROSCOPE PERMISSION (iOS 13+)
═══════════════════════════════════════════════ */
async function _requestGyro() {
  try {
    const result = await input.requestGyroPermission();
    if (result === 'denied') {
      alert('Gyroscope access denied.\nPlease enable motion sensors in your browser/device settings.');
      return false;
    }
    return true;
  } catch(e) {
    console.warn('Gyro request failed:', e);
    return true; // allow play without gyro (desktop fallback)
  }
}

/* ═══════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════ */
function _getPlayerInfo() {
  return {
    name:  'Pilot' + Math.floor(Math.random() * 999),
    color: selectedColor,
    team:  selectedTeam,
  };
}

function _addSelfToLobby() {
  lobbyPlayers = [{ id: 'local', name: 'You', color: selectedColor, team: selectedTeam, ready: true }];
  ui.updatePlayerList(lobbyPlayers);
}

/** Attach touchstart (+ click fallback) to a button by id */
function _on(id, handler) {
  const el = document.getElementById(id);
  if (!el) return;
  /* Use touchstart for zero-latency on mobile */
  let touched = false;
  el.addEventListener('touchstart', (e) => {
    e.preventDefault();
    touched = true;
    handler(e);
  }, { passive: false });
  el.addEventListener('click', (e) => {
    if (touched) { touched = false; return; } // prevent double-fire
    handler(e);
  });
}
