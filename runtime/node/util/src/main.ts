// `node:util`, from node v24.20.0 `lib/util.js`.
//
// The parts that stand on their own: `inspect` and `format` (what
// `console.log` is built from), `types`, `isDeepStrictEqual` (what
// `assert.deepStrictEqual` compares with), and the small helpers around them.

import {
  inspect,
  inspectColorCodes,
  inspectColorNames,
  inspectColors,
  inspectDefaultOptions,
  inspectStyles,
  type InspectOptions,
} from "./inspect.ts";
import { format, formatWithOptions } from "./format.ts";
import { isDeepStrictEqual as compareDeepStrict } from "./deep-equal.ts";
import * as types from "./types.ts";
import {
  captureStackTrace,
  ERR_FALSY_VALUE_REJECTION, ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE, ERR_OUT_OF_RANGE,
} from "../../internal/errors.ts";
import { nextTick } from "../../internal/tick.ts";
import { deprecate } from "../../internal/deprecate.ts";
import type { AbortSignalLike } from "../../internal/abort.ts";
import { EventTarget as WebEventTarget, addWeaklyHeldEventListener } from "../../../web-platform/src/core/events.ts";
import {
  validateBoolean, validateFunction, validateNumber, validateObject, validateOneOf, validateString,
  validateStringArray,
} from "../../internal/validators.ts";
import { myersDiff } from "../../internal/assert/myers-diff.ts";
import { parseArgs } from "./parse-args.ts";
import { isNodeStream, isReadableStream, isWritableStream } from "../../internal/streams/utils.ts";
import { shouldColorize } from "../../internal/colors.ts";
import { stdout } from "../../internal/stdio.ts";

export { inspect, inspectDefaultOptions, format, formatWithOptions, types };

/**
 * `util.inspect.defaultOptions`'s setter, node `lib/util.js`.
 *
 * **Node merges rather than replaces**, and that is not a detail: `inspect` and
 * `format` both read `inspectDefaultOptions` at call time, so replacing the
 * object would leave every caller reading the old defaults. Measured against node
 * -- `util.inspect.defaultOptions = { depth: 5 }` leaves the object identical and
 * its other eleven keys intact there, and here it replaced a twelve-key object
 * with a one-key one that nothing read.
 *
 * Exported for `shape.mjs`, which owns where the property sits -- on the
 * `inspect` function, which is public-object shaping rather than typed module
 * behaviour -- and which deletes this name from the published surface the way it
 * already deletes `inspectDefaultOptions`, `colors` and `styles`.
 */
export function setInspectDefaultOptions(options: unknown): void {
  validateObject(options, "options");
  Object.assign(inspectDefaultOptions, options);
}
export { deprecate };
export { parseArgs };

// Node re-exports the Encoding globals from `node:util`, and they are the same
// objects a program reaches as `TextEncoder` and `TextDecoder`. Re-exported
// from web-platform rather than reimplemented, so the identity holds.
//
// Placed next to `parseArgs` because node exports it there, and for no other
// reason. It was moved here to fix `Object.keys(require("util"))` order and
// that did nothing: `shape.mjs` spreads this module's namespace object, and a
// module namespace's keys are **alphabetical by specification**, not source
// order. No arrangement of these statements can change it. Matching node's
// order would mean `shape.mjs` naming its keys explicitly, which is exactly
// what `punycode/shape.mjs` does and says it does.
export { TextDecoder, TextEncoder } from "../../../web-platform/src/core/encoding.ts";
export { MIMEParams, MIMEType } from "./mime.ts";
export type {
  ParseArgsConfig,
  ParseArgsOptionDescriptor,
  ParseArgsOptionsConfig,
  ParseArgsOptionsType,
} from "./parse-args.ts";
export type { InspectOptions };

// Keep the imported implementation as the exported function value. A
// forwarding wrapper would add a call on every assertion solely to give the
// re-export a local declaration.
export const isDeepStrictEqual = compareDeepStrict;

/** @ntsAbi managed */
declare function nts_process_env(name: string): string;
/** @ntsAbi managed */
declare function nts_process_signal_names(): string[];
/** @ntsAbi managed */
declare function nts_process_signal_exit_code(signalCode: string): number;

/** Enabled sections of `NODE_DEBUG`, upstream `lib/internal/util/debuglog.js`. */
const enabledSections = (() => {
  const value = nts_process_env("NODE_DEBUG");
  return value.length === 0 ? [] : value.split(",").map((s) => s.trim().toUpperCase());
})();

