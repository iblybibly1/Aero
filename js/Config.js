/**
 * Config.js — Centralized game constants.
 * Tweak these values to change gameplay feel without touching logic.
 */
const Config = {
  /* World */
  WORLD_W: 4000,
  WORLD_H: 4000,

  /* Jets */
  JET_RADIUS:      18,   // px — collision radius (same for all jets, fairness!)
  JET_SPEED:      180,   // px/s — base movement speed
  JET_TURN_SPEED:  3.5,  // rad/s — gyroscope angular responsiveness

  /* Machine gun */
  BULLET_SPEED:   520,   // px/s
  BULLET_RADIUS:    4,
  BULLET_LIFETIME:  2.2, // seconds before auto-destroy
  FIRE_RATE_MS:   140,   // ms between shots (≈7 rps)
  RAPID_FIRE_MS:   70,   // ms when Rapid Fire active (doubles rate)

  /* Missiles */
  MISSILE_SPEED:   340,  // px/s
  MISSILE_RADIUS:    6,
  MISSILE_TRACK_SEC: 3,  // seconds of homing
  MISSILE_LIFETIME: 9,   // total seconds before destroy
  MISSILE_TURN:     2.8, // rad/s homing turn speed
  MISSILE_CONE:  Math.PI / 4, // 45° targeting cone (each side = 22.5°)
  MISSILE_COOLDOWN: 10,  // seconds

  /* Power-ups */
  POWERUP_RADIUS:     20,
  POWERUP_LIFETIME:   10, // seconds before expiry
  POWERUP_FLICKER_AT:  3, // seconds remaining when flicker starts
  POWERUP_DROP_CHANCE: 0.50, // 50% on enemy death
  SHIELD_DURATION:     5,
  RAPIDFIRE_DURATION:  5,
  SPEED_DURATION:      5,
  SPEED_BOOST:         1.50, // 50% faster

  /* Respawn */
  RESPAWN_TIME: 5, // seconds

  /* AI (single-player / bot behaviour) */
  AI_SHOOT_RANGE:    600,  // px
  AI_PURSUE_RANGE:   900,  // px — switch from wander to pursue
  AI_EVADE_RANGE:    200,  // px — too close, evade
  AI_SHOOT_CHANCE:   0.015, // per frame probability when in range
  AI_MISSILE_CHANCE: 0.003,

  /* Network sync */
  HOST_SYNC_HZ:   20, // state broadcasts per second from host
  NET_INTERP_MS:  60, // client-side interpolation window (ms)

  /* Minimap */
  MINIMAP_SIZE: 120,  // px canvas size (in HTML)
  MINIMAP_SCALE: 120 / 4000, // world → minimap px

  /* Visuals */
  BG_GRID_SIZE:    80, // px — grid cell size in world units
  BG_COLOR:    '#060d1a',
  GRID_COLOR:  'rgba(30, 60, 100, 0.25)',

  /* Gyroscope */
  DEFAULT_SENSITIVITY: 2.0,
};

/* Freeze so nobody accidentally mutates it */
Object.freeze(Config);
