import { inspect } from "../util/src/inspect.ts";

// Node's error codes, and the messages its own tests assert on.
//
// The message text is not decoration. `test-path.js` compares against a string
// built by `common.invalidArgTypeHelper`, so an error whose wording differs is
// a conformance failure even when the throw itself is correct. These are
// transcribed from node `lib/internal/errors.js`.
//
// Node builds these with a class factory over a table of message templates.
// We write them out, one class per code: the message is then ordinary
// TypeScript rather than a `%s` template, and a caller that gets the argument
// count wrong is a type error instead of a runtime assertion.
//
// What the factory adds beyond `code` and `message` is in `NodeTypeError` and
// its siblings below, and it matters: `assert.throws(fn, /ERR_INVALID_ARG_TYPE/)`
// is how a great many of node's tests spell their expectation, and it works
// because `toString` puts the code in the text.

/**
 * `determineSpecificType`, node `lib/internal/errors.js:996`.
 *
 * The tail of every ERR_INVALID_ARG_TYPE message, and the reason the wording
 * has to be exact: node's tests build the expected string with the same rules.
 */
export function determineSpecificType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }

  const type = typeof value;

  switch (type) {
    case "bigint":
      return `type bigint (${value}n)`;
    case "number": {
      const n = value as number;
      if (n === 0) {
        return 1 / n === -Infinity ? "type number (-0)" : "type number (0)";
      }
      if (n !== n) {
        return "type number (NaN)";
      }
      if (n === Infinity) {
        return "type number (Infinity)";
      }
      if (n === -Infinity) {
        return "type number (-Infinity)";
      }
      return `type number (${n})`;
    }
    case "boolean":
      return value ? "type boolean (true)" : "type boolean (false)";
    case "symbol":
      return `type symbol (${String(value)})`;
    case "function":
      return `function ${(value as { name: string }).name}`;
    case "object": {
      const ctor = (value as { constructor?: { name?: string } }).constructor;
      if (ctor && "name" in ctor) {
        return `an instance of ${ctor.name}`;
      }
      return inspectShallow(value);
    }
    case "string": {
      let s = value as string;
      if (s.length > 28) {
        s = `${s.slice(0, 25)}...`;
      }
      if (s.indexOf("'") === -1) {
        return `type string ('${s}')`;
      }
      return `type string (${JSON.stringify(s)})`;
    }
    default: {
      let s = inspectShallow(value);
      if (s.length > 28) {
        s = `${s.slice(0, 25)}...`;
      }
      return `type ${type} (${s})`;
    }
  }
}

function inspectShallow(value: unknown): string {
  return inspect(value, { depth: -1 });
}

/**
 * The two members node's error factory adds to every code.
 *
 * `toString` carries the code, which is what makes
 * `assert.throws(fn, /ERR_INVALID_ARG_TYPE/)` match: `assert` stringifies the
 * error and tests the regular expression against that, so a message alone is
 * not enough. The `constructor` getter reports the built-in rather than the
 * subclass, so that code checking `err.constructor === TypeError` agrees --
 * node calls that a workaround for the web-platform tests and keeps it.
 *
 * Four bases rather than one generic factory, because the four built-ins are
 * the four node uses and a class expression parameterised over them types
 * worse than writing them out.
 */
function reportBaseConstructor(prototype: object, Base: unknown): void {
  Object.defineProperty(prototype, "constructor", {
    __proto__: null,
    get(): unknown { return Base; },
    configurable: true,
  } as PropertyDescriptor);
}

abstract class NodeError extends Error {
  abstract readonly code: string;
  override toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}
reportBaseConstructor(NodeError.prototype, Error);

abstract class NodeTypeError extends TypeError {
  abstract readonly code: string;
  override toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}
reportBaseConstructor(NodeTypeError.prototype, TypeError);

abstract class NodeRangeError extends RangeError {
  abstract readonly code: string;
  override toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}
reportBaseConstructor(NodeRangeError.prototype, RangeError);