export function debuglog(
  section: string,
  callback?: (log: (...args: unknown[]) => void) => void,
): (...args: unknown[]) => void {
  // **Lazy, and coercing.** Node's `init()` does
  // `set = StringPrototypeToUpperCase(set)`, which is `toUpperCase` *called on*
  // whatever was passed -- so a number, an object or an empty string all coerce
  // rather than being rejected, and none of it happens until the logger is used.
  //
  // This resolved eagerly and called `section.toUpperCase()` directly, so
  // `debuglog(1)` threw `TypeError` where node answers a logger. Three of the eight
  // argument shapes a corpus generates hit that.
  let enabled: boolean | undefined;
  let announced = false;
  const resolveEnabled = (): boolean => {
    if (enabled === undefined) {
      // `toUpperCase.call(section)`, not `String(section).toUpperCase()`. Node's is
      // the primordial called *on* the value, so coercion goes through `this`: a
      // number and an object become strings, and `null` or `undefined` raise
      // `TypeError` rather than becoming "null" and "undefined". `String()` would
      // have accepted both, which is the mirror of the bug being fixed -- the first
      // attempt at this swapped one over-strict answer for one over-permissive one.
      enabled = enabledSections.includes(
        String.prototype.toUpperCase.call(section as unknown as string),
      );
    }
    return enabled;
  };

  const log = (...args: unknown[]): void => {
    if (!resolveEnabled()) return;
    // **The callback runs here, not at `debuglog(...)`.** Node invokes it from
    // inside the first real log call and only when it is a function, so a *disabled*
    // section never calls it at all -- `logger` returns early on `enabled === false`
    // and the callback is unreachable. Calling it eagerly, as this did, runs a
    // caller's side effect that upstream never runs.
    if (!announced) {
      announced = true;
      if (typeof callback === "function") callback(log);
    }
    // Node prefixes with the section and the pid, which is what makes interleaved
    // output from several processes readable.
    nts_debug_write(
      `${String.prototype.toUpperCase.call(section as unknown as string)} ${nts_process_pid()}: ${format(...args)}\n`,
    );
  };

  // `enabled`, which node publishes on the returned logger as an enumerable
  // configurable getter. It was absent here, so `debuglog("x").enabled` answered
  // `undefined` where node answers `false` -- and code that branches on it, which is
  // the reason node exposes it, took the wrong branch for a truthiness test only by
  // luck: `undefined` is falsy, so a disabled section behaved correctly and an
  // enabled one would not have.
  //
  // A getter rather than a value because node's is one, and because the resolution
  // behind it is deferred: reading `enabled` is what forces the coercion above, and
  // is where a `Symbol` section raises the `TypeError` node raises there too.
  Object.defineProperty(log, "enabled", {
    get(): boolean {
      return resolveEnabled();
    },
    configurable: true,
    enumerable: true,
  });
  return log;
}

/** Legacy name; Node exposes the same function value, not a wrapper. */
export const debug = debuglog;

const processSignalNames: readonly string[] = nts_process_signal_names();

/** POSIX exit status for a process terminated by a named signal. */
export function convertProcessSignalToExitCode(signalCode: string): number;
export function convertProcessSignalToExitCode(signalCode: unknown): number {
  const exitCode = typeof signalCode === "string"
    ? nts_process_signal_exit_code(signalCode)
    : 0;
  if (exitCode === 0) {
    validateOneOf(signalCode, "signalCode", processSignalNames);
  }
  return exitCode;
}

export type DiffEntry = [operation: -1 | 0 | 1, value: string];
type DiffInput = string | readonly string[];

function validateDiffInput(
  value: unknown,
  name: "actual" | "expected",
): asserts value is DiffInput {
  if (Array.isArray(value)) {
    validateStringArray(value, name);
  } else {
    validateString(value, name);
  }
}

/** The shortest insertion/deletion script from `actual` to `expected`. */
export function diff(actual: DiffInput, expected: DiffInput): DiffEntry[];
export function diff(actual: unknown, expected: unknown): DiffEntry[] {
  if (actual === expected) return [];
  validateDiffInput(actual, "actual");
  validateDiffInput(expected, "expected");
  return myersDiff(actual, expected).reverse();
}

/** @ntsAbi managed */
declare function nts_debug_write(text: string): number;
/** @ntsAbi managed */
declare function nts_process_pid(): number;

