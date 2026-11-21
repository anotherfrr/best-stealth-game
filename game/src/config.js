// Midnight Gallery — a top-down stealth game. Every tuning number and colour in one place.
// The playfield is a fixed 1280x720 logical area; the renderer scales it to the window, so no
// rule below depends on the screen size. The museum floor is a 40x22 grid of 32px tiles.

export const FIELD = { width: 1280, height: 720 };
export const TILE = 32;
export const COLS = 40;
export const ROWS = 22;

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

export const PLAYER = {
  radius: 13,
  walkSpeed: 178,
  sneakSpeed: 96,
  /** Detection rises this much slower while sneaking. */
  sneakFactor: 0.5,
  /** Detection rises this much faster while walking (not sneaking). */
  walkFactor: 1.35,
};

export const GUARD = {
  radius: 14,
  patrolSpeed: 78,
  chaseSpeed: 188,
  returnSpeed: 110,
  /** Vision cone: how far a guard can see, in pixels. */
  viewRange: 250,
  /** Half-angle of the vision cone, in radians. */
  viewHalfAngle: 0.58,
  /** Seconds a guard pauses at each patrol waypoint, scanning. */
  waypointPause: 1.1,
  /** Suspicion per second at point-blank range, before modifiers. */
  detectRate: 1.05,
  /** Suspicion lost per second while the player is unseen. */
  decayRate: 0.38,
  /** Suspicion at which a guard stops, turns and shows "?". */
  suspiciousAt: 0.35,
  /** Seconds of lost sight before a chasing guard gives up and searches. */
  loseSightTime: 2.4,
  /** Seconds a guard searches the last-seen spot before returning to patrol. */
  searchTime: 3.0,
  /** Touch distance that gets the player caught. */
  catchDistance: 26,
};

/** Cover multipliers on how fast suspicion rises. */
export const COVER = {
  bush: 0.18,
  shadow: 0.45,
};

export const LEVEL = { count: 3 };

export const PALETTE = {
  backdrop: '#070a12',
  floorA: '#23202a',
  floorB: '#201d27',
  floorLine: '#2e2a38',
  wall: '#4a4360',
  wallTop: '#6b6488',
  wallEdge: '#332e47',
  bush: '#1e4d2e',
  bushLeaf: '#2f7a44',
  bushLeaf2: '#3f9a58',
  shadowZone: '#0d1526',
  shadowEdge: '#24344f',
  artifact: '#f2c94c',
  artifactGlow: '#ffd94d',
  exit: '#35d07f',
  exitLocked: '#3a5a48',
  player: '#37e0c8',
  playerDark: '#1d8f80',
  guard: '#e5534b',
  guardDark: '#8f2f2a',
  cone: 'rgba(242, 201, 76, 0.30)',
  coneSuspicious: 'rgba(242, 140, 60, 0.38)',
  coneAlarm: 'rgba(229, 83, 75, 0.42)',
  panel: '#171a26',
  panelEdge: '#3a4054',
  text: '#eef1f5',
  muted: '#9aa1b5',
  gold: '#f2c94c',
  danger: '#ff5a4e',
  safe: '#35d07f',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best (fastest) clear time is kept between visits (this browser only). */
export const BEST_KEY = 'midnight-gallery.best-ms';
