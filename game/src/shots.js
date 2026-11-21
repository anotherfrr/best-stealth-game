// The screenshot scenes behind ?shot=cover|sneak|alarm|win. Each one plays the real rules
// forward from a fresh world, steered by an autopilot that pathfinds on the tile grid with
// danger-weighted costs (tiles inside a guard's cone cost far more than safe ones), sneaks when
// exposed, and heads for the nearest artifact, then the exit — so every frame is what a real
// game really looks like, and the same seed always gives the same frame. No scene teleports the
// player or fakes a state: the alarm scene walks straight into a guard's cone on purpose, the
// sneak scene walks into a bush and waits for the patrol to pass.

import { COLS, FIELD, ROWS, STEP, TILE } from './config.js';
import { isWall, tileAt, TILE_BUSH, TILE_SHADOW } from './levels.js';
import { EVENT_CAUGHT, EVENT_LEVEL, EVENT_WIN } from './world.js';
import { SCREEN_CAUGHT, SCREEN_LEVEL, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WIN } from './render.js';

const SAMPLE = 1 / 30;

/** BFS from the player's tile to `target` (tile coords), cost 1 + danger * 12 per tile. */
function findPath(world, tx, ty) {
  const state = world.state;
  const level = state.level;
  const sx = Math.floor(state.player.x / TILE);
  const sy = Math.floor(state.player.y / TILE);
  const key = (x, y) => y * COLS + x;
  const cost = new Map([[key(sx, sy), 0]]);
  const prev = new Map();
  const queue = [{ x: sx, y: sy, c: 0 }];
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
  while (queue.length > 0) {
    // Cheapest-first (small grid; a linear scan is fine).
    let bi = 0;
    for (let i = 1; i < queue.length; i += 1) if (queue[i].c < queue[bi].c) bi = i;
    const cur = queue.splice(bi, 1)[0];
    if (cur.x === tx && cur.y === ty) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!inBounds(nx, ny)) continue;
      if (isWall(level, nx * TILE + 16, ny * TILE + 16)) continue;
      const danger = world.dangerAt(nx * TILE + 16, ny * TILE + 16);
      const nc = cur.c + 1 + danger * 20;
      const k = key(nx, ny);
      if (cost.has(k) && cost.get(k) <= nc) continue;
      cost.set(k, nc);
      prev.set(k, key(cur.x, cur.y));
      queue.push({ x: nx, y: ny, c: nc });
    }
  }
  const targetKey = key(tx, ty);
  if (!cost.has(targetKey)) return null;
  const path = [];
  let k = targetKey;
  while (k !== key(sx, sy)) {
    path.unshift({ x: (k % COLS) * TILE + 16, y: Math.floor(k / COLS) * TILE + 16 });
    k = prev.get(k);
    if (k === undefined) break;
  }
  return path;
}

