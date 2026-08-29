// `node:readline`, from node v24.20.0 `lib/readline.js`.
//
// Two things under one name, and only one of them is a line editor.
//
// The cursor functions -- `cursorTo`, `moveCursor`, `clearLine`,
// `clearScreenDown` -- are escape sequences written to a stream, and they live
// in `internal/` rather than here because `console.clear()` needs two of them
// and loading a line editor in order to clear a screen would be absurd. Node
// splits them for the same reason. They are re-exported from here because
// that is where programs look for them.
//
// The line editor is `Interface`. What it does depends entirely on whether it
// has a terminal: with one it owns the cursor, the history and the key
// bindings; without one it is a line splitter over a decoded byte stream. A
// program cannot tell which it will get, and the `line` events mean the same
// thing either way.

import {
  clearLine,
  clearScreenDown,
  cursorTo,
  moveCursor,
} from "../../internal/readline-callbacks.ts";
import { Interface, type InterfaceOptions, type Completer } from "./interface.ts";
import { emitKeypressEvents } from "./keypress.ts";
import * as promises from "./promises.ts";

export {
  Interface,
  clearLine,
  clearScreenDown,
  cursorTo,
  emitKeypressEvents,
  moveCursor,
  promises,
};
export type { InterfaceOptions, Completer };

/**
 * Build an interface.
 *
 * Both call shapes, because the positional one predates the options object and
 * a great deal of code still uses it.
 */
export function createInterface(options: InterfaceOptions): Interface;
export function createInterface(
  input: unknown,
  output?: unknown,
  completer?: Completer,
  terminal?: boolean,
): Interface;
export function createInterface(options: unknown, ...rest: unknown[]): Interface {
  return new Interface(options as InterfaceOptions, ...rest);
}
