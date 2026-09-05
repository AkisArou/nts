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
import {
  validateBoolean, validateFunction, validateNumber, validateObject, validateOneOf, validateString,
} from "../../internal/validators.ts";
import { isNodeStream, isReadableStream, isWritableStream } from "../../internal/streams/utils.ts";
import { shouldColorize } from "../../internal/colors.ts";
import { stdout } from "../../internal/stdio.ts";

export { inspect, inspectDefaultOptions, format, formatWithOptions, types };
export { deprecate };
export type { InspectOptions };

// Keep the imported implementation as the exported function value. A
// forwarding wrapper would add a call on every assertion solely to give the
// re-export a local declaration.
export const isDeepStrictEqual = compareDeepStrict;

declare function nts_process_env(name: string): string;

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

declare function nts_debug_write(text: string): number;
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
 * Needs promises, which the runtime does not have yet; the shape is here so it
 * arrives complete rather than as an afterthought.
 */
type CallbackTakingFunction = (
  this: unknown,
  ...args: unknown[]
) => unknown;

type PromisifiedFunction = (
  this: unknown,
  ...args: unknown[]
) => Promise<unknown>;

export function promisify(
  original: CallbackTakingFunction,
): PromisifiedFunction {
  validateFunction(original, "original");

  function promisified(this: unknown, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      // Node's callbacks are `(err, value)`, so the promise settles on the
      // first argument and resolves with the second.
      original.call(
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


export const isArray = Array.isArray;

export default {
  inspect,
  format,
  formatWithOptions,
  isDeepStrictEqual,
  types,
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

declare function nts_uv_err_name(code: number): string;

/** Fixed-layout form of the properties Node exposes on system errors. */
class ErrnoException extends Error {
  code: string;
  errno: number;
  syscall: string;
  address?: string | null;
  port?: number;

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

declare function nts_uv_err_message(code: number): string;
declare function nts_uv_error_codes(): number[];
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