/**
 * Every ANSI escape sequence in one regular expression, upstream
 * `lib/internal/util/inspect.js`, which took it from chalk's `ansi-regex`.
 *
 * Two alternatives: an OSC sequence, which carries a payload and ends with one
 * of three string terminators (BEL, ESC-backslash, or the 8-bit ST); and a CSI
 * sequence, which is numeric parameters and a single final byte. Both may be
 * introduced by the 7-bit ESC form or the 8-bit single byte.
 */
const ansiPattern = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*" +
  "(?:(?:(?:(?:;[-a-zA-Z\\d\\/\\#&.:=?%@~_]+)*" +
  "|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/\\#&.:=?%@~_]*)*)?" +
  "(?:\\u0007|\\u001B\\u005C|\\u009C))" +
  "|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?" +
  "[\\dA-PR-TZcf-nq-uy=><~]))",
  "g",
);

/** ANSI escape sequences removed, upstream `lib/internal/util.js`. */
/**
 * A promise that settles when `signal` aborts, node's `util.aborted`.
 *
 * `resource` exists so the listener can be dropped once nothing else refers to
 * the resource the wait belongs to. Node registers it as a weak handler for
 * that purpose; this registration is an ordinary one, so a caller that drops
 * its resource and never aborts keeps a listener on the signal. The difference
 * is observable only under a collection, and is recorded in the conformance
 * ledger rather than papered over.
 */
export async function aborted(signal: AbortSignalLike, resource: object): Promise<void> {
  // Deliberately stricter than `validateAbortSignal`, which permits
  // `undefined` because its callers take an optional signal. Here the signal
  // is the subject, so absence is a type error like any other.
  if (
    signal === null ||
    typeof signal !== "object" ||
    !("aborted" in signal) ||
    typeof signal.addEventListener !== "function"
  ) {
    throw new ERR_INVALID_ARG_TYPE("signal", "AbortSignal", signal);
  }
  validateObject(resource, "resource");
  if (signal.aborted) return;
  const settled = Promise.withResolvers<void>();
  // Node holds this listener weakly against `resource`, so that collecting the
  // resource retires the listener and a later abort leaves the promise pending
  // forever. A wait keyed to something already dead must stop keeping the
  // signal alive.
  //
  // The canonical `EventTarget` is the only one that can offer that, since the
  // registration reaches its own internals. A signal from elsewhere -- which is
  // what a test gets today, because this profile does not install the canonical
  // abort globals -- takes the ordinary registration and keeps the resource
  // alive. That is a weaker guarantee, not a different API: nothing observable
  // differs until the resource is collected, which is exactly the case the
  // ordinary listener cannot serve.
  //
  // Deliberately not closing over `resource` here. A callback that captured it
  // would defeat the weakness at the closure rather than at the registration,
  // and the failure would look like the seam's.
  if (signal instanceof WebEventTarget) {
    addWeaklyHeldEventListener(signal, "abort", () => settled.resolve(), resource, {
      once: true,
    });
  } else {
    signal.addEventListener("abort", () => settled.resolve(), { once: true });
  }
  await settled.promise;
}

export function stripVTControlCharacters(str: string): string {
  validateString(str, "str");

  // Every sequence starts with one of the two introducers. Without either
  // there is nothing to strip, and the scan is much cheaper than the match.
  if (!str.includes("\u001b") && !str.includes("\u009b")) {
    return str;
  }

  return str.replace(ansiPattern, "");
}

/** Lone surrogates replaced, upstream `lib/util.js`. */
export function toUSVString(str: string): string {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += str.slice(i, i + 2);
        i++;
        continue;
      }
      out += "�";
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) {
      out += "�";
      continue;
    }
    out += str[i];
  }
  return out;
}

/**
 * A callback-taking function as a promise-returning one, upstream
 * `lib/internal/util.js`.
 *
 * The callback is appended after the caller's arguments and settles one
 * promise, preserving the original receiver.
 */
type ResultCallback<Result, Failure = unknown> = (
  error: Failure,
  value: Result,
) => void;

type NoResultCallback<Failure = unknown> = (error?: Failure) => void;

