// Drawing only: the world's state and the current screen in, pixels out. The 1280x720
// playfield is scaled to fit the window and centred, the margin filled with the backdrop colour.
// Vision cones are raycast against the walls, so a cone stops at a wall exactly like sight does,
// and the night lighting is punched out around the thief, the guards and the loot.

import { COLS, FIELD, FONT, GUARD, PALETTE, ROWS, STEP, TILE } from './config.js';
import { isWall, tileAt, TILE_BUSH, TILE_SHADOW, TILE_WALL } from './levels.js';
import { GUARD_CHASE, GUARD_SUSPICIOUS, angleDiff } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_CAUGHT = 'caught';
export const SCREEN_LEVEL = 'level';
export const SCREEN_WIN = 'win';

const PANEL = { width: 640, top: 150, line: 34, bottom: 76 };
const CONE_RAYS = 26;

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const light = document.createElement('canvas');
  light.width = FIELD.width;
  light.height = FIELD.height;
  const lctx = light.getContext('2d');
  const particles = [];
  let time = 0;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  const fonts = new Map();
  function font(size) {
    if (!fonts.has(size)) fonts.set(size, `700 ${size}px ${FONT}`);
    return fonts.get(size);
  }
  function text(value, x, y, size, color, align, weight) {
    context.font = weight === 'normal' ? `${size}px ${FONT}` : font(size);
    context.fillStyle = color;
    context.textAlign = align;
    context.fillText(value, x, y);
  }

  function spawnPickupBurst(x, y) {
    for (let i = 0; i < 22; i += 1) {
      const a = (i / 22) * Math.PI * 2;
      particles.push({ x, y, vx: Math.cos(a) * (40 + (i % 5) * 22), vy: Math.sin(a) * (40 + (i % 5) * 22), life: 0.7, max: 0.7, color: PALETTE.artifact });
    }
  }

  function drawFloor(state) {
    const level = state.level;
    for (let ty = 0; ty < ROWS; ty += 1) {
      for (let tx = 0; tx < COLS; tx += 1) {
        const t = level.grid[ty * COLS + tx];
        const x = tx * TILE;
        const y = ty * TILE;
        if (t === TILE_WALL) continue;
        context.fillStyle = (tx + ty) % 2 === 0 ? PALETTE.floorA : PALETTE.floorB;
        context.fillRect(x, y, TILE, TILE);
        if (t === TILE_SHADOW) {
          context.fillStyle = PALETTE.shadowZone;
          context.fillRect(x, y, TILE, TILE);
          context.strokeStyle = PALETTE.shadowEdge;
          context.lineWidth = 1;
          context.setLineDash([4, 4]);
          context.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
          context.setLineDash([]);
        }
      }
    }
    // Tile seams, faint.
    context.strokeStyle = PALETTE.floorLine;
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 0; x <= FIELD.width; x += TILE) { context.moveTo(x, 0); context.lineTo(x, ROWS * TILE); }
    for (let y = 0; y <= ROWS * TILE; y += TILE) { context.moveTo(0, y); context.lineTo(FIELD.width, y); }
    context.stroke();
  }

  function drawWalls(state) {
    const level = state.level;
    for (let ty = 0; ty < ROWS; ty += 1) {
      for (let tx = 0; tx < COLS; tx += 1) {
        if (level.grid[ty * COLS + tx] !== TILE_WALL) continue;
        const x = tx * TILE;
        const y = ty * TILE;
        context.fillStyle = PALETTE.wall;
        context.fillRect(x, y, TILE, TILE);
        context.fillStyle = PALETTE.wallTop;
        context.fillRect(x, y, TILE, 7);
        context.fillStyle = PALETTE.wallEdge;
        context.fillRect(x, y + TILE - 3, TILE, 3);
        context.fillRect(x + TILE - 3, y, 3, TILE);
      }
    }
  }

  function drawBushes(state) {
    const level = state.level;
    for (let ty = 0; ty < ROWS; ty += 1) {
      for (let tx = 0; tx < COLS; tx += 1) {
        if (level.grid[ty * COLS + tx] !== TILE_BUSH) continue;
        const cx = tx * TILE + 16;
        const cy = ty * TILE + 16;
        context.fillStyle = PALETTE.bush;
        context.fillRect(tx * TILE, ty * TILE, TILE, TILE);
        context.fillStyle = PALETTE.bushLeaf;
        context.beginPath();
        context.arc(cx - 6, cy - 4, 9, 0, Math.PI * 2);
        context.arc(cx + 7, cy + 3, 8, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = PALETTE.bushLeaf2;
        context.beginPath();
        context.arc(cx + 2, cy - 7, 6, 0, Math.PI * 2);
        context.arc(cx - 8, cy + 7, 5, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  function drawArtifacts(state) {
    for (const a of state.artifacts) {
      if (a.taken) continue;
      const bob = Math.sin(time * 2.4 + a.bob) * 3;
      const pulse = 1 + Math.sin(time * 3 + a.bob) * 0.12;
      const r = 13 * pulse;
      const glow = context.createRadialGradient(a.x, a.y + bob, 2, a.x, a.y + bob, 34);
      glow.addColorStop(0, 'rgba(242, 201, 76, 0.55)');
      glow.addColorStop(1, 'rgba(242, 201, 76, 0)');
      context.fillStyle = glow;
      context.beginPath();
      context.arc(a.x, a.y + bob, 34, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = PALETTE.artifact;
      context.beginPath();
      context.moveTo(a.x, a.y + bob - r);
      context.lineTo(a.x + r * 0.7, a.y + bob);
      context.lineTo(a.x, a.y + bob + r);
      context.lineTo(a.x - r * 0.7, a.y + bob);
      context.closePath();
      context.fill();
      context.fillStyle = '#fff7d6';
      context.beginPath();
      context.moveTo(a.x, a.y + bob - r * 0.55);
      context.lineTo(a.x + r * 0.35, a.y + bob);
      context.lineTo(a.x, a.y + bob + r * 0.55);
      context.lineTo(a.x - r * 0.35, a.y + bob);
      context.closePath();
      context.fill();
    }
  }

  function drawExit(state) {
    const ex = state.level.exit;
    const x = ex.x * TILE;
    const y = ex.y * TILE;
    const w = ex.w * TILE;
    const h = ex.h * TILE;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const open = state.exitOpen;
    const pulse = open ? 0.75 + Math.sin(time * 4) * 0.25 : 0.35;
    const glow = context.createRadialGradient(cx, cy, 4, cx, cy, 70);
    glow.addColorStop(0, open ? `rgba(53, 208, 127, ${0.55 * pulse + 0.25})` : 'rgba(58, 90, 72, 0.4)');
    glow.addColorStop(1, 'rgba(53, 208, 127, 0)');
    context.fillStyle = glow;
    context.fillRect(cx - 70, cy - 70, 140, 140);
    context.fillStyle = open ? PALETTE.exit : PALETTE.exitLocked;
    context.fillRect(x + 4, y + 4, w - 8, h - 8);
    context.strokeStyle = open ? '#a9f5cd' : '#5a7a68';
    context.lineWidth = 3;
    context.strokeRect(x + 4, y + 4, w - 8, h - 8);
    text('EXIT', cx, cy + 7, 20, open ? '#062b18' : '#c8d8cc', 'center');
    if (!open) {
      text(`LOCKED ${state.collected}/${state.artifacts.length}`, cx, y + h + 22, 15, PALETTE.muted, 'center', 'normal');
    }
  }

  /** Raycast one cone edge: the furthest visible point along `angle`. */
  function coneRay(state, gx, gy, angle, range) {
    const step = 10;
    let d = 0;
    while (d < range) {
      d += step;
      const x = gx + Math.cos(angle) * d;
      const y = gy + Math.sin(angle) * d;
      if (x < 0 || y < 0 || x >= FIELD.width || y >= FIELD.height || isWall(state.level, x, y)) break;
    }
    return { x: gx + Math.cos(angle) * Math.min(d, range), y: gy + Math.sin(angle) * Math.min(d, range) };
  }

  function drawCones(state) {
    for (const g of state.guards) {
      const color = g.state === GUARD_CHASE ? PALETTE.coneAlarm
        : g.state === GUARD_SUSPICIOUS ? PALETTE.coneSuspicious : PALETTE.cone;
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(g.x, g.y);
      for (let i = 0; i <= CONE_RAYS; i += 1) {
        const a = g.angle - GUARD.viewHalfAngle + (2 * GUARD.viewHalfAngle * i) / CONE_RAYS;
        const hit = coneRay(state, g.x, g.y, a, g.viewRange);
        context.lineTo(hit.x, hit.y);
      }
      context.closePath();
      context.fill();
    }
  }

  function drawPatrolPaths(state) {
    context.strokeStyle = 'rgba(238, 241, 245, 0.13)';
    context.lineWidth = 2;
    context.setLineDash([3, 9]);
    for (const g of state.guards) {
      context.beginPath();
      g.waypoints.forEach((w, i) => {
        if (i === 0) context.moveTo(w.x, w.y);
        else context.lineTo(w.x, w.y);
      });
      context.closePath();
      context.stroke();
    }
    context.setLineDash([]);
  }

  function drawGuards(state) {
    for (const g of state.guards) {
      // Body: uniformed guard, facing the cone.
      context.fillStyle = PALETTE.guardDark;
      context.beginPath();
      context.arc(g.x, g.y, g.radius + 2, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = PALETTE.guard;
      context.beginPath();
      context.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
      context.fill();
      // Cap brim + facing tick.
      context.strokeStyle = '#ffd9d6';
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(g.x, g.y);
      context.lineTo(g.x + Math.cos(g.angle) * (g.radius + 6), g.y + Math.sin(g.angle) * (g.radius + 6));
      context.stroke();
      context.fillStyle = '#fff';
      context.beginPath();
      context.arc(g.x + Math.cos(g.angle) * 5, g.y + Math.sin(g.angle) * 5, 3.5, 0, Math.PI * 2);
      context.fill();
      // Suspicion ring + ? / ! overhead.
      if (g.suspicion > 0.05 || g.state === GUARD_CHASE) {
        context.strokeStyle = g.state === GUARD_CHASE ? PALETTE.danger : PALETTE.gold;
        context.lineWidth = 3;
        context.beginPath();
        context.arc(g.x, g.y, g.radius + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * g.suspicion);
        context.stroke();
      }
      const mark = g.state === GUARD_CHASE ? '!' : g.state === GUARD_SUSPICIOUS ? '?' : null;
      if (mark) {
        const bounce = Math.sin(time * 6) * 2;
        text(mark, g.x, g.y - g.radius - 12 + bounce, 26, g.state === GUARD_CHASE ? PALETTE.danger : PALETTE.gold, 'center');
      }
    }
  }

  function drawPlayer(state) {
    const p = state.player;
    const r = p.sneaking ? p.radius - 2.5 : p.radius;
    // Soft shadow.
    context.fillStyle = 'rgba(0, 0, 0, 0.35)';
    context.beginPath();
    context.ellipse(p.x, p.y + r * 0.8, r, r * 0.45, 0, 0, Math.PI * 2);
    context.fill();
    // Cloak: a triangle behind the direction of travel.
    context.fillStyle = PALETTE.playerDark;
    context.beginPath();
    const back = p.angle + Math.PI;
    context.moveTo(p.x + Math.cos(back) * r * 1.25, p.y + Math.sin(back) * r * 1.25);
    context.lineTo(p.x + Math.cos(p.angle + 2.2) * r * 0.9, p.y + Math.sin(p.angle + 2.2) * r * 0.9);
    context.lineTo(p.x + Math.cos(p.angle - 2.2) * r * 0.9, p.y + Math.sin(p.angle - 2.2) * r * 0.9);
    context.closePath();
    context.fill();
    context.fillStyle = PALETTE.player;
    context.beginPath();
    context.arc(p.x, p.y, r, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#062b26';
    context.beginPath();
    context.arc(p.x + Math.cos(p.angle) * 4, p.y + Math.sin(p.angle) * 4, 4.5, 0, Math.PI * 2);
    context.fill();
    if (p.sneaking) {
      context.strokeStyle = 'rgba(55, 224, 200, 0.8)';
      context.lineWidth = 2;
      context.setLineDash([4, 4]);
      context.beginPath();
      context.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
      text('SNEAK', p.x, p.y - r - 10, 12, PALETTE.player, 'center', 'normal');
    }
  }

  function drawParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const pt = particles[i];
      pt.life -= dt;
      if (pt.life <= 0) { particles.splice(i, 1); continue; }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      context.globalAlpha = pt.life / pt.max;
      context.fillStyle = pt.color;
      context.fillRect(pt.x - 2, pt.y - 2, 4, 4);
    }
    context.globalAlpha = 1;
  }

  function drawDarkness(state) {
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, FIELD.width, FIELD.height);
    lctx.fillStyle = 'rgba(3, 5, 12, 0.48)';
    lctx.fillRect(0, 0, FIELD.width, FIELD.height);
    lctx.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r) => {
      const g = lctx.createRadialGradient(x, y, r * 0.15, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = g;
      lctx.beginPath();
      lctx.arc(x, y, r, 0, Math.PI * 2);
      lctx.fill();
    };
    hole(state.player.x, state.player.y, 235);
    for (const g of state.guards) hole(g.x, g.y, 135);
    for (const a of state.artifacts) if (!a.taken) hole(a.x, a.y, 55);
    const ex = state.level.exit;
    hole((ex.x + ex.w / 2) * TILE, (ex.y + ex.h / 2) * TILE, 95);
    lctx.globalCompositeOperation = 'source-over';
    context.drawImage(light, 0, 0);
  }

  function drawHud(state, screen) {
    // Top bar.
    context.fillStyle = 'rgba(10, 13, 22, 0.82)';
    context.fillRect(0, 0, FIELD.width, 46);
    context.fillStyle = PALETTE.panelEdge;
    context.fillRect(0, 46, FIELD.width, 2);
    text(state.level.name, 18, 31, 20, PALETTE.text, 'left');
    // Artifacts.
    const artText = `◆ ${state.collected}/${state.artifacts.length}`;
    text(artText, 300, 31, 20, state.exitOpen ? PALETTE.exit : PALETTE.gold, 'left');
    if (state.exitOpen) text('→ EXIT OPEN', 390, 31, 18, PALETTE.exit, 'left');
    // Detection meter, centre-right.
    const max = Math.max(0, ...state.guards.map((g) => g.suspicion));
    const alarm = state.alarm;
    const label = alarm ? '! ALARM !' : max >= 0.35 ? '? SPOTTED' : 'HIDDEN';
    const labelColor = alarm ? PALETTE.danger : max >= 0.35 ? PALETTE.gold : PALETTE.safe;
    const mx = 640;
    text(label, mx, 31, 19, labelColor, 'center');
    context.fillStyle = 'rgba(255,255,255,0.16)';
    context.fillRect(mx + 90, 15, 150, 14);
    context.fillStyle = labelColor;
    context.fillRect(mx + 90, 15, 150 * max, 14);
    // Timer + level.
    text(fmtTime(state.totalTime), FIELD.width - 120, 31, 20, PALETTE.text, 'right');
    text(`Lv ${state.levelIndex + 1}/3`, FIELD.width - 18, 31, 20, PALETTE.muted, 'right');
    // Bottom hint bar.
    if (screen === SCREEN_PLAY) {
      context.fillStyle = 'rgba(10, 13, 22, 0.66)';
      context.fillRect(0, FIELD.height - 30, FIELD.width, 30);
      text('WASD / arrows — move    SHIFT — sneak    R — restart    P — pause    M — mute', 18, FIELD.height - 9, 15, PALETTE.muted, 'left', 'normal');
      const cover = state.player ? coverHint(state) : '';
      if (cover) text(cover, FIELD.width - 18, FIELD.height - 9, 15, PALETTE.safe, 'right', 'normal');
    }
  }

  function coverHint(state) {
    const t = tileAt(state.level, state.player.x, state.player.y);
    if (t === TILE_BUSH) return 'HIDDEN IN BUSH';
    if (t === TILE_SHADOW) return 'IN SHADOW - hard to spot';
    return '';
  }

  function drawPanel(title, lines, prompt, accent) {
    const height = PANEL.top + lines.length * PANEL.line + PANEL.bottom;
    const x = (FIELD.width - PANEL.width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = 'rgba(5, 7, 13, 0.55)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    context.fillStyle = PALETTE.panel;
    context.fillRect(x, y, PANEL.width, height);
    context.strokeStyle = accent || PALETTE.panelEdge;
    context.lineWidth = 2;
    context.strokeRect(x, y, PANEL.width, height);
    text(title, FIELD.width / 2, y + 76, 46, PALETTE.text, 'center');
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], FIELD.width / 2, y + PANEL.top + index * PANEL.line, 21, PALETTE.muted, 'center', 'normal');
    }
    text(prompt, FIELD.width / 2, y + height - 38, 23, PALETTE.gold, 'center');
  }

  function drawField(state, dt) {
    time += dt;
    drawFloor(state);
    drawBushes(state);
    drawArtifacts(state);
    drawExit(state);
    drawWalls(state);
    drawPatrolPaths(state);
    drawDarkness(state);
    drawCones(state);
    drawGuards(state);
    drawPlayer(state);
    drawParticles(dt);
  }

  /** Paint one frame: the field, then the HUD or a panel for the screen the game is on. */
  function draw(state, screen, bestMs, toast) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    drawField(state, STEP);
    if (screen === SCREEN_TITLE) {
      drawPanel('MIDNIGHT GALLERY', [
        'A night museum heist. Steal every artifact,',
        'slip past the guards, and reach the glowing EXIT unseen.',
        'Vision cones are real: walls block sight, bushes and',
        'shadows hide you. Get spotted and they chase — break',
        'line of sight to cool the alarm down.',
        '',
        'WASD / arrows — move · SHIFT — sneak · R — restart',
        bestMs ? `Best clear: ${fmtTime(bestMs / 1000)}` : 'No clean getaway yet — make one.',
      ], 'Press Space or click to start');
      return;
    }
    drawHud(state, screen);
    if (toast) {
      context.fillStyle = 'rgba(10, 13, 22, 0.85)';
      const w = 780;
      context.fillRect((FIELD.width - w) / 2, 60, w, 40);
      text(toast, FIELD.width / 2, 87, 19, PALETTE.gold, 'center');
    }
    if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The guards wait for no one — except now.'], 'Press P to resume');
    } else if (screen === SCREEN_CAUGHT) {
      drawPanel('CAUGHT!', [
        'A guard got their hands on you.',
        `You had ${state.collected} of ${state.artifacts.length} artifacts on ${state.level.name}.`,
        'Sneak slower, watch the cones, use the bushes.',
      ], 'Press Space or R to try again', PALETTE.danger);
    } else if (screen === SCREEN_LEVEL) {
      drawPanel('CLEAN GETAWAY', [
        `${state.level.name} — all artifacts lifted.`,
        `Level time ${fmtTime(state.time)} · total ${fmtTime(state.totalTime)}`,
        'The next wing has more guards on patrol.',
      ], 'Press Space for the next level', PALETTE.exit);
    } else if (screen === SCREEN_WIN) {
      drawPanel('THE PERFECT HEIST', [
        'Every artifact from every wing. The museum never',
        'knew you were there.',
        `Total time ${fmtTime(state.totalTime)}${bestMs ? ` · best ${fmtTime(bestMs / 1000)}` : ''}`,
      ], 'Press Space to play again', PALETTE.exit);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, spawnPickupBurst };
}
