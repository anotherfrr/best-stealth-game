// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s steps
// (several in a slow frame, none in a fast one), and the renderer paints what is there. The game
// moves between six screens: title, play, paused, caught, level-complete and win.
//
// ?seed=N fixes the guard patrols and artifact sparkle. ?shot=cover|sneak|alarm|win (with
// &seed=N) stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { BEST_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EVENT_ALARM, EVENT_CAUGHT, EVENT_LEVEL, EVENT_PICKUP, EVENT_SPOTTED, EVENT_STEP, EVENT_SNEAK_STEP, EVENT_WIN } from './world.js';
import { ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_CAUGHT, SCREEN_LEVEL, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WIN } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const audio = createAudio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best time then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best, scene.toast);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let toast = null;
  let toastUntil = 0;
  let accumulator = 0;
  let last = performance.now();

  // Screen readers (and anyone watching the page's text) hear the screen changes.
  function announce(message) {
    status.textContent = message;
  }

  function showToast(message, seconds) {
    toast = message;
    toastUntil = performance.now() + seconds * 1000;
  }

  function startLevel(index) {
    world.loadLevel(index);
    accumulator = 0;
    screen = SCREEN_PLAY;
    showToast(`${world.state.level.name} — ${world.state.level.par}`, 4);
    announce(`Playing ${world.state.level.name}.`);
  }

  function startGame() {
    world.restartAll();
    startLevel(0);
  }

  function handleEvents(events) {
    if (events & EVENT_PICKUP) {
      audio.pickup();
      renderer.spawnPickupBurst(world.state.player.x, world.state.player.y);
      if (world.state.exitOpen) {
        showToast('ALL ARTIFACTS LIFTED — reach the glowing EXIT!', 3);
        announce('All artifacts collected. Reach the exit.');
      }
    }
    if (events & EVENT_SPOTTED) {
      audio.spotted();
      announce('A guard is suspicious.');
    }
    if (events & EVENT_ALARM) {
      audio.alarm();
      showToast('SPOTTED! Break line of sight!', 2.5);
      announce('Alarm! A guard is chasing you.');
    }
    if (events & EVENT_STEP) audio.step(false);
    if (events & EVENT_SNEAK_STEP) audio.step(true);
    if (events & EVENT_CAUGHT) {
      audio.caught();
      screen = SCREEN_CAUGHT;
      announce('Caught by a guard.');
    } else if (events & EVENT_LEVEL) {
      audio.levelClear();
      screen = SCREEN_LEVEL;
      announce('Level complete.');
    } else if (events & EVENT_WIN) {
      audio.win();
      screen = SCREEN_WIN;
      const totalMs = Math.round(world.state.totalTime * 1000);
      if (best === 0 || totalMs < best) {
        best = totalMs;
        saveBest(best);
      }
      announce('You stole everything. The perfect heist.');
    }
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) {
      audio.setMuted(!audio.isMuted());
      showToast(audio.isMuted() ? 'Sound off' : 'Sound on', 1.2);
    }
    if (actions & ACTION_RESTART && (screen === SCREEN_PLAY || screen === SCREEN_CAUGHT)) {
      audio.unlock();
      startLevel(world.state.levelIndex);
      return;
    }
    if (actions & ACTION_RESTART && (screen === SCREEN_LEVEL || screen === SCREEN_WIN)) {
      audio.unlock();
      startGame();
      return;
    }
    if (actions & ACTION_CONFIRM) {
      audio.unlock();
      if (screen === SCREEN_TITLE || screen === SCREEN_WIN) startGame();
      else if (screen === SCREEN_CAUGHT) startLevel(world.state.levelIndex);
      else if (screen === SCREEN_LEVEL) startLevel(world.state.levelIndex + 1);
      else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
    }
    if (actions & ACTION_PAUSE) {
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
    }
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      world.step(STEP, { x: 0, y: 0 }, false, true);
      return;
    }
    if (screen !== SCREEN_PLAY) return;
    const events = world.step(STEP, input.move(), input.sneaking(), false);
    handleEvents(events);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    if (toast && now > toastUntil) toast = null;
    renderer.draw(world.state, screen, best, screen === SCREEN_PLAY ? toast : null);
  }

  // Leaving the tab pauses a running game rather than letting guards close in unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Midnight Gallery. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
