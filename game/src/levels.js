// The three museum floors. Each level is built from rectangles of tiles on a 40x22 grid, so
// the layout is exact and readable: walls block movement and sight, bushes and shadow zones are
// cover, artifacts are the loot, the exit is the way out. Guard patrols are waypoint loops in
// tile coordinates; the waypoints are placed on open floor, never inside a wall.

import { COLS, ROWS } from './config.js';

/** Tile kinds, stored in the level's grid. */
export const TILE_FLOOR = 0;
export const TILE_WALL = 1;
export const TILE_BUSH = 2;
export const TILE_SHADOW = 3;

function buildGrid(walls, bushes, shadows) {
  const grid = new Uint8Array(COLS * ROWS);
  // Border walls all round.
  for (let x = 0; x < COLS; x += 1) {
    grid[x] = TILE_WALL;
    grid[(ROWS - 1) * COLS + x] = TILE_WALL;
  }
  for (let y = 0; y < ROWS; y += 1) {
    grid[y * COLS] = TILE_WALL;
    grid[y * COLS + COLS - 1] = TILE_WALL;
  }
  const paint = (rects, kind) => {
    for (const r of rects) {
      for (let y = r.y; y < r.y + r.h; y += 1) {
        for (let x = r.x; x < r.x + r.w; x += 1) grid[y * COLS + x] = kind;
      }
    }
  };
  paint(walls, TILE_WALL);
  paint(shadows, TILE_SHADOW);
  paint(bushes, TILE_BUSH);
  return grid;
}

function tile(x, y) {
  return { x: x * 32 + 16, y: y * 32 + 16 };
}

export const LEVELS = [
  {
    name: '1 · The Marble Hall',
    par: 'Steal 3 artifacts, then slip out the east door.',
    guardSpeed: 1.0,
    viewRange: 245,
    walls: [
      { x: 17, y: 8, w: 5, h: 4 },
      { x: 8, y: 3, w: 3, h: 4 },
      { x: 30, y: 13, w: 4, h: 4 },
    ],
    bushes: [
      { x: 2, y: 4, w: 2, h: 5 },
      { x: 13, y: 15, w: 2, h: 3 },
      { x: 26, y: 4, w: 2, h: 2 },
      { x: 34, y: 9, w: 2, h: 2 },
    ],
    shadows: [
      { x: 5, y: 13, w: 5, h: 4 },
      { x: 24, y: 14, w: 5, h: 4 },
    ],
    artifacts: [tile(6, 3), tile(20, 4), tile(36, 18)],
    exit: { x: 37, y: 1, w: 2, h: 2 },
    playerStart: tile(3, 19),
    guards: [
      { waypoints: [tile(12, 2), tile(26, 2), tile(26, 7), tile(12, 7)] },
      { waypoints: [tile(10, 18), tile(30, 18), tile(30, 12), tile(10, 12)] },
    ],
  },
  {
    name: '2 · The Sculpture Wing',
    par: 'Three guards, tighter patrols. Use the dark corners.',
    guardSpeed: 1.15,
    viewRange: 255,
    walls: [
      { x: 13, y: 12, w: 2, h: 6 },
      { x: 26, y: 4, w: 2, h: 6 },
      { x: 18, y: 9, w: 4, h: 4 },
    ],
    bushes: [
      { x: 3, y: 3, w: 2, h: 4 },
      { x: 35, y: 15, w: 2, h: 4 },
      { x: 15, y: 17, w: 2, h: 3 },
      { x: 24, y: 3, w: 2, h: 2 },
    ],
    shadows: [
      { x: 6, y: 15, w: 5, h: 4 },
      { x: 29, y: 5, w: 5, h: 4 },
    ],
    artifacts: [tile(5, 10), tile(20, 3), tile(34, 12)],
    exit: { x: 37, y: 1, w: 2, h: 2 },
    playerStart: tile(2, 19),
    guards: [
      { waypoints: [tile(8, 3), tile(20, 3), tile(20, 7), tile(8, 7)] },
      { waypoints: [tile(30, 12), tile(36, 12), tile(36, 18), tile(30, 18)] },
      { waypoints: [tile(23, 5), tile(23, 16)] },
    ],
  },
  {
    name: '3 · The Vault',
    par: 'Four guards on the night shift. Patience wins.',
    guardSpeed: 1.2,
    viewRange: 265,
    walls: [
      { x: 10, y: 3, w: 3, h: 5 },
      { x: 27, y: 3, w: 3, h: 5 },
      { x: 10, y: 14, w: 3, h: 5 },
      { x: 27, y: 14, w: 3, h: 5 },
      { x: 18, y: 9, w: 4, h: 4 },
    ],
    bushes: [
      { x: 2, y: 9, w: 2, h: 4 },
      { x: 36, y: 10, w: 2, h: 4 },
      { x: 15, y: 18, w: 2, h: 2 },
      { x: 23, y: 2, w: 2, h: 2 },
      { x: 5, y: 10, w: 2, h: 2 },
    ],
    shadows: [
      { x: 5, y: 4, w: 4, h: 4 },
      { x: 31, y: 16, w: 5, h: 4 },
      { x: 8, y: 10, w: 4, h: 3 },
    ],
    artifacts: [tile(19, 7), tile(36, 5), tile(4, 16)],
    exit: { x: 37, y: 1, w: 2, h: 2 },
    playerStart: tile(2, 19),
    guards: [
      { waypoints: [tile(6, 2), tile(20, 2), tile(20, 8), tile(6, 8)] },
      { waypoints: [tile(33, 2), tile(33, 12), tile(24, 12), tile(24, 8), tile(33, 8)] },
      { waypoints: [tile(6, 18), tile(20, 18)] },
      { waypoints: [tile(33, 18), tile(33, 13), tile(36, 13), tile(36, 18)] },
    ],
  },
];

/** A level with its tile grid resolved. */
export function buildLevel(index) {
  const def = LEVELS[index % LEVELS.length];
  return {
    ...def,
    index,
    grid: buildGrid(def.walls, def.bushes, def.shadows),
  };
}

export function tileAt(level, px, py) {
  const tx = Math.floor(px / 32);
  const ty = Math.floor(py / 32);
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return TILE_WALL;
  return level.grid[ty * COLS + tx];
}

export function isWall(level, px, py) {
  return tileAt(level, px, py) === TILE_WALL;
}
