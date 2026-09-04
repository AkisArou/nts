// `node:util`, from node v24.20.0 `lib/util.js`.
//
// The parts that stand on their own: `inspect` and `format` (what
// `console.log` is built from), `types`, `isDeepStrictEqual` (what
// `assert.deepStrictEqual` compares with), and the small helpers around them.

import { inspect, inspectColors, inspectDefaultOptions, type InspectOptions } from "./inspect.ts";
import { format, formatWithOptions } from "./format.ts";
import { isDeepStrictEqual } from "./deep-equal.ts";
import * as types from "./types.ts";
import {
  captureStackTrace,
  ERR_FALSY_VALUE_REJECTION, ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE, ERR_OUT_OF_RANGE,
} from "../../internal/errors.ts";
import { nextTick } from "../../internal/tick.ts";
import { deprecate } from "../../internal/deprecate.ts";
import {
  validateBoolean, validateFunction, validateObject, validateOneOf, validateString,
} from "../../internal/validators.ts";
import { isNodeStream, isReadableStream, isWritableStream } from "../../internal/streams/utils.ts";
import { shouldColorize } from "../../internal/colors.ts";
import { stdout } from "../../internal/stdio.ts";

export { inspect, inspectDefaultOptions, format, formatWithOptions, isDeepStrictEqual, types };
export { deprecate };
export type { InspectOptions };

declare function nts_process_env(name: string): string;

/**
 * ES5 prototype inheritance, upstream `lib/util.js`.
 *
 * Predates `class` and is still exported because a great deal of code uses it.
 * Node sets `super_` as well, which subclasses read to reach the base.
 */
export function inherits(ctor: Function, superCtor: Function): void {
  if (ctor === undefined || ctor === null) {
    throw new ERR_INVALID_ARG_TYPE("ctor", "Function", ctor);
  }
  if (superCtor === undefined || superCtor === null) {
    throw new ERR_INVALID_ARG_TYPE("superCtor", "Function", superCtor);
  }
  if (superCtor.prototype === undefined) {
    throw new ERR_INVALID_ARG_TYPE("superCtor.prototype", "Object", superCtor.prototype);
  }
  Object.defineProperty(ctor, "super_", {
    value: superCtor,
    writable: true,
    configurable: true,
  });
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

/** Enabled sections of `NODE_DEBUG`, upstream `lib/internal/util/debuglog.js`. */
const enabledSections = (() => {
  const value = nts_process_env("NODE_DEBUG");
  return value.length === 0 ? [] : value.split(",").map((s) => s.trim().toUpperCase());
})();

export function debuglog(
  section: string,
  callback?: (log: (...args: unknown[]) => void) => void,
): (...args: unknown[]) => void {
  const enabled = enabledSections.includes(section.toUpperCase());
  const log = enabled
    ? (...args: unknown[]): void => {
        // Node prefixes with the section and the pid, which is what makes
        // interleaved output from several processes readable.
        nts_debug_write(`${section.toUpperCase()} ${nts_process_pid()}: ${format(...args)}\n`);
      }
    : (): void => {};
  callback?.(log);
  return log;
}

export function debuglogEnabled(section: string): boolean {
  return enabledSections.includes(section.toUpperCase());
}

declare function nts_debug_write(text: string): void;
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
        out += str[i]! + str[i + 1]!;
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
 * Needs promises, which the runtime does not have yet; the shape is here so it
 * arrives complete rather than as an afterthought.
 */
export const kCustomPromisifiedSymbol = Symbol.for("nodejs.util.promisify.custom");

export function promisify(
  original: (...args: never[]) => unknown,
): (...args: unknown[]) => Promise<unknown> {
  validateFunction(original, "original");

  const custom = (original as unknown as Record<symbol, unknown>)[kCustomPromisifiedSymbol];
  if (custom !== undefined) {
    validateFunction(custom, "util.promisify.custom");
    return custom as (...args: unknown[]) => Promise<unknown>;
  }

  function promisified(this: unknown, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      // Node's callbacks are `(err, value)`, so the promise settles on the
      // first argument and resolves with the second.
      Reflect.apply(original, this, [
        ...args,
        (err: unknown, value: unknown) => {
          if (err) {
            reject(err);
          } else {
            resolve(value);
          }
        },
      ] as never[]);
    });
  }

  Object.setPrototypeOf(promisified, Object.getPrototypeOf(original));
  Object.defineProperty(promisified, kCustomPromisifiedSymbol, {
    value: promisified,
    enumerable: false,
    writable: false,
    configurable: true,
  });
  return promisified;
}

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
    reason = new ERR_FALSY_VALUE_REJECTION(reason);
    // Without this the stack would start inside `callbackify`, which is not
    // where anything went wrong.
    captureStackTrace(reason as object, callbackifyOnRejected);
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
export function callbackify(
  original: (...args: never[]) => Promise<unknown>,
): (...args: unknown[]) => void {
  validateFunction(original, "original");

  function callbackified(this: unknown, ...args: unknown[]): void {
    const maybeCb = args.pop();
    validateFunction(maybeCb, "last argument");
    const cb = (maybeCb as (...a: unknown[]) => void).bind(this);
    Reflect.apply(original, this, args as never[]).then(
      (ret: unknown) => nextTick(cb, null, ret),
      (rej: unknown) => nextTick(callbackifyOnRejected, rej, cb),
    );
  }

  // Copied rather than assigned, so that a function whose `length` or `name`
  // has been redefined keeps whatever it was redefined to -- with the two
  // adjustments the wrapper implies: one more argument, and a longer name.
  const descriptors = Object.getOwnPropertyDescriptors(original);
  if (typeof descriptors["length"]?.value === "number") {
    descriptors["length"].value++;
  }
  if (typeof descriptors["name"]?.value === "string") {
    descriptors["name"].value += "Callbackified";
  }
  Object.defineProperties(callbackified, descriptors);
  return callbackified;
}