/**
 * **`util.promisify.custom`, and the branch that reads it.**
 *
 * node lets a function declare its own promisified form:
 *
 *     fn[util.promisify.custom] = () => Promise.resolve("mine");
 *     util.promisify(fn)()  ->  "mine"
 *
 * `lib/internal/util.js` checks that property first and returns it, and it validates that what it
 * finds is a function -- `ERR_INVALID_ARG_TYPE` on `util.promisify.custom` otherwise. `fs` and
 * `child_process` both use it upstream, so a caller promisifying `fs.exists` gets node's
 * single-argument form rather than an `(err, value)` misreading.
 *
 * The symbol is registered, not private: `Symbol.for("nodejs.util.promisify.custom")`. Two copies
 * of the machinery in one process must agree on it, which is the same reason `stream`'s branding
 * symbols are registered.
 *
 * This profile had neither the symbol nor the branch. `surface-absence.mjs` listed
 * `util.promisify.custom` among nine missing names; what it could not say is that the behaviour
 * behind it was missing too.
 */
const kCustomPromisify: symbol = Symbol.for("nodejs.util.promisify.custom");

export function promisify<
  This,
  Args extends unknown[],
  Result,
  Failure = unknown,
>(
  original: (
    this: This,
    ...args: [...Args, callback: ResultCallback<Result, Failure>]
  ) => unknown,
): (this: This, ...args: Args) => Promise<Result>;
export function promisify<
  This,
  Args extends unknown[],
  Failure = unknown,
>(
  original: (
    this: This,
    ...args: [...Args, callback: NoResultCallback<Failure>]
  ) => unknown,
): (this: This, ...args: Args) => Promise<void>;
export function promisify(
  original: unknown,
): CallableFunction {
  validateFunction(original, "original");
  const callable = original;

  const declared = (original as unknown as Record<PropertyKey, unknown>)[kCustomPromisify];
  if (declared !== undefined && declared !== null) {
    if (typeof declared !== "function") {
      throw new ERR_INVALID_ARG_TYPE("util.promisify.custom", "Function", declared);
    }
    return declared as CallableFunction;
  }

  function promisified(this: unknown, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      // Node's callbacks are `(err, value)`, so the promise settles on the
      // first argument and resolves with the second.
      callable.call(
        this,
        ...args,
        (err: unknown, value: unknown) => {
          if (err) {
            reject(err);
          } else {
            resolve(value);
          }
        },
      );
    });
  }

  return promisified;
}

// node hangs the symbol off the function itself, which is how callers reach it.
(promisify as unknown as Record<PropertyKey, unknown>)["custom"] = kCustomPromisify;

/**
 * `util.inherits`, upstream `lib/util.js`. Sets the prototype chain and records `super_`,
 * which is writable and configurable there and is relied on by pre-class code in the wild.
 */
export function inherits(ctor: unknown, superCtor: unknown): void {
  if (ctor === undefined || ctor === null) {
    throw new ERR_INVALID_ARG_TYPE("ctor", "Function", ctor);
  }
  if (superCtor === undefined || superCtor === null) {
    throw new ERR_INVALID_ARG_TYPE("superCtor", "Function", superCtor);
  }
  const parent = superCtor as { prototype?: unknown };
  if (parent.prototype === undefined) {
    throw new ERR_INVALID_ARG_TYPE("superCtor.prototype", "Object", parent.prototype);
  }
  Object.defineProperty(ctor, "super_", {
    value: superCtor,
    writable: true,
    configurable: true,
  });
  Object.setPrototypeOf(
    (ctor as { prototype: object }).prototype,
    parent.prototype as object,
  );
}

/**
 * `util._extend`, deprecated upstream since v6 and still published. A shallow copy of own
 * enumerable string keys, which returns `target` untouched when `source` is not an object --
 * including for `null`, where `Object.assign` would also do nothing but `Object.keys` would throw.
 */
function extendImplementation(target: unknown, source: unknown): unknown {
  if (source === null || typeof source !== "object") return target;
  const into = target as Record<string, unknown>;
  const from = source as Record<string, unknown>;
  for (const key of Object.keys(from)) into[key] = from[key];
  return target;
}

/**
 * **Wrapped, because `util._extend.name` is `"deprecated"` in node and that is observable.**
 *
 * `lib/util.js` publishes it as `internalDeprecate(_extend, ..., 'DEP0060')`, so the exported
 * function is `deprecate`'s wrapper rather than the implementation. `export-surface-static.js`
 * compares each name and caught this the moment the export appeared -- the behaviour was right
 * and the identity was not.
 */
export const _extend: (target: unknown, source: unknown) => unknown = deprecate(
  extendImplementation,
  "The `util._extend` API is deprecated. Please use Object.assign() instead.",
  "DEP0060",
) as (target: unknown, source: unknown) => unknown;

