// Управление: клавиатура, тач-кнопки и геймпад — всё сводится к одному Input.

import type { Input } from './physics';

export type HorizonAction = 'pause' | 'respawn' | 'camera' | 'mute' | 'restart' | 'help';

export type TouchState = {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  nitro: boolean;
  handbrake: boolean;
};

const KEY_THROTTLE = new Set(['ArrowUp', 'KeyW', 'KeyЦ']);
const KEY_BRAKE = new Set(['ArrowDown', 'KeyS', 'KeyЫ']);
const KEY_LEFT = new Set(['ArrowLeft', 'KeyA', 'KeyФ']);
const KEY_RIGHT = new Set(['ArrowRight', 'KeyD', 'KeyВ']);
const KEY_HANDBRAKE = new Set(['Space']);
const KEY_NITRO = new Set(['ShiftLeft', 'ShiftRight']);

export class InputController {
  readonly touch: TouchState = {
    throttle: false,
    brake: false,
    left: false,
    right: false,
    nitro: false,
    handbrake: false,
  };
  private keys = new Set<string>();
  private onAction: (action: HorizonAction) => void;
  private attached = false;
  private steerSmooth = 0;
  private enabled = true;

  constructor(onAction: (action: HorizonAction) => void) {
    this.onAction = onAction;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.keys.clear();
      this.touch.throttle = false;
      this.touch.brake = false;
      this.touch.left = false;
      this.touch.right = false;
      this.touch.nitro = false;
      this.touch.handbrake = false;
    }
  }

  attach(): void {
    if (this.attached || typeof window === 'undefined') return;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached || typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.attached = false;
  }

  private handleBlur = (): void => {
    this.keys.clear();
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    const code = event.code;
    if (
      KEY_THROTTLE.has(code) ||
      KEY_BRAKE.has(code) ||
      KEY_LEFT.has(code) ||
      KEY_RIGHT.has(code) ||
      KEY_HANDBRAKE.has(code) ||
      code === 'Space'
    ) {
      event.preventDefault();
    }
    if (event.repeat) return;
    this.keys.add(code);

    switch (code) {
      case 'Escape':
      case 'KeyP':
        this.onAction('pause');
        break;
      case 'KeyR':
        this.onAction('respawn');
        break;
      case 'KeyC':
        this.onAction('camera');
        break;
      case 'KeyM':
        this.onAction('mute');
        break;
      case 'KeyH':
        this.onAction('help');
        break;
      case 'Enter':
        this.onAction('restart');
        break;
      default:
        break;
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  /** Снимок состояния для физики. dt нужен для сглаживания руля с клавиатуры. */
  snapshot(dt: number): Input {
    if (!this.enabled) return { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };

    const keys = this.keys;
    let throttle = this.touch.throttle ? 1 : 0;
    let brake = this.touch.brake ? 1 : 0;
    let steerTarget = (this.touch.right ? 1 : 0) - (this.touch.left ? 1 : 0);
    let handbrake = this.touch.handbrake;
    let nitro = this.touch.nitro;

    for (const key of keys) {
      if (KEY_THROTTLE.has(key)) throttle = 1;
      if (KEY_BRAKE.has(key)) brake = 1;
      if (KEY_LEFT.has(key)) steerTarget = -1;
      if (KEY_RIGHT.has(key)) steerTarget = 1;
      if (KEY_HANDBRAKE.has(key)) handbrake = true;
      if (KEY_NITRO.has(key)) nitro = true;
    }

    // Геймпад: левый стик + RT/LT + A + RB.
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const axis = pad.axes[0] ?? 0;
      if (Math.abs(axis) > 0.14) steerTarget = Math.max(-1, Math.min(1, axis * 1.15));
      const forward = pad.buttons[7]?.value ?? 0;
      const back = pad.buttons[6]?.value ?? 0;
      if (forward > 0.06) throttle = Math.max(throttle, forward);
      if (back > 0.06) brake = Math.max(brake, back);
      if (pad.buttons[0]?.pressed) handbrake = true;
      if (pad.buttons[5]?.pressed) nitro = true;
      break;
    }

    // Сглаживание «цифрового» руля, чтобы машина не дёргалась.
    const rate = steerTarget === 0 ? 7 : 5.5;
    const k = 1 - Math.exp(-rate * Math.max(0.001, dt));
    this.steerSmooth += (steerTarget - this.steerSmooth) * k;
    if (Math.abs(this.steerSmooth) < 0.001) this.steerSmooth = 0;

    return {
      throttle,
      brake,
      steer: this.steerSmooth,
      handbrake,
      nitro,
    };
  }
}
