/**
 * An app's drive: `drive.ts` beside its `main.ts`, the app's own test, and no
 * part of its program. It uses the app as a person would -- typing, keys,
 * clicks, a reload -- through the page, and records what it sees.
 * `tooling/chromium/app.ts check` runs it twice, each time in a fresh profile
 * of the same shell, from the same origin: on the compiled app, and on the
 * same TypeScript run as page script by V8. The two transcripts must agree.
 *
 *   import type { AppDrive } from ".../tooling/chromium/app-drive.ts";
 *   export async function drive(app: AppDrive): Promise<void> { ... }
 *
 * Record only what the app decides. A value that depends on how long a step
 * took (a debounce that may or may not have fired yet) differs between two
 * runs of either arm: wait for the state with `until`, then record it.
 */
export interface AppDrive {
  /** An expression's value in the page; a promise is awaited. */
  evaluate<T>(expression: string): Promise<T>;
  /** Waits until an expression is truthy in the page; one that throws is not, yet. */
  until(expression: string, label: string): Promise<void>;
  /** Focuses the element `selector` names and types `text` into it, as input events. */
  type(selector: string, text: string): Promise<void>;
  /** Presses and releases a key; `modifiers` as DevTools spells them (1 Alt, 2 Ctrl, 4 Meta, 8 Shift). */
  press(key: string, code: string, keyCode: number, modifiers?: number): Promise<void>;
  /**
   * The mouse's left button, at (x, y) in the page's CSS pixels: pressed,
   * moved (while pressed, a drag) or released. The page sees it as a person's
   * mouse, pointer events included.
   */
  mouse(action: "press" | "move" | "release", x: number, y: number): Promise<void>;
  /** Reloads the page: the app ends and starts again, its storage kept. */
  reload(): Promise<void>;
  /** Records a value under a label, as one line of the transcript. */
  record(label: string, value: unknown): void;
}