export const isArray = Array.isArray;

export function isDeepStrictEqualExport(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(a, b);
}

export default {
  inspect,
  format,
  formatWithOptions,
  isDeepStrictEqual,
  types,
  inherits,
  deprecate,
  debuglog,
  debuglogEnabled,
  stripVTControlCharacters,
  toUSVString,
  promisify,
  callbackify,
  isArray,
};


/**
 * `util.inspect.colors`, re-exported. One table, so that a program that adds a
 * colour can use it both in `styleText` and in a custom `inspect` style.
 */
export const colors: Record<string, [number, number] | undefined> = inspectColors;

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
    skipColorize = !shouldColorize(stream as { isTTY?: boolean });
  }

  const formats = Array.isArray(format) ? format : [format as string];

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

    const codes = colors[key as string];
    if (!codes) {
      // Through `validateOneOf` so the message lists what is allowed, and over
      // `getOwnPropertyNames` so the aliases -- `grey`, `faint` -- count.
      validateOneOf(key, "format", Object.getOwnPropertyNames(colors));
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
  const out: Record<string, string> = Object.create(null);
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const at = line.indexOf("=");
    if (at === -1) {
      continue;
    }
    const key = line.slice(0, at).trim().replace(/^export\s+/, "");
    let value = line.slice(at + 1).trim();
    // A quoted value keeps its spaces and any `#`; an unquoted one stops at a
    // comment.
    const quoted =
      value.length > 1 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith("`") && value.endsWith("`")));
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      const comment = value.indexOf(" #");
      if (comment !== -1) {
        value = value.slice(0, comment).trim();
      }
    }
    out[key] = value;
  }
  return out;
}

declare function nts_uv_err_name(code: number): string;

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

  const ex = new Error(`${syscall} ${code}${details}`) as Error & Record<string, unknown>;
  ex["errno"] = err;
  ex["code"] = code;
  ex["syscall"] = syscall;
  // Set even when null: a caller reads `address` to report what it tried, and
  // an absent property and an explicit `null` mean different things.
  ex["address"] = address;
  if (port) {
    ex["port"] = port;
  }
  // The frames start at the caller: this function is not where the failure is.
  captureStackTrace(ex, _exceptionWithHostPort);
  return ex;
}

/** `util._errnoException`, upstream `lib/internal/errors.js`. */
export function _errnoException(err: number, syscall: string, original?: string): Error {
  const code = nts_uv_err_name(err);
  const ex = new Error(original ? `${syscall} ${code} ${original}` : `${syscall} ${code}`) as
    Error & Record<string, unknown>;
  ex["code"] = code;
  ex["errno"] = err;
  ex["syscall"] = syscall;
  return ex;
}

declare function nts_uv_err_message(code: number): string;
declare function nts_uv_error_codes(): number[];
declare function nts_uv_error_names(): string[];

/**
 * libuv's error names and messages, upstream `lib/util.js`.
 *
 * From libuv rather than a table written here, for the reason `os.constants`
 * is: the numbers are the platform's.
 */
export function getSystemErrorName(err: number): string {
  return nts_uv_err_name(err);
}

export function getSystemErrorMessage(err: number): string {
  return nts_uv_err_message(err);
}

export function getSystemErrorMap(): Map<number, [string, string]> {
  const codes = nts_uv_error_codes();
  const names = nts_uv_error_names();
  const map = new Map<number, [string, string]>();
  for (let i = 0; i < codes.length; i++) {
    map.set(codes[i]!, [names[i]!, nts_uv_err_message(codes[i]!)]);
  }
  return map;
}