abstract class NodeURIError extends URIError {
  abstract readonly code: string;
  override toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}
reportBaseConstructor(NodeURIError.prototype, URIError);

/**
 * The type names that format as `of type x` rather than `an instance of X`.
 * Node `lib/internal/errors.js:73`, and it accepts `Object` and `Function` as
 * alternatives to the lower-cased spellings -- which is why
 * `validateObject` passes `"Object"` and the message reads `of type object`.
 */
const kTypes = [
  "string",
  "function",
  "number",
  "object",
  "Function",
  "Object",
  "boolean",
  "bigint",
  "symbol",
];

/**
 * V8's `Error.captureStackTrace`: fill in `stack` on `target`, omitting the
 * frames at and above `below`.
 *
 * Not in TypeScript's library, so the cast is here rather than as a global
 * declaration that would claim every engine has it. Node uses it to keep its
 * own machinery out of a user's stack trace, and its tests check that the
 * frames are gone.
 */
export const { captureStackTrace } = Error as unknown as {
  captureStackTrace(target: object, below?: unknown): void;
};

/** A class rather than a `typeof` result: `Buffer`, `TracingChannel`. */
const classNamePattern = /^[A-Z][a-zA-Z0-9]*$/;

/**
 * `a`, `a or b`, `a, b, or c`. Node `lib/internal/errors.js`'s `formatList`
 * with the conjunction fixed to "or", which is the only one these errors use.
 */
function formatList(items: string[]): string {
  if (items.length <= 2) {
    return items.join(" or ");
  }
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

/** `The "path" argument must be of type string. Received type number (42)`. */
export class ERR_INVALID_ARG_TYPE extends NodeTypeError {
  override readonly code = "ERR_INVALID_ARG_TYPE";

  constructor(name: string, expected: string | string[], actual: unknown) {
    // node `lib/internal/errors.js:1390`. Expected types split into the ones
    // `typeof` can name and the ones that are classes, because the two read
    // differently: "of type string" against "an instance of Buffer".
    const kind = name.includes(".") ? "property" : "argument";
    const subject = name.endsWith(" argument") ? `${name} ` : `"${name}" ${kind} `;

    const wanted = Array.isArray(expected) ? expected : [expected];
    const types: string[] = [];
    const instances: string[] = [];
    const other: string[] = [];
    for (const one of wanted) {
      if (kTypes.includes(one)) {
        types.push(one.toLowerCase());
      } else if (classNamePattern.test(one)) {
        instances.push(one);
      } else {
        // Neither a `typeof` result nor a class name: a phrase such as
        // `"a valid port"`, which reads on its own.
        other.push(one);
      }
    }

    // With a class in the list, a bare `object` is the odd one out and reads
    // better beside the classes: "an instance of TracingChannel or Object",
    // not "of type object or an instance of TracingChannel".
    if (instances.length > 0) {
      const at = types.indexOf("object");
      if (at !== -1) {
        types.splice(at, 1);
        instances.push("Object");
      }
    }

    let described = "";
    if (types.length > 0) {
      described += `${types.length > 1 ? "one of type" : "of type"} ${formatList(types)}`;
      if (instances.length > 0 || other.length > 0) {
        described += " or ";
      }
    }
    if (instances.length > 0) {
      described += `an instance of ${formatList(instances)}`;
      if (other.length > 0) {
        described += " or ";
      }
    }
    if (other.length > 0) {
      if (other.length > 1) {
        described += `one of ${formatList(other)}`;
      } else {
        const only = other[0]!;
        described += only.toLowerCase() !== only ? `an ${only}` : only;
      }
    }

    super(`The ${subject}must be ${described}. Received ${determineSpecificType(actual)}`);
    this.name = "TypeError";
  }
}

/**
 * Digit groups, node `lib/internal/errors.js`. A number large enough to be
 * unreadable is printed as `1_000_000` in the message, which is why the
 * threshold is 2^32 rather than a round decimal.
 */
function addNumericalSeparator(value: string): string {
  let result = "";
  let i = value.length;
  const start = value[0] === "-" ? 1 : 0;
  for (; i >= start + 4; i -= 3) {
    result = `_${value.slice(i - 3, i)}${result}`;
  }
  return `${value.slice(0, i)}${result}`;
}

/** `The value of "pid" is out of range. It must be an integer. Received NaN`. */
export class ERR_OUT_OF_RANGE extends NodeRangeError {
  override readonly code = "ERR_OUT_OF_RANGE";

  constructor(name: string, range: string, input: unknown, replaceDefaultBoolean = false) {
    let received: string;
    if (typeof input === "number" && Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
      received = addNumericalSeparator(String(input));
    } else if (typeof input === "bigint") {
      received = String(input);
      if (input > 2n ** 32n || input < -(2n ** 32n)) {
        received = addNumericalSeparator(received);
      }
      received += "n";
    } else {
      received = inspectValue(input);
    }
    const head = replaceDefaultBoolean ? name : `The value of "${name}" is out of range.`;
    super(`${head} It must be ${range}. Received ${received}`);
    this.name = "RangeError";
  }
}

/**
 * What `util.inspect` prints for the values these errors report.
 *
 * A real `util.inspect` belongs in `node:util` and will replace this. The
 * shapes reachable here are narrower than the general case: an argument that
 * failed a range check is a number, a bigint, or something simple enough to
 * name.
 */
export function inspectValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value).replace(/^"|"$/g, "'");
  }
  if (typeof value === "bigint") {
    return `${value}n`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (Array.isArray(value)) {
    return `[ ${value.map(inspectValue).join(", ")} ]`;
  }
  if (typeof value === "function") {
    const named = (value as { name?: string }).name;
    return named ? `[Function: ${named}]` : "[Function (anonymous)]";
  }
  return "[Object]";
}