/** The inverse of `promisify`, upstream `lib/internal/util.js`. */
/**
 * A rejection reason, made safe to pass as a callback's first argument.
 *
 * `!reason` rather than `reason === null`: a callback consumer tests
 * `if (err)`, so any falsy rejection would read as success. The original is
 * kept on `.reason`.
 */
function callbackifyOnRejected(reason: unknown, cb: (err: unknown) => void): void {
  if (!reason) {
    const wrapped = new ERR_FALSY_VALUE_REJECTION(reason);
    // Without this the stack would start inside `callbackify`, which is not
    // where anything went wrong.
    captureStackTrace(wrapped, callbackifyOnRejected);
    cb(wrapped);
    return;
  }
  cb(reason);
}

/**
 * A promise-returning function, wrapped to take a node-style callback.
 *
 * The promise is deliberately not returned: handing it back would suggest the
 * callback's outcome is related to it, and a throw from the callback would
 * then reject a promise nobody is watching. The callback runs on the next tick
 * for the same reason node's own do -- a throw from it reaches
 * `uncaughtException` rather than the promise machinery.
 */
export function callbackify<This, Args extends unknown[]>(
  original: (this: This, ...args: Args) => PromiseLike<void>,
): (
  this: This,
  ...args: [...Args, callback: NoResultCallback]
) => void;
export function callbackify<This, Args extends unknown[], Result>(
  original: (this: This, ...args: Args) => PromiseLike<Result>,
): (
  this: This,
  ...args: [...Args, callback: ResultCallback<Result>]
) => void;
export function callbackify(
  original: (this: unknown, ...args: unknown[]) => PromiseLike<unknown>,
): (...args: unknown[]) => void {
  validateFunction(original, "original");

  function callbackified(this: unknown, ...args: unknown[]): void {
    const maybeCb = args.pop();
    validateFunction(maybeCb, "last argument");
    const cb = maybeCb.bind(this);
    original.call(this, ...args).then(
      (ret: unknown) => nextTick(cb, null, ret),
      (rej: unknown) => nextTick(callbackifyOnRejected, rej, cb),
    );
  }

  return callbackified;
}


/**
 * `util.isArray`, deprecated as `DEP0044`.
 *
 * Node wraps this in `deprecate`, so calling it emits a `DeprecationWarning`
 * once per process. We exported `Array.isArray` bare, which meant the warning
 * never fired -- a behavioural difference, not a cosmetic one, and invisible
 * upstream because node ships no test that calls a deprecated `util` API and
 * asserts the warning.
 *
 * It surfaced as a *name*: `test/export-surface-static.js` compares each
 * function's `name` against node's, and node's is `"deprecated"` because that
 * is what the wrapper is called. The name was the symptom; the missing warning
 * was the defect.
 *
 * The type is no longer a guard, and that is not a weakening: node's wrapped
 * `util.isArray` returns a boolean and narrows nothing, so a guard here would
 * be claiming something the module it mirrors does not do. Everything inside
 * this file that needs narrowing uses `Array.isArray` directly.
 */
export const isArray: (value: unknown) => boolean = deprecate(
  (value: unknown): boolean => Array.isArray(value),
  "The `util.isArray` API is deprecated. Please use `Array.isArray()` instead.",
  "DEP0044",
);

export default {
  inspect,
  format,
  formatWithOptions,
  isDeepStrictEqual,
  types,
  deprecate,
  debug,
  debuglog,
  convertProcessSignalToExitCode,
  diff,
  parseArgs,
  stripVTControlCharacters,
  toUSVString,
  promisify,
  inherits,
  _extend,
  callbackify,
  isArray,
};


/**
 * `util.inspect.colors`, re-exported. Known names are fixed-layout fields, and
 * assigning one remains visible to both `styleText` and colored inspection.
 * Adding arbitrary names would require the §13 property map NTS omits.
 */
export const colors = inspectColors;
/** Internal handoff to `shape.mjs`; removed from the public module there. */
export const styles = inspectStyles;

/**
 * Turn this style back on wherever the inner text turned it off, upstream
 * `lib/util.js:178`.
 *
 * `red("A" + blue("B") + "C")` must leave C red, and the blue's reset would
 * otherwise leave it plain. Two details make it more than a `replaceAll`:
 *
 * A reset at the very *end* is left alone. The wrapper's own close follows it
 * immediately, so reinstating the colour there would emit a code that is
 * turned off three characters later.
 *
 * And `keepClose` keeps the reset as well as re-opening. `dim` and `bold`
 * share the close code 22, so a `bold` inside a `dim` has to close the bold
 * *and* restore the dim; dropping the close would leave the text bold.
 */
