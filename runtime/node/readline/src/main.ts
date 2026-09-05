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
import {
  Interface as InterfaceClass,
  type Completer,
  type InputStream,
  type InterfaceOptions,
  type OutputStream,
} from "./interface.ts";
import { emitKeypressEvents } from "./keypress.ts";
import * as promises from "./promises.ts";

export {
  clearLine,
  clearScreenDown,
  cursorTo,
  emitKeypressEvents,
  moveCursor,
  promises,
};
export type { InterfaceOptions, Completer, InputStream, OutputStream };

// Node's historical constructor is also callable without `new`. A class is
// the statically typed form of that constructor; the callable facade requires
// function/prototype metaobjects and is intentionally outside §13.
export { InterfaceClass as Interface };

// Raw implementation exports for the conformance harness's node-internal
// facades. The public shape deliberately omits these names. Direct re-exports
// preserve the original functions without adding forwarding calls, and keep
// the compiled lane from importing TypeScript helpers beside its addon.
export {
  charLengthAt,
  charLengthLeft,
  commonPrefix,
  emitKeys,
  kSubstringSearch,
  reverseString,
} from "./utils.ts";
export { getStringWidth } from "../../util/src/width.ts";
export { inspect } from "../../util/src/inspect.ts";
export { stripVTControlCharacters } from "../../util/src/main.ts";

/**
 * Build an interface.
 *
 * Both call shapes, because the positional one predates the options object and
 * a great deal of code still uses it.
 */
export function createInterface(options: InterfaceOptions): InterfaceClass;
export function createInterface(
  input: InputStream,
  output?: OutputStream | null,
  completer?: Completer,
  terminal?: boolean,
): InterfaceClass;
export function createInterface(
  options: InterfaceOptions | InputStream,
  output?: OutputStream | null,
  completer?: Completer,
  terminal?: boolean,
): InterfaceClass {
  if ("input" in options) {
    return new InterfaceClass(options);
  }
  return new InterfaceClass(options, output, completer, terminal);
}
