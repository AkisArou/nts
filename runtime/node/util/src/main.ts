// `node:util`, from node v24.20.0 `lib/util.js`.
//
// The parts that stand on their own: `inspect` and `format` (what
// `console.log` is built from), `types`, `isDeepStrictEqual` (what
// `assert.deepStrictEqual` compares with), and the small helpers around them.

import { inspect, inspectDefaultOptions, type InspectOptions } from "./inspect.ts";
import { format, formatWithOptions } from "./format.ts";
import { isDeepStrictEqual } from "./deep-equal.ts";
import * as types from "./types.ts";
import { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE } from "../../internal/errors.ts";
import { validateFunction } from "../../internal/validators.ts";

export { inspect, inspectDefaultOptions, format, formatWithOptions, isDeepStrictEqual, types };
export type { InspectOptions };

declare function nts_process_emit_warning(
  message: string,
  name: string,
  code: string,
): void;
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

/**
 * Wrap `fn` so that calling it warns once, upstream `lib/internal/util.js`.
 *
 * Once, not every call: a deprecation that prints on every invocation of a
 * function in a loop is noise that hides everything else.
 */
export function deprecate<T extends (...args: never[]) => unknown>(
  fn: T,
  message: string,
  code?: string,
): T {
  if (code !== undefined && typeof code !== "string") {
    throw new ERR_INVALID_ARG_TYPE("code", "string", code);
  }
  let warned = false;
  const deprecated = function (this: unknown, ...args: never[]): unknown {
    if (!warned) {
      warned = true;
      nts_process_emit_warning(message, "DeprecationWarning", code ?? "");
    }
    return Reflect.apply(fn, this, args);
  };
  Object.defineProperty(deprecated, "name", { value: fn.name });
  return deprecated as unknown as T;
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

/** ANSI escape sequences removed, upstream `lib/internal/util.js`. */
export function stripVTControlCharacters(str: string): string {
  if (typeof str !== "string") {
    throw new ERR_INVALID_ARG_TYPE("str", "string", str);
  }
  let out = "";
  let i = 0;
  while (i < str.length) {
    if (str.charCodeAt(i) === 0x1b) {
      // CSI: ESC [ ... final-byte, or a two-character escape.
      if (str[i + 1] === "[") {
        let j = i + 2;
        while (j < str.length && !/[@-~]/.test(str[j]!)) j++;
        i = j + 1;
        continue;
      }
      if (str[i + 1] === "]") {
        // OSC: ends at BEL or ST.
        let j = i + 2;
        while (j < str.length && str.charCodeAt(j) !== 7 && !(str[j] === "\x1b" && str[j + 1] === "\\")) j++;
        i = str[j] === "\x1b" ? j + 2 : j + 1;
        continue;
      }
      i += 2;
      continue;
    }
    out += str[i];
    i++;
  }
  return out;
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
export function callbackify(
  original: (...args: never[]) => Promise<unknown>,
): (...args: unknown[]) => void {
  validateFunction(original, "original");

  function callbackified(this: unknown, ...args: unknown[]): void {
    const callback = args.pop() as (err: unknown, value?: unknown) => void;
    validateFunction(callback, "last argument");
    Reflect.apply(original, this, args as never[]).then(
      (value: unknown) => callback(null, value),
      // A falsy rejection reason would look like success to a callback that
      // tests `if (err)`, so node wraps it.
      (reason: unknown) => callback(reason || wrapFalsyReason(reason)),
    );
  }

  Object.setPrototypeOf(callbackified, Object.getPrototypeOf(original));
  return callbackified;
}

function wrapFalsyReason(reason: unknown): Error {
  const err = new Error("Promise was rejected with a falsy value") as Error & { reason?: unknown };
  err.reason = reason;
  return err;
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
 * ANSI codes by name, upstream `lib/internal/util/colors.js`. Each is the pair
 * that turns the style on and off -- `[31, 39]` for red -- because a nested
 * style has to restore the outer one rather than reset everything.
 */
export const colors: Record<string, [number, number]> = {
  reset: [0, 0], bold: [1, 22], dim: [2, 22], italic: [3, 23], underline: [4, 24],
  blink: [5, 25], inverse: [7, 27], hidden: [8, 28], strikethrough: [9, 29],
  doubleunderline: [21, 24],
  black: [30, 39], red: [31, 39], green: [32, 39], yellow: [33, 39],
  blue: [34, 39], magenta: [35, 39], cyan: [36, 39], white: [37, 39],
  bgBlack: [40, 49], bgRed: [41, 49], bgGreen: [42, 49], bgYellow: [43, 49],
  bgBlue: [44, 49], bgMagenta: [45, 49], bgCyan: [46, 49], bgWhite: [47, 49],
  framed: [51, 54], overlined: [53, 55],
  gray: [90, 39], grey: [90, 39],
  redBright: [91, 39], greenBright: [92, 39], yellowBright: [93, 39],
  blueBright: [94, 39], magentaBright: [95, 39], cyanBright: [96, 39],
  whiteBright: [97, 39],
  bgGray: [100, 49], bgGrey: [100, 49],
  bgRedBright: [101, 49], bgGreenBright: [102, 49], bgYellowBright: [103, 49],
  bgBlueBright: [104, 49], bgMagentaBright: [105, 49], bgCyanBright: [106, 49],
  bgWhiteBright: [107, 49],
};

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
export function styleText(
  format: string | string[],
  text: string,
  options?: { validateStream?: boolean; stream?: unknown },
): string {
  if (typeof text !== "string") {
    throw new ERR_INVALID_ARG_TYPE("text", "string", text);
  }
  void options;

  const formats = Array.isArray(format) ? format : [format];
  const ESC = "\u001b[";
  let openCodes = "";
  let closeCodes = "";
  let processed = text;

  for (const key of formats) {
    if (key === "none") {
      continue;
    }
    const pair = colors[key];
    if (pair === undefined) {
      throw new ERR_INVALID_ARG_VALUE("format", key, "must be one of the supported styles");
    }
    const openSeq = `${ESC}${pair[0]}m`;
    const closeSeq = `${ESC}${pair[1]}m`;
    openCodes += openSeq;
    closeCodes = closeSeq + closeCodes;
    processed = replaceCloseCode(
      processed,
      closeSeq,
      openSeq,
      pair[0] === kDimCode || pair[0] === kBoldCode,
    );
  }

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
export function _exceptionWithHostPort(
  err: number,
  syscall: string,
  address?: string,
  port?: number,
): Error {
  let details = "";
  if (port !== undefined && port > 0) {
    details = ` ${address}:${port}`;
  } else if (address !== undefined) {
    details = ` ${address}`;
  }
  const code = nts_uv_err_name(err);
  const ex = new Error(`${syscall} ${code}${details}`) as Error & Record<string, unknown>;
  ex["code"] = code;
  ex["errno"] = err;
  ex["syscall"] = syscall;
  if (address !== undefined) ex["address"] = address;
  if (port !== undefined && port > 0) ex["port"] = port;
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