function nearestArtifact(state) {
  let best = null;
  let bestD = Infinity;
  for (const a of state.artifacts) {
    if (a.taken) continue;
    const d = Math.hypot(a.x - state.player.x, a.y - state.player.y);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

function nearestBush(state) {
  let best = null;
  let bestD = Infinity;
  for (let ty = 0; ty < ROWS; ty += 1) {
    for (let tx = 0; tx < COLS; tx += 1) {
      if (tileAt(state.level, tx * TILE + 16, ty * TILE + 16) !== TILE_BUSH) continue;
      const d = Math.hypot(tx * TILE + 16 - state.player.x, ty * TILE + 16 - state.player.y);
      if (d < bestD) { bestD = d; best = { x: tx * TILE + 16, y: ty * TILE + 16 }; }
    }
  }
  return best;
}

/** The autopilot: holds a path, replans when the target changes or every 0.5s. */
function createPilot(world) {
  let path = null;
  let targetKey = '';
  let replanIn = 0;
  return {
    steer(target, dt, sneakBias, fleeing) {
      const state = world.state;
      const k = `${Math.floor(target.x / TILE)},${Math.floor(target.y / TILE)}`;
      replanIn -= dt;
      if (!path || path.length === 0 || k !== targetKey || replanIn <= 0) {
        path = findPath(world, Math.floor(target.x / TILE), Math.floor(target.y / TILE)) || [];
        targetKey = k;
        replanIn = 0.5;
      }
      while (path.length > 0 && Math.hypot(path[0].x - state.player.x, path[0].y - state.player.y) < 12) {
        path.shift();
      }
      if (path.length === 0) return { x: 0, y: 0, sneak: true };
      const next = path[0];
      const dx = next.x - state.player.x;
      const dy = next.y - state.player.y;
      const len = Math.hypot(dx, dy) || 1;
      const danger = world.dangerAt(state.player.x, state.player.y);
      const exposed = state.guards.some((g) => g.suspicion > 0.15);
      // Patience: if the next step walks into a sweeping cone and we are safe where we
      // stand, wait for the patrol to pass instead of walking into the light.
      if (!fleeing && danger < 0.1 && world.dangerAt(next.x, next.y) > 0.3) {
        return { x: 0, y: 0, sneak: true };
      }
      // Fleeing a chase means running, not sneaking: speed beats quiet.
      return { x: dx / len, y: dy / len, sneak: fleeing ? false : (danger > 0.04 || exposed || sneakBias) };
    },
  };
}

function goalTarget(world) {
  const state = world.state;
  if (state.exitOpen) {
    const ex = state.level.exit;
    return { x: (ex.x + ex.w / 2) * TILE, y: (ex.y + ex.h / 2) * TILE };
  }
  const a = nearestArtifact(state);
  return a ? { x: a.x, y: a.y } : { x: FIELD.width / 2, y: FIELD.height / 2 };
}

/** The safest hiding spot right now: a bush or shadow tile no cone touches, nearest to the
 * player — and away from any guard already suspicious, which is staring at where it last
 * saw movement. */
function fleeTarget(world) {
  const state = world.state;
  let best = null;
  let bestScore = Infinity;
  for (let ty = 0; ty < ROWS; ty += 1) {
    for (let tx = 0; tx < COLS; tx += 1) {
      const t = tileAt(state.level, tx * TILE + 16, ty * TILE + 16);
      if (t !== TILE_BUSH && t !== TILE_SHADOW) continue;
      const x = tx * TILE + 16;
      const y = ty * TILE + 16;
      const danger = world.dangerAt(x, y);
      const d = Math.hypot(x - state.player.x, y - state.player.y);
      let nearSuspicious = Infinity;
      for (const g of state.guards) {
        if (g.suspicion > 0.3) nearSuspicious = Math.min(nearSuspicious, Math.hypot(x - g.x, y - g.y));
      }
      const starePenalty = nearSuspicious === Infinity ? 0 : Math.max(0, 420 - nearSuspicious) * 2;
      const score = danger * 1000 + d + starePenalty;
      if (score < bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  return best || { x: FIELD.width / 2, y: FIELD.height / 2 };
}

/** Step the world with the pilot heading for `getTarget()` until `done()` or the time limit.
 * With `brave`, the pilot keeps walking into a cone instead of breaking for cover — used by
 * the alarm scene, which walks into the light on purpose. */
function runFor(world, getTarget, done, limitSeconds, brave) {
  const pilot = createPilot(world);
  let steps = 0;
  const maxSteps = Math.floor(limitSeconds / STEP);
  while (steps < maxSteps) {
    const p = world.state.player;
    // Alarmed: forget the loot, run for cover and break line of sight. Merely exposed
    // (a guard's suspicion climbing, or standing in a cone): break for cover too, sneaking.
    const alarmed = world.state.alarm;
    const exposed = !brave && !alarmed && (world.state.guards.some((g) => g.suspicion > 0.2) || world.dangerAt(p.x, p.y) > 0.2);
    const target = alarmed || exposed ? fleeTarget(world) : getTarget();
    const move = pilot.steer(target, STEP, false, alarmed);
    const events = world.step(STEP, { x: move.x, y: move.y }, move.sneak, false);
    steps += 1;
    if (events & EVENT_CAUGHT) break;
    if (done(world, events)) break;
  }
  return steps;
}

function nearestGuard(state) {
  let best = null;
  let bestD = Infinity;
  for (const g of state.guards) {
    const d = Math.hypot(g.x - state.player.x, g.y - state.player.y);
    if (d < bestD) { bestD = d; best = g; }
  }
  return best;
}

/** Play the world's current level with the autopilot until it ends or the time limit. */
export function autoplayLevel(world, limitSeconds) {
  const steps = runFor(world, () => goalTarget(world), (w, e) => (e & (EVENT_CAUGHT | EVENT_LEVEL | EVENT_WIN)) !== 0, limitSeconds);
  return { steps, status: world.state.status, collected: world.state.collected };
}

/**
 * Set `world` to the named scene (cover, sneak, alarm, win; anything else is the title) and
 * return the screen to draw over it, the best time to show, and an optional toast banner.
 */
export function stageShot(name, world) {
  world.loadLevel(0);
  if (name === 'cover') {
    // Mid-play on level 1: lift two artifacts, then catch the thief crossing the open
    // hall toward the last one, cones sweeping around them.
    runFor(world, () => goalTarget(world), () => world.state.collected >= 2, 60);
    runFor(world, () => goalTarget(world), () => false, 2.5);
    return { screen: SCREEN_PLAY, best: 0, toast: 'LEVEL 1 · THE MARBLE HALL — steal 3 artifacts, reach the EXIT' };
  }
  if (name === 'sneak') {
    // Walk into the bush cluster by the south patrol, then sit tight while a guard passes.
    const bush = nearestBush(world.state);
    runFor(world, () => bush, () => Math.hypot(world.state.player.x - bush.x, world.state.player.y - bush.y) < 14, 60);
    for (let i = 0; i < 9 / STEP; i += 1) world.step(STEP, { x: 0, y: 0 }, true, false);
    return { screen: SCREEN_PLAY, best: 0, toast: 'HIDDEN IN THE BUSH — the patrol passes by...' };
  }
  if (name === 'alarm') {
    // Walk straight into the nearest guard's cone — a point in FRONT of the guard, where
    // they are looking — until the alarm trips, then run for it.
    runFor(world, () => {
      const g = nearestGuard(world.state);
      return { x: g.x + Math.cos(g.angle) * 145, y: g.y + Math.sin(g.angle) * 145 };
    }, () => world.state.alarm, 30, true);
    runFor(world, () => goalTarget(world), () => false, 0.7);
    return { screen: SCREEN_PLAY, best: 0, toast: 'SPOTTED! Break line of sight to cool the alarm down' };
  }
  if (name === 'win') {
    // Play level 1 properly: all three artifacts, then the exit.
    runFor(world, () => goalTarget(world), (w, e) => (e & (EVENT_LEVEL | EVENT_WIN)) !== 0, 300);
    if (world.state.status === 'caught') return { screen: SCREEN_CAUGHT, best: 0, toast: null };
    const won = world.state.status === 'won';
    return { screen: won ? SCREEN_WIN : SCREEN_LEVEL, best: 0, toast: null };
  }
  // Title scene: let the guards patrol behind the title panel.
  for (let i = 0; i < 5 / STEP; i += 1) world.step(STEP, { x: 0, y: 0 }, false, true);
  return { screen: SCREEN_TITLE, best: 0, toast: null };
}
