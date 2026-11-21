// Input: keyboard state, mouse look deltas, pointer lock. The game reads this
// module's state once per fixed step; nothing here touches the simulation.
export const input = {
  keys: new Set(),
  // Accumulated mouse movement since the last step, consumed by the player.
  lookDX: 0,
  lookDY: 0,
  // True while the left button is held (auto weapons keep firing).
  firing: false,
  // True while the right button is held (aim down sights).
  aiming: false,
  locked: false,
  // Edge-triggered presses, consumed once by the match code each step.
  pressed: new Set(),
};

let canvas = null;
let onLockChange = null;

export function bindInput(canvasEl, callbacks) {
  canvas = canvasEl;
  onLockChange = callbacks.onLockChange;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys.add(e.code);
    input.pressed.add(e.code);
    if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.firing = false;
    input.aiming = false;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!input.locked) {
      canvas.requestPointerLock();
      return;
    }
    if (e.button === 0) input.firing = true;
    if (e.button === 2) input.aiming = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.lookDX += e.movementX;
    input.lookDY += e.movementY;
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (onLockChange) onLockChange(input.locked);
  });
}

export function consumeLook() {
  const dx = input.lookDX;
  const dy = input.lookDY;
  input.lookDX = 0;
  input.lookDY = 0;
  return { dx, dy };
}

export function wasPressed(code) {
  return input.pressed.has(code);
}

export function endStep() {
  input.pressed.clear();
}