/** `The "ext" argument must be of type string. Received ...` for a value. */
export class ERR_INVALID_ARG_VALUE extends NodeTypeError {
  override readonly code = "ERR_INVALID_ARG_VALUE";

  constructor(name: string, value: unknown, reason = "is invalid") {
    // The value itself, not a description of its type: this error is about
    // *which* value was wrong, and `'auto'` is more use than `type string`.
    let inspected = inspect(value);
    if (inspected.length > 128) {
      inspected = `${inspected.slice(0, 128)}...`;
    }
    const kind = name.includes(".") ? "property" : "argument";
    super(`The ${kind} '${name}' ${reason}. Received ${inspected}`);
    this.name = "TypeError";
  }
}

/** `The "listener" argument must be of type function. Received …`. */
export class ERR_INVALID_ARG_TYPE_FUNCTION extends ERR_INVALID_ARG_TYPE {
  constructor(name: string, actual: unknown) {
    super(name, "function", actual);
  }
}

/** `Unhandled error. (…)` — an `error` event with nobody listening. */
export class ERR_UNHANDLED_ERROR extends NodeError {
  override readonly code = "ERR_UNHANDLED_ERROR";
  context: unknown;

  constructor(err?: string) {
    super(`Unhandled error.${err === undefined ? "" : ` (${err})`}`);
    this.name = "Error";
  }
}

/** `URI malformed` — a lone surrogate, which has no UTF-8 encoding. */
export class ERR_INVALID_URI extends NodeURIError {
  override readonly code = "ERR_INVALID_URI";

  constructor() {
    super("URI malformed");
    this.name = "URIError";
  }
}

/** `Unknown encoding: utf9`. */
export class ERR_UNKNOWN_ENCODING extends NodeTypeError {
  override readonly code = "ERR_UNKNOWN_ENCODING";

  constructor(encoding: string) {
    super(`Unknown encoding: ${encoding}`);
    this.name = "TypeError";
  }
}

/** `The "actual" and "expected" arguments must be specified`. */
export class ERR_MISSING_ARGS extends NodeTypeError {
  override readonly code = "ERR_MISSING_ARGS";

