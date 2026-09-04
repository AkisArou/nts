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
  type Completion,
  type Completer,
  type InterfaceOptions,
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
export type { InterfaceOptions, Completer };
export type Interface = InterfaceClass;

/**
 * `Interface` is callable with and without `new`.
 *
 * `readline.Interface(input, output)` is documented and used, and a class
 * constructor throws when called without `new`. So the exported binding is a
 * function that constructs either way, with `new.target` forwarded so that a
 * subclass still gets its own prototype. `node:console` does the same for the
 * same reason.
 */
export interface InterfaceConstructor {
  new (options: InterfaceOptions): InterfaceClass;
  new (input: unknown, output?: unknown, completer?: Completer, terminal?: boolean): InterfaceClass;
  (options: InterfaceOptions): InterfaceClass;
  (input: unknown, output?: unknown, completer?: Completer, terminal?: boolean): InterfaceClass;
  readonly prototype: InterfaceClass;
}

/**
 * Give a one-argument completer the callback shape.
 *
 * The callback interface must not defer: a completer that answers immediately
 * has to complete the line immediately, and awaiting an already-resolved value
 * still costs a microtask. Wrapping it here rather than awaiting it later is
 * what makes that true, and it is node's own line.
 *
 * `node:readline/promises` deliberately does not do this -- there, taking a
 * turn is the point.
 */
function asCallbackCompleter(completer: Completer | undefined): Completer | undefined {
  if (typeof completer !== "function" || completer.length === 2) return completer;
  const real = completer as (line: string) => Completion;
  return ((line: string, callback: (err: unknown, result?: Completion) => void): void => {
    callback(null, real(line));
  }) as Completer;
}

/** The options object or the positional arguments, with the completer wrapped. */
function normalise(options: unknown, rest: unknown[]): [unknown, unknown[]] {
  const o = options as { completer?: Completer } | null;
  if (o && typeof o === "object" && "input" in o) {
    return [{ ...o, completer: asCallbackCompleter(o.completer) }, rest];
  }
  const next = rest.slice();
  next[1] = asCallbackCompleter(next[1] as Completer | undefined);
  return [options, next];
}

const InterfaceCtor = function (this: unknown, ...args: unknown[]): InterfaceClass {
  const [options, rest] = normalise(args[0], args.slice(1));
  return Reflect.construct(
    InterfaceClass,
    [options, ...rest],
    new.target ?? InterfaceClass,
  ) as InterfaceClass;
} as unknown as InterfaceConstructor;

Object.defineProperty(InterfaceCtor, "name", {
  __proto__: null,
  value: "Interface",
} as PropertyDescriptor);
(InterfaceCtor as { prototype: InterfaceClass }).prototype = InterfaceClass.prototype;
Object.setPrototypeOf(InterfaceCtor, InterfaceClass);

export { InterfaceCtor as Interface };

/**
 * Build an interface.
 *
 * Both call shapes, because the positional one predates the options object and
 * a great deal of code still uses it.
 */
export function createInterface(options: InterfaceOptions): InterfaceClass;
export function createInterface(
  input: unknown,
  output?: unknown,
  completer?: Completer,
  terminal?: boolean,
): InterfaceClass;
export function createInterface(options: unknown, ...rest: unknown[]): InterfaceClass {
  const [normalised, positional] = normalise(options, rest);
  return new InterfaceClass(normalised as InterfaceOptions, ...positional);
}