function replaceCloseCode(
  str: string,
  closeSeq: string,
  openSeq: string,
  keepClose: boolean,
): string {
  let index = str.indexOf(closeSeq);
  if (index === -1) {
    return str;
  }
  const replacement = keepClose ? closeSeq + openSeq : openSeq;
  let result = "";
  let lastIndex = 0;
  do {
    const afterClose = index + closeSeq.length;
    if (afterClose >= str.length) {
      break;
    }
    result += str.slice(lastIndex, index) + replacement;
    lastIndex = afterClose;
    index = str.indexOf(closeSeq, lastIndex);
  } while (index !== -1);
  return result + str.slice(lastIndex);
}

const kBoldCode = 1;
const kDimCode = 2;

/**
 * `util.styleText`, upstream `lib/util.js`.
 *
 * An array of styles is applied in one pass rather than by recursing, because
 * each style's close has to be inserted into text that already carries the
 * previous ones.
 */
const kEscape = "\u001b[";
const kEscapeEnd = "m";
/** The close sequence for a 24-bit foreground colour: back to the default. */
const kHexCloseSeq = `${kEscape}39${kEscapeEnd}`;
const hexColorPattern = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

interface Style {
  openSeq: string;
  closeSeq: string;
  /**
   * Whether the close code has to be re-emitted before reopening.
   *
   * Bold and dim share the close code 22, so turning one off inside the other
   * turns both off; the only way back is to close and reopen. Every other
   * style closes to its own default and can simply be reopened.
   */
  keepClose: boolean;
}

function codesToStyle(codes: [number, number]): Style {
  const openNum = codes[0];
  return {
    openSeq: `${kEscape}${openNum}${kEscapeEnd}`,
    closeSeq: `${kEscape}${codes[1]}${kEscapeEnd}`,
    keepClose: openNum === kDimCode || openNum === kBoldCode,
  };
}