  constructor(...names: string[]) {
    const quoted = names.map((n) => `"${n}"`);
    const list =
      quoted.length === 1 ? quoted[0]
      : quoted.length === 2 ? `${quoted[0]} and ${quoted[1]}`
      : `${quoted.slice(0, -1).join(", ")}, and ${quoted[quoted.length - 1]}`;
    super(`The ${list} argument${names.length > 1 ? "s" : ""} must be specified`);
    this.name = "TypeError";
  }
}

/** `Console expects a writable stream instance for stdout`. */
export class ERR_CONSOLE_WRITABLE_STREAM extends NodeTypeError {
  override readonly code = "ERR_CONSOLE_WRITABLE_STREAM";

  constructor(name: string) {
    super(`Console expects a writable stream instance for ${name}`);
    this.name = "TypeError";
  }
}

/** Two options that cannot both be given, such as `colorMode` and `colors`. */
export class ERR_INCOMPATIBLE_OPTION_PAIR extends NodeTypeError {
  override readonly code = "ERR_INCOMPATIBLE_OPTION_PAIR";

  constructor(first: string, second: string) {
    super(`Option "${first}" cannot be used in combination with option "${second}"`);
    this.name = "TypeError";
  }
}

/** `Cannot set cursor row without setting its column`. */
export class ERR_INVALID_CURSOR_POS extends NodeTypeError {
  override readonly code = "ERR_INVALID_CURSOR_POS";

  constructor() {
    super("Cannot set cursor row without setting its column");
    this.name = "TypeError";
  }
}

/**
 * `Promise was rejected with falsy value`.
 *
 * `null` means "no error" to a callback, so a promise that rejects with a
 * falsy value has to arrive as something truthy or the callback would read it
 * as success. The original is kept on `reason`.
 */
export class ERR_FALSY_VALUE_REJECTION extends NodeError {
  override readonly code = "ERR_FALSY_VALUE_REJECTION";
  readonly reason: unknown;

  constructor(reason: unknown) {
    super("Promise was rejected with falsy value");
    this.name = "Error";
    this.reason = reason;
  }
}

/** `Class constructor Assert cannot be invoked without \`new\``. */
export class ERR_CONSTRUCT_CALL_REQUIRED extends NodeTypeError {
  override readonly code = "ERR_CONSTRUCT_CALL_REQUIRED";

  constructor(name: string) {
    super(`Class constructor ${name} cannot be invoked without \`new\``);
    this.name = "TypeError";
  }
}

/**
 * An argument that could plausibly have been meant as either of two things.
 *
 * `assert.throws(fn, 'oops')` is the case: `'oops'` is the message, but if the
 * error's message is also `'oops'` then the caller probably meant it as the
 * expectation and the assertion would pass for the wrong reason.
 */
export class ERR_AMBIGUOUS_ARGUMENT extends NodeTypeError {
  override readonly code = "ERR_AMBIGUOUS_ARGUMENT";

  constructor(name: string, reason: string) {
    super(`The "${name}" argument is ambiguous. ${reason}`);
    this.name = "TypeError";
  }
}

/** A callback or supplied function returned something it should not have. */
export class ERR_INVALID_RETURN_VALUE extends NodeTypeError {
  override readonly code = "ERR_INVALID_RETURN_VALUE";

  constructor(input: string, name: string, value: unknown) {
    let type: string;
    if (value != null && (value as object).constructor?.name) {
      type = `instance of ${(value as object).constructor.name}`;
    } else {
      type = `type ${typeof value}`;
    }
    super(`Expected ${input} to be returned from the "${name}" function but got ${type}.`);
    this.name = "TypeError";
  }
}

/** Something was asked for while the process was on its way out. */
export class ERR_UNAVAILABLE_DURING_EXIT extends NodeError {
  override readonly code = "ERR_UNAVAILABLE_DURING_EXIT";

