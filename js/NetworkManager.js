/**
 * NetworkManager.js
 * Wraps PeerJS for P2P multiplayer.
 *
 * HOST:  Creates peer with room code as ID. Accepts connections.
 *        Receives input packets from clients. Sends full state at HOST_SYNC_HZ.
 *        Acts as authoritative game authority (collision, scoring, power-ups).
 *
 * CLIENT: Creates anonymous peer. Connects to host peer ID (=room code).
 *         Sends local input each tick. Receives & renders host state.
 *
 * PROTOCOL (JSON over PeerJS DataChannel):
 *   client → host:  { type:'input', angle, firing, missileFired, id }
 *   host → all:     { type:'state', jets, bullets, missiles, powerups, scores }
 *   host → all:     { type:'kill',  killerName, victimName }
 *   host → client:  { type:'assign', id, gameMode, teamMode }
 *   client → host:  { type:'join', name, color, team }
 */
class NetworkManager {
  constructor() {
    this.peer       = null;   // PeerJS Peer instance
    this.isHost     = false;
    this.roomCode   = null;
    this.localId    = null;   // this player's assigned network ID
    this.conns      = {};     // peerId → DataConnection (host only)
    this.hostConn   = null;   // client's connection to host

    /* Callbacks — set by GameEngine */
    this.onStateReceived   = null; // (state) client got full game state
    this.onPlayerJoined    = null; // (joinData) host got new player
    this.onPlayerLeft      = null; // (peerId)
    this.onKillFeed        = null; // ({killerName, victimName})
    this.onConnected       = null; // () successfully connected to host
    this.onError           = null; // (msg)

    /* Host: accumulate client input per tick */
    this.clientInputs = {}; // id → {angle, firing, missileFired}

    this._syncInterval = null;
  }

  /* ──────────────────────────────────────────────
     COMMON
  ────────────────────────────────────────────── */

  /** Generate a 5-char alphanumeric room code */
  static generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  /** Send JSON over a DataConnection (with error guard) */
  _send(conn, data) {
    try {
      if (conn && conn.open) conn.send(JSON.stringify(data));
    } catch(e) { console.warn('send error', e); }
  }

  disconnect() {
    if (this._syncInterval) { clearInterval(this._syncInterval); this._syncInterval = null; }
    if (this.peer) { this.peer.destroy(); this.peer = null; }
    this.conns = {};
    this.hostConn = null;
    this.isHost = false;
  }

  /* ──────────────────────────────────────────────
     HOST
  ────────────────────────────────────────────── */

  /**
   * Create a room.
   * @param {string} code - the room code / PeerJS peer ID
   * @param {object} playerInfo - {name, color, team}
   * @returns {Promise<string>} resolves to code when peer is open
   */
  createRoom(code, playerInfo) {
    return new Promise((resolve, reject) => {
      this.isHost   = true;
      this.roomCode = code;
      this.localId  = 'host';

      this.peer = new Peer(code, {
        host: '0.peerjs.com', port: 443, secure: true,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
      });

      this.peer.on('open', (id) => {
        console.log('[Host] Peer open, id=', id);
        resolve(id);
      });

      this.peer.on('connection', (conn) => {
        console.log('[Host] Incoming connection from', conn.peer);
        this.conns[conn.peer] = conn;

        conn.on('open', () => {
          // Send them their assigned ID
          this._send(conn, { type: 'assign', peerId: conn.peer });
        });

        conn.on('data', (raw) => {
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'input') {
              this.clientInputs[msg.id] = msg;
            } else if (msg.type === 'join') {
              msg.peerId = conn.peer;
              if (this.onPlayerJoined) this.onPlayerJoined(msg);
            }
          } catch(e) { console.warn('host data parse error', e); }
        });

        conn.on('close', () => {
          delete this.conns[conn.peer];
          if (this.onPlayerLeft) this.onPlayerLeft(conn.peer);
        });

        conn.on('error', (e) => console.warn('[Host] conn error', e));
      });

      this.peer.on('error', (e) => {
        console.error('[Host] peer error', e);
        const msg = e.type === 'unavailable-id'
          ? 'Room code already in use. Try a different code.'
          : `Connection error: ${e.type}`;
        if (this.onError) this.onError(msg);
        reject(e);
      });
    });
  }

  /** Host: broadcast full game state to all clients */
  broadcastState(state) {
    const payload = JSON.stringify({ type: 'state', ...state });
    for (const conn of Object.values(this.conns)) {
      try { if (conn.open) conn.send(payload); } catch(_) {}
    }
  }

  /** Host: broadcast a kill-feed event */
  broadcastKill(killerName, victimName) {
    const payload = { type: 'kill', killerName, victimName };
    this._broadcastAll(payload);
    if (this.onKillFeed) this.onKillFeed(payload);
  }

  _broadcastAll(data) {
    const s = JSON.stringify(data);
    for (const conn of Object.values(this.conns)) {
      try { if (conn.open) conn.send(s); } catch(_) {}
    }
  }

  /** Host: pop all accumulated client inputs and clear the buffer */
  flushClientInputs() {
    const inputs = { ...this.clientInputs };
    this.clientInputs = {};
    return inputs;
  }

  get connectedCount() { return Object.keys(this.conns).length; }

  /* ──────────────────────────────────────────────
     CLIENT
  ────────────────────────────────────────────── */

  /**
   * Join a room.
   * @param {string} code - host's room code
   * @param {object} playerInfo - {name, color, team}
   * @returns {Promise<void>}
   */
  joinRoom(code, playerInfo) {
    return new Promise((resolve, reject) => {
      this.isHost   = false;
      this.roomCode = code;

      // Client gets an auto-generated peer ID
      this.peer = new Peer({
        host: '0.peerjs.com', port: 443, secure: true,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
      });

      this.peer.on('open', () => {
        const conn = this.peer.connect(code, { reliable: true });
        this.hostConn = conn;

        conn.on('open', () => {
          console.log('[Client] Connected to host');
          // Send our player info
          this._send(conn, { type: 'join', ...playerInfo });
        });

        conn.on('data', (raw) => {
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'assign') {
              this.localId = msg.peerId;
              if (this.onConnected) this.onConnected();
              resolve();
            } else if (msg.type === 'state') {
              if (this.onStateReceived) this.onStateReceived(msg);
            } else if (msg.type === 'kill') {
              if (this.onKillFeed) this.onKillFeed(msg);
            }
          } catch(e) { console.warn('client data parse error', e); }
        });

        conn.on('close', () => {
          if (this.onPlayerLeft) this.onPlayerLeft('host');
        });

        conn.on('error', (e) => {
          if (this.onError) this.onError(`Lost connection to host: ${e.type}`);
        });

        // Timeout if host not found
        const timeout = setTimeout(() => {
          if (!this.localId) {
            reject(new Error('Room not found or timed out. Check the room code.'));
          }
        }, 8000);
        // Clear timeout once resolved
        const origResolve = resolve;
        resolve = (...args) => { clearTimeout(timeout); origResolve(...args); };
      });

      this.peer.on('error', (e) => {
        const msg = e.type === 'peer-unavailable'
          ? 'Room not found. Check the code and try again.'
          : `Network error: ${e.type}`;
        if (this.onError) this.onError(msg);
        reject(new Error(msg));
      });
    });
  }

  /** Client: send local input to host */
  sendInput(data) {
    this._send(this.hostConn, { type: 'input', id: this.localId, ...data });
  }
}