/** `#abc` and `#aabbcc` both mean the same colour. */
function hexToRgb(hex: string): [number, number, number] {
  let digits: string;
  if (hex.length === 4) {
    digits = `${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  } else if (hex.length === 7) {
    digits = hex.slice(1);
  } else {
    throw new ERR_OUT_OF_RANGE("hex", "#RGB or #RRGGBB", hex);
  }
  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ];
}

/** ANSI TrueColor: a foreground colour given as three bytes. */
function rgbToAnsi24Bit(r: number, g: number, b: number): string {
  return `38;2;${r};${g};${b}`;
}

/**
 * `text` wrapped in the ANSI codes for `format`, upstream `lib/util.js`.
 *
 * Two things make it more than a concatenation. Nesting: a style inside
 * another has to reopen the outer one where it closed, or the rest of the
 * outer text loses its colour -- that is what `replaceCloseCode` does. And the
 * destination: writing colour to a redirected file stores escape sequences as
 * garbage, so unless the caller opts out the stream is checked first and the
 * text comes back unchanged when it is not a terminal.
 */
export function styleText(
  format: string | readonly string[],
  text: string,
  options?: { validateStream?: boolean; stream?: unknown },
): string {
  const validateStream = options?.validateStream ?? true;

  // Upstream's common path: no stream query, no temporary format array, and
  // one fixed-layout color lookup.
  if (!validateStream && typeof format === "string" && typeof text === "string") {
    if (format === "none") return text;
    const color = inspectColorCodes(format);
    if (color !== undefined) {
      const { openSeq, closeSeq, keepClose } = codesToStyle(color);
      const processed = replaceCloseCode(text, closeSeq, openSeq, keepClose);
      return openSeq + processed + closeSeq;
    }
    if (format[0] === "#" && hexColorPattern.test(format)) {
      const [r, g, b] = hexToRgb(format);
      const openSeq = kEscape + rgbToAnsi24Bit(r, g, b) + kEscapeEnd;
      const processed = replaceCloseCode(text, kHexCloseSeq, openSeq, false);
      return openSeq + processed + kHexCloseSeq;
    }
  }

  validateString(text, "text");
  if (options !== undefined) {
    validateObject(options, "options");
  }
  validateBoolean(validateStream, "options.validateStream");

  let skipColorize = false;
  if (validateStream) {
    const stream = options?.stream ?? stdout;
    if (!isReadableStream(stream) && !isWritableStream(stream) && !isNodeStream(stream)) {
      throw new ERR_INVALID_ARG_TYPE(
        "stream",
        ["ReadableStream", "WritableStream", "Stream"],
        stream,
      );
    }
    if (stream === null || typeof stream !== "object") {
      throw new ERR_INVALID_ARG_TYPE("stream", "Object", stream);
    }
    skipColorize = !shouldColorize(stream);
  }

  const allowedFormats = inspectColorNames;
  let formats: readonly unknown[];
  if (typeof format === "string") {
    formats = [format];
  } else if (Array.isArray(format)) {
    formats = format;
  } else {
    validateOneOf(format, "format", allowedFormats);
    return text;
  }

  let openCodes = "";
  let closeCodes = "";
  let processed = text;

  for (const key of formats) {
    if (key === "none") {
      continue;
    }

    if (typeof key === "string" && key[0] === "#") {
      if (!hexColorPattern.test(key)) {
        throw new ERR_INVALID_ARG_VALUE("format", key, "must be a valid hex color (#RGB or #RRGGBB)");
      }
      // Validated even when the output will not be coloured, so that a typo
      // is reported on a pipe as well as on a terminal.
      if (skipColorize) continue;
      const [r, g, b] = hexToRgb(key);
      const hexOpenSeq = kEscape + rgbToAnsi24Bit(r, g, b) + kEscapeEnd;
      openCodes += hexOpenSeq;
      closeCodes = kHexCloseSeq + closeCodes;
      processed = replaceCloseCode(processed, kHexCloseSeq, hexOpenSeq, false);
      continue;
    }

    const codes = typeof key === "string" ? inspectColorCodes(key) : undefined;
    if (!codes) {
      // Through `validateOneOf` so the message lists what is allowed, and over
      // the same explicit static table used for lookup, so aliases count.
      validateOneOf(key, "format", allowedFormats);
      continue;
    }
    const { openSeq, closeSeq, keepClose } = codesToStyle(codes);
    openCodes += openSeq;
    closeCodes = closeSeq + closeCodes;
    processed = replaceCloseCode(processed, closeSeq, openSeq, keepClose);
  }

  if (skipColorize) return text;

  return openCodes + processed + closeCodes;
}

/**
 * `util.parseEnv`, upstream `lib/util.js`: the contents of a `.env` file.
 * `KEY=value` a line, `#` a comment, quotes optional and stripped when present.
 */
export function parseEnv(content: string): Record<string, string> {
  if (typeof content !== "string") {
    throw new ERR_INVALID_ARG_TYPE("content", "string", content);
  }

  const source = content.replaceAll("\r", "");
  const out: Record<string, string> = {};
  let position = 0;
  while (position < source.length) {
    const newline = source.indexOf("\n", position);
    const lineEnd = newline === -1 ? source.length : newline;
    const rawLine = source.slice(position, lineEnd);
    const trimmedLine = rawLine.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) {
      position = newline === -1 ? source.length : newline + 1;
      continue;
    }

    const equals = source.indexOf("=", position);
    if (equals === -1 || equals > lineEnd) {
      position = newline === -1 ? source.length : newline + 1;
      continue;
    }

    let key = source.slice(position, equals).trim();
    if (key.startsWith("export ")) {
      key = key.slice(7).trim();
    }
    if (key.length === 0) {
      position = newline === -1 ? source.length : newline + 1;
      continue;
    }

    let valueStart = equals + 1;
    while (valueStart < lineEnd) {
      const code = source.charCodeAt(valueStart);
      if (code !== 32 && code !== 9) break;
      valueStart++;
    }
    if (valueStart >= lineEnd) {
      out[key] = "";
      position = newline === -1 ? source.length : newline + 1;
      continue;
    }

    const quote = source.charAt(valueStart);
    if (quote === "'" || quote === '"' || quote === "`") {
      const closingQuote = source.indexOf(quote, valueStart + 1);
      if (closingQuote === -1) {
        out[key] = source.slice(valueStart, lineEnd);
        position = newline === -1 ? source.length : newline + 1;
        continue;
      }

      let value = source.slice(valueStart + 1, closingQuote);
      if (quote === '"') {
        value = value.replaceAll("\\n", "\n");
      }
      out[key] = value;
      const closingLineEnd = source.indexOf("\n", closingQuote + 1);
      position = closingLineEnd === -1 ? source.length : closingLineEnd + 1;
      continue;
    }

    let value = source.slice(valueStart, lineEnd);
    const comment = value.indexOf("#");
    if (comment !== -1) {
      value = value.slice(0, comment);
    }
    out[key] = value.trim();
    position = newline === -1 ? source.length : newline + 1;
  }
  return out;
}

/** @ntsAbi managed */
declare function nts_uv_err_name(code: number): string;

/** Fixed-layout form of the properties Node exposes on system errors. */
class ErrnoException extends Error {
  code: string;
  errno: number;
  syscall: string;
  address?: string | null;
  /**
   * `declare`, because a declared class field **is** an own key.
   *
   * `_exceptionWithHostPort` already guarded this the way node does -- node's
   * `ExceptionWithHostPort` assigns `address` unconditionally and wraps the port
   * in `if (port)` -- and the guard was doing nothing, because
   * `useDefineForClassFields` emits a definition for a bare `port?: number;` and
   * the key existed holding `undefined` before the constructor ran. So
   * `Object.keys` answered `address,code,errno,port,syscall` for a port of 0 where
   * node answers without it, and `"port" in error` was `true` where node says
   * `false`. `declare` emits nothing and leaves the guard as the only thing that
   * creates the key.
   *
   * `address` stays a real field: node assigns it unconditionally too, and an
   * explicit `null` there is meaningful to a caller reporting what it tried.
   */
  declare port?: number;

  constructor(message: string, code: string, errno: number, syscall: string) {
    super(message);
    this.code = code;
    this.errno = errno;
    this.syscall = syscall;
  }
}

/** `util._exceptionWithHostPort`, upstream `lib/internal/errors.js`. */
/**
 * The error shape a failed socket operation produces, node
 * `lib/internal/errors.js`'s `ExceptionWithHostPort`.
 *
 * `connect ECONNREFUSED 127.0.0.1:8080`, with `errno`, `code`, `syscall`,
 * `address` and `port` attached so that a caller can branch on the parts
 * rather than parse the message. `additional` names the local end when the
 * failure had one, which is what tells two connections to the same peer apart.
 */
export function _exceptionWithHostPort(
  err: number,
  syscall: string,
  address?: string | null,
  port?: number,
  additional?: string,
): Error {
  const code = getSystemErrorName(err);
  let details = "";
  if (port && port > 0) {
    details = ` ${address}:${port}`;
  } else if (address) {
    details = ` ${address}`;
  }
  if (additional) {
    details += ` - Local (${additional})`;
  }

  const ex = new ErrnoException(`${syscall} ${code}${details}`, code, err, syscall);
  // Set even when null: a caller reads `address` to report what it tried, and
  // an absent property and an explicit `null` mean different things.
  ex.address = address;
  if (port) {
    ex.port = port;
  }
  // The frames start at the caller: this function is not where the failure is.
  captureStackTrace(ex, _exceptionWithHostPort);
  return ex;
}

/** `util._errnoException`, upstream `lib/internal/errors.js`. */
export function _errnoException(err: number, syscall: string, original?: string): Error {
  validateSystemErrorCode(err);
  const code = nts_uv_err_name(err);
  const message = original ? `${syscall} ${code} ${original}` : `${syscall} ${code}`;
  return new ErrnoException(message, code, err, syscall);
}

/** @ntsAbi managed */
declare function nts_uv_err_message(code: number): string;
/** @ntsAbi managed */
declare function nts_uv_error_codes(): number[];
/** @ntsAbi managed */
declare function nts_uv_error_names(): string[];

/**
 * libuv's error names and messages, upstream `lib/util.js`.
 *
 * From libuv rather than a table written here, for the reason `os.constants`
 * is: the numbers are the platform's.
 */
function validateSystemErrorCode(err: number): void {
  validateNumber(err, "err");
  if (err >= 0 || !Number.isSafeInteger(err)) {
    throw new ERR_OUT_OF_RANGE("err", "a negative integer", err);
  }
}

export function getSystemErrorName(err: number): string {
  validateSystemErrorCode(err);
  return nts_uv_err_name(err);
}

export function getSystemErrorMessage(err: number): string {
  validateSystemErrorCode(err);
  return nts_uv_err_message(err);
}

export function getSystemErrorMap(): Map<number, [string, string]> {
  const codes = nts_uv_error_codes();
  const names = nts_uv_error_names();
  const map = new Map<number, [string, string]>();
  const length = Math.min(codes.length, names.length);
  for (let i = 0; i < length; i++) {
    const code = codes[i];
    const name = names[i];
    if (code !== undefined && name !== undefined) {
      map.set(code, [name, nts_uv_err_message(code)]);
    }
  }
  return map;
}