  constructor() {
    super("Cannot call function in process exit handler");
    this.name = "Error";
  }
}

/** An operation on something that is no longer in a state to allow it. */
export class ERR_INVALID_STATE extends NodeError {
  override readonly code = "ERR_INVALID_STATE";

  constructor(reason: string) {
    super(`Invalid state: ${reason}`);
    this.name = "Error";
  }
}

/** `Invalid URL` — the input could not be parsed as one. */
export class ERR_INVALID_URL extends NodeTypeError {
  override readonly code = "ERR_INVALID_URL";
  readonly input: string;

  constructor(input: string) {
    super("Invalid URL");
    this.name = "TypeError";
    // The offending text is a property rather than part of the message: node
    // keeps messages free of user data so that they group when logged.
    this.input = input;
  }
}

/** `File URL host must be "localhost" or empty on linux`. */
export class ERR_INVALID_FILE_URL_HOST extends NodeTypeError {
  override readonly code = "ERR_INVALID_FILE_URL_HOST";

  constructor(platform: string) {
    super(`File URL host must be "localhost" or empty on ${platform}`);
    this.name = "TypeError";
  }
}

/** `File URL path must be absolute`. */
export class ERR_INVALID_FILE_URL_PATH extends NodeTypeError {
  override readonly code = "ERR_INVALID_FILE_URL_PATH";
  readonly input: unknown;

  constructor(reason: string, input?: unknown) {
    super(`File URL path ${reason}`);
    this.name = "TypeError";
    this.input = input;
  }
}

/** `The URL must be of scheme file`. */
export class ERR_INVALID_URL_SCHEME extends NodeTypeError {
  override readonly code = "ERR_INVALID_URL_SCHEME";

  constructor(expected: string | readonly string[]) {
    const list = typeof expected === "string" ? [expected] : expected;
    const wanted = list.length === 2 ? `one of scheme ${list[0]} or ${list[1]}` : `of scheme ${list[0]}`;
    super(`The URL must be ${wanted}`);
    this.name = "TypeError";
  }
}

/** `Value of "this" must be of type URLSearchParams`. */
/**
 * An operation cancelled through an `AbortSignal`.
 *
 * Not a `NodeError`: this one is web-platform rather than node's own, so it is
 * named `AbortError` with the code `ABORT_ERR`, and code written against
 * `fetch` or the DOM recognises it by either.
 */
export class AbortError extends Error {
  readonly code = "ABORT_ERR";

  constructor(message = "The operation was aborted", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AbortError";
  }
}

/**
 * A class the program is given an instance of but may not construct.
 *
 * The message says only `Illegal constructor`, matching what a browser throws
 * for the same mistake.
 */
export class ERR_ILLEGAL_CONSTRUCTOR extends NodeTypeError {
  override readonly code = "ERR_ILLEGAL_CONSTRUCTOR";

  constructor() {
    super("Illegal constructor");
    this.name = "TypeError";
  }
}

export class ERR_INVALID_THIS extends NodeTypeError {
  override readonly code = "ERR_INVALID_THIS";

  constructor(type: string) {
    super(`Value of "this" must be of type ${type}`);
    this.name = "TypeError";
  }
}

/** `Each query pair must be an iterable [name, value] tuple`. */
export class ERR_INVALID_TUPLE extends NodeTypeError {
  override readonly code = "ERR_INVALID_TUPLE";

  constructor(name: string, reason: string) {
    super(`Each ${name} must be ${reason}`);
    this.name = "TypeError";
  }
}

/** `Attempt to access memory outside buffer bounds`. */
export class ERR_BUFFER_OUT_OF_BOUNDS extends NodeRangeError {
  override readonly code = "ERR_BUFFER_OUT_OF_BOUNDS";

  constructor(name?: string) {
    super(name === undefined
      ? "Attempt to access memory outside buffer bounds"
      : `"${name}" is outside of buffer bounds`);
    this.name = "RangeError";
  }
}
