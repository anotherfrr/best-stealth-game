// The game's rules and state, with no drawing and no browser in it: the thief, the guards and
// their vision cones, line of sight, suspicion and alarms, cover, artifacts and the exit. step()
// advances one fixed step and returns what happened as bit flags, so the caller can react without
// the world knowing about screens or sound. The same world runs the game, the screenshot scenes
// and the node smoke test.

import { COVER, FIELD, GUARD, LEVEL, PLAYER, STEP, TILE } from './config.js';
import { buildLevel, isWall, tileAt, TILE_BUSH, TILE_SHADOW } from './levels.js';

export const EVENT_PICKUP = 1;
export const EVENT_CAUGHT = 2;
export const EVENT_LEVEL = 4;
export const EVENT_WIN = 8;
export const EVENT_ALARM = 16;
export const EVENT_SPOTTED = 32;
export const EVENT_STEP = 64;
export const EVENT_SNEAK_STEP = 128;

export const GUARD_PATROL = 0;
export const GUARD_SUSPICIOUS = 1;
export const GUARD_CHASE = 2;
export const GUARD_SEARCH = 3;
export const GUARD_RETURN = 4;

/** Smallest signed angle from `from` to `to`, in (-PI, PI]. */
export function angleDiff(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

function dist(x0, y0, x1, y1) {
  return Math.hypot(x1 - x0, y1 - y0);
}

/** True when no wall tile lies between two points (sampled every 8px). */
export function hasLineOfSight(level, x0, y0, x1, y1) {
  const d = dist(x0, y0, x1, y1);
  const steps = Math.max(1, Math.ceil(d / 8));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (isWall(level, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}

/** Move a circle against wall tiles, axis by axis so it slides along walls. */
function moveCircle(level, body, dx, dy) {
  const r = body.radius;
  const nx = body.x + dx;
  if (!isWall(level, nx + Math.sign(dx) * r, body.y - r * 0.7) &&
      !isWall(level, nx + Math.sign(dx) * r, body.y + r * 0.7) &&
      !isWall(level, nx + Math.sign(dx) * r, body.y)) {
    body.x = nx;
  }
  const ny = body.y + dy;
  if (!isWall(level, body.x - r * 0.7, ny + Math.sign(dy) * r) &&
      !isWall(level, body.x + r * 0.7, ny + Math.sign(dy) * r) &&
      !isWall(level, body.x, ny + Math.sign(dy) * r)) {
    body.y = ny;
  }
  body.x = Math.min(FIELD.width - r - 1, Math.max(r + 1, body.x));
  body.y = Math.min(FIELD.height - r - 1, Math.max(r + 1, body.y));
}

export function createWorld(random) {
  const state = {
    levelIndex: 0,
    level: null,
    player: { x: 0, y: 0, radius: PLAYER.radius, angle: 0, sneaking: false, moving: false, stepPhase: 0 },
    guards: [],
    artifacts: [],
    collected: 0,
    exitOpen: false,
    status: 'playing', // playing | caught | level-complete | won
    time: 0,
    totalTime: 0,
    alarm: false,
    maxSuspicion: 0,
    levelStartTime: 0,
  };

  function loadLevel(index) {
    const level = buildLevel(index);
    state.levelIndex = index;
    state.level = level;
    state.player.x = level.playerStart.x;
    state.player.y = level.playerStart.y;
    state.player.angle = -Math.PI / 2;
    state.player.sneaking = false;
    state.guards = level.guards.map((g, i) => {
      const start = g.waypoints[i % g.waypoints.length];
      return {
        x: start.x, y: start.y, radius: GUARD.radius,
        angle: 0, waypoints: g.waypoints, wp: (i + 1) % g.waypoints.length,
        pause: 0, scanDir: 1, state: GUARD_PATROL, suspicion: 0,
        lastSeenX: 0, lastSeenY: 0, loseTimer: 0, searchTimer: 0,
        speed: GUARD.patrolSpeed * level.guardSpeed,
        viewRange: level.viewRange, stuck: 0,
      };
    });
    state.artifacts = level.artifacts.map((a) => ({ x: a.x, y: a.y, taken: false, bob: random() * Math.PI * 2 }));
    state.collected = 0;
    state.exitOpen = false;
    state.status = 'playing';
    state.time = 0;
    state.alarm = false;
    state.maxSuspicion = 0;
  }

  function coverAt(x, y) {
    const t = tileAt(state.level, x, y);
    if (t === TILE_BUSH) return COVER.bush;
    if (t === TILE_SHADOW) return COVER.shadow;
    return 1;
  }

  /** How exposed a point is to this guard right now: 0 = unseen, 1 = dead centre of the cone. */
  function coneFactor(guard, x, y) {
    const d = dist(guard.x, guard.y, x, y);
    if (d > guard.viewRange) return 0;
    const ang = Math.atan2(y - guard.y, x - guard.x);
    const off = Math.abs(angleDiff(guard.angle, ang));
    if (off > 0.58) return 0;
    if (!hasLineOfSight(state.level, guard.x, guard.y, x, y)) return 0;
    return (1 - d / guard.viewRange) * (1 - off / 0.58);
  }

  /** Worst exposure of a point across all guards — the autopilot's danger map. */
  function dangerAt(x, y) {
    let worst = 0;
    for (const g of state.guards) worst = Math.max(worst, coneFactor(g, x, y));
    return worst;
  }

  function guardSees(guard, x, y) {
    return coneFactor(guard, x, y) > 0;
  }

  function updateGuard(guard, dt, events) {
    const p = state.player;
    const seen = guardSees(guard, p.x, p.y);
    const d = dist(guard.x, guard.y, p.x, p.y);

    if (seen) {
      guard.lastSeenX = p.x;
      guard.lastSeenY = p.y;
      guard.loseTimer = 0;
      // Closer and brighter is worse; sneaking, bushes and shadow slow the rise.
      const closeness = 1.25 - (d / guard.viewRange) * 0.75;
      const moveFactor = p.sneaking ? PLAYER.sneakFactor : PLAYER.walkFactor;
      const rate = GUARD.detectRate * closeness * moveFactor * coverAt(p.x, p.y);
      const before = guard.suspicion;
      guard.suspicion = Math.min(1, guard.suspicion + rate * dt);
      if (before < GUARD.suspiciousAt && guard.suspicion >= GUARD.suspiciousAt) events.value |= EVENT_SPOTTED;
      if (guard.suspicion >= 1 && guard.state !== GUARD_CHASE) {
        guard.state = GUARD_CHASE;
        events.value |= EVENT_ALARM;
      }
    } else {
      guard.suspicion = Math.max(0, guard.suspicion - GUARD.decayRate * dt);
      if (guard.state === GUARD_CHASE) {
        guard.loseTimer += dt;
        if (guard.loseTimer >= GUARD.loseSightTime) {
          guard.state = GUARD_SEARCH;
          guard.searchTimer = GUARD.searchTime;
        }
      }
    }
    if (guard.suspicion < GUARD.suspiciousAt && guard.state === GUARD_SUSPICIOUS) {
      guard.state = GUARD_PATROL;
    }
    state.maxSuspicion = Math.max(state.maxSuspicion, guard.suspicion);

    const faceToward = (tx, ty, turnRate) => {
      const want = Math.atan2(ty - guard.y, tx - guard.x);
      const diff = angleDiff(guard.angle, want);
      const step = Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
      guard.angle += step;
    };

    if (guard.state === GUARD_CHASE) {
      faceToward(p.x, p.y, 7);
      const dd = dist(guard.x, guard.y, p.x, p.y);
      if (dd > 4) {
        const sp = GUARD.chaseSpeed * state.level.guardSpeed;
        moveCircle(state.level, guard, ((p.x - guard.x) / dd) * sp * dt, ((p.y - guard.y) / dd) * sp * dt);
      }
      if (dd < GUARD.catchDistance) events.value |= EVENT_CAUGHT;
    } else if (guard.state === GUARD_SUSPICIOUS) {
      // Stop, stare at the thing that moved, and let suspicion decide.
      faceToward(p.x, p.y, 4);
    } else if (guard.state === GUARD_SEARCH) {
      const dd = dist(guard.x, guard.y, guard.lastSeenX, guard.lastSeenY);
      if (dd > 8) {
        const sp = GUARD.returnSpeed * state.level.guardSpeed;
        moveCircle(state.level, guard, ((guard.lastSeenX - guard.x) / dd) * sp * dt, ((guard.lastSeenY - guard.y) / dd) * sp * dt);
      } else {
        guard.angle += guard.scanDir * 1.6 * dt;
        guard.searchTimer -= dt;
        if (guard.searchTimer < GUARD.searchTime / 2 && guard.scanDir > 0) guard.scanDir = -1;
        if (guard.searchTimer <= 0) {
          guard.state = GUARD_RETURN;
          guard.suspicion = 0;
        }
      }
    } else if (guard.state === GUARD_RETURN) {
      // Walk back to the nearest waypoint, then resume the patrol.
      let best = 0;
      let bestD = Infinity;
      guard.waypoints.forEach((w, i) => {
        const dd = dist(guard.x, guard.y, w.x, w.y);
        if (dd < bestD) { bestD = dd; best = i; }
      });
      const target = guard.waypoints[best];
      const dd = dist(guard.x, guard.y, target.x, target.y);
      if (dd > 10) {
        faceToward(target.x, target.y, 5);
        const sp = GUARD.returnSpeed * state.level.guardSpeed;
        moveCircle(state.level, guard, ((target.x - guard.x) / dd) * sp * dt, ((target.y - guard.y) / dd) * sp * dt);
      } else {
        guard.wp = (best + 1) % guard.waypoints.length;
        guard.state = GUARD_PATROL;
      }
    } else {
      // Patrol: walk the loop, pause and scan at each waypoint.
      const target = guard.waypoints[guard.wp];
      const dd = dist(guard.x, guard.y, target.x, target.y);
      if (guard.pause > 0) {
        guard.pause -= dt;
        guard.angle += guard.scanDir * 0.9 * dt;
        if (guard.pause <= 0) guard.scanDir *= -1;
      } else if (dd > 6) {
        faceToward(target.x, target.y, 6);
        const before = { x: guard.x, y: guard.y };
        moveCircle(state.level, guard, ((target.x - guard.x) / dd) * guard.speed * dt, ((target.y - guard.y) / dd) * guard.speed * dt);
        if (dist(before.x, before.y, guard.x, guard.y) < guard.speed * dt * 0.2) {
          guard.stuck += dt;
          if (guard.stuck > 1.2) { guard.wp = (guard.wp + 1) % guard.waypoints.length; guard.stuck = 0; }
        } else guard.stuck = 0;
      } else {
        guard.wp = (guard.wp + 1) % guard.waypoints.length;
        guard.pause = GUARD.waypointPause;
      }
      // A guard that gets suspicious stops patrolling and stares.
      if (guard.suspicion >= GUARD.suspiciousAt) guard.state = GUARD_SUSPICIOUS;
    }
    return events.value;
  }

  /**
   * One fixed step. `move` is {x, y} (unit-ish direction) and `sneak` is the sneak key.
   * Returns event flags. With `harmless` set (the title screen's backdrop) nothing is caught
   * and nothing is collected.
   */
  function step(dt, move, sneak, harmless) {
    let events = 0;
    const ev = { value: 0 };
    state.time += dt;
    state.totalTime += dt;
    const p = state.player;
    p.sneaking = !!sneak;
    const len = Math.hypot(move.x, move.y);
    p.moving = len > 0.05;
    if (p.moving) {
      const speed = p.sneaking ? PLAYER.sneakSpeed : PLAYER.walkSpeed;
      const nx = (move.x / (len || 1)) * speed * dt;
      const ny = (move.y / (len || 1)) * speed * dt;
      moveCircle(state.level, p, nx, ny);
      p.angle = Math.atan2(ny, nx);
      const prev = p.stepPhase;
      p.stepPhase += (speed * dt) / 34;
      if (Math.floor(p.stepPhase) > Math.floor(prev)) {
        events |= p.sneaking ? EVENT_SNEAK_STEP : EVENT_STEP;
      }
    }

    for (const guard of state.guards) {
      updateGuard(guard, dt, ev);
    }
    events |= ev.value;
    state.alarm = state.guards.some((g) => g.state === GUARD_CHASE);

    if (!harmless) {
      for (const a of state.artifacts) {
        if (!a.taken && dist(p.x, p.y, a.x, a.y) < 26) {
          a.taken = true;
          state.collected += 1;
          events |= EVENT_PICKUP;
          if (state.collected >= state.artifacts.length) state.exitOpen = true;
        }
      }
      const ex = state.level.exit;
      const exCx = (ex.x + ex.w / 2) * TILE;
      const exCy = (ex.y + ex.h / 2) * TILE;
      if (state.exitOpen && Math.abs(p.x - exCx) < (ex.w * TILE) / 2 + 6 && Math.abs(p.y - exCy) < (ex.h * TILE) / 2 + 6) {
        if (state.levelIndex + 1 >= LEVEL.count) {
          state.status = 'won';
          events |= EVENT_WIN;
        } else {
          state.status = 'level-complete';
          events |= EVENT_LEVEL;
        }
      }
      if (events & EVENT_CAUGHT) state.status = 'caught';
    }
    return events;
  }

  function reset() {
    loadLevel(state.levelIndex);
  }

  function nextLevel() {
    loadLevel(state.levelIndex + 1);
  }

  function restartAll() {
    loadLevel(0);
    state.totalTime = 0;
  }

  loadLevel(0);
  return {
    state, step, reset, nextLevel, restartAll, loadLevel,
    dangerAt, coneFactor, guardSees, coverAt, hasLineOfSight,
  };
}
