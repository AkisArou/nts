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
// `JSON` has no definition in a compiled program, and giving it one would mean
// a second statement of the escaping rule of 25.5.4.3 in C. It is already
// stated once, in TypeScript, and this is the same crossing `internal/utf8.ts`
// already makes for the UTF-8 codec.
//
// `quoteJSONString` returns the value *with* its quotes, so it substitutes for
// `JSON.stringify` directly at both sites below, where the argument is a
// `string` in each case. Checked rather than assumed: 65,633 strings -- every
// UTF-16 code unit including lone surrogates, astral pairs, and pairs of
// escape-adjacent units -- agree with node's `JSON.stringify`, on a harness
// that reports 2,161 differences when handed a quoter that does no escaping.
import { quoteJSONString } from "../../web-platform/src/json/text.ts";

export function determineSpecificType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }

  switch (typeof value) {
    case "bigint":
      return `type bigint (${value}n)`;
    case "number": {
      if (value === 0) {
        return 1 / value === -Infinity ? "type number (-0)" : "type number (0)";
      }
      if (value !== value) {
        return "type number (NaN)";
      }
      if (value === Infinity) {
        return "type number (Infinity)";
      }
      if (value === -Infinity) {
        return "type number (-Infinity)";
      }
      return `type number (${value})`;
    }
    case "boolean":
      return value ? "type boolean (true)" : "type boolean (false)";
    case "symbol":
      return `type symbol (${String(value)})`;
    case "function":
      // A compiled function is a function pointer, not an object with an
      // observable `.name`; discovering it is a §13 non-goal. Keep Node's
      // separator after the unavailable name so an anonymous function has the
      // same spelling as Node (`function `).
      return "function ";
    case "object":
      return `an instance of ${staticObjectName(value)}`;
    case "string": {
      let s = value;
      if (s.length > 28) {
        s = `${s.slice(0, 25)}...`;
      }
      if (s.indexOf("'") === -1) {
        return `type string ('${s}')`;
      }
      return `type string (${quoteJSONString(s)})`;
    }
  }
  // Defensive for a future JavaScript `typeof` category. Every current one is
  // handled above.
  return `type ${typeof value}`;
}

/**
 * A closed object-kind description that never consults `constructor.name`.
 *
 * The checks name runtime kinds NTS represents statically. Custom class names
 * would require walking a prototype chain and reading function metadata, both
 * explicitly outside the language profile.
 */
function staticObjectName(value: object): string {
  if (Array.isArray(value)) return "Array";
  if (value instanceof Uint8Array) return "Uint8Array";
  if (value instanceof ArrayBuffer) return "ArrayBuffer";
  if (value instanceof DataView) return "DataView";
  if (value instanceof Map) return "Map";
  if (value instanceof Set) return "Set";
  if (value instanceof WeakMap) return "WeakMap";
  if (value instanceof WeakSet) return "WeakSet";
  if (value instanceof Promise) return "Promise";
  if (value instanceof Date) return "Date";
  if (value instanceof Error) return value.name || "Error";
  return "Object";
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
abstract class NodeError extends Error {
  abstract readonly code: string;
  // Written with brackets because `get constructor()` is a type error, which
  // is presumably why node writes it this way too.
  override get ["constructor"](): unknown {
    return Error;
  }
  override toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}

abstract class NodeTypeError extends TypeError {
  abstract readonly code: string;
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}

abstract class NodeRangeError extends RangeError {
  abstract readonly code: string;
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}

abstract class NodeURIError extends URIError {
  abstract readonly code: string;
  override get ["constructor"](): unknown {
    return URIError;
  }
  override toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}

/**
 * The bases for the errors node throws from C++, where `THROW_ERR_*` makes a
 * built-in error and sets `code` on it, and nothing else. Its `toString` is
 * therefore the built-in's -- `Error: Unknown DH group`, with no code in it --
 * and a test matching `String(error)` against that sees the difference from
 * the JavaScript factory's form. The `_BINDING` classes below, and each code
 * node defines only in `node_errors.h`, extend these.
 */
abstract class NativeError extends NodeError {
  override toString(): string {
    return `${this.name}: ${this.message}`;
  }
}

abstract class NativeTypeError extends NodeTypeError {
  override toString(): string {
    return `${this.name}: ${this.message}`;
  }
}

abstract class NativeRangeError extends NodeRangeError {
  override toString(): string {
    return `${this.name}: ${this.message}`;
  }
}

/** `Invalid socket address`.
 *
 * Node throws this from C++ rather than from `lib/internal/errors.js`, which is
 * why it does not appear in that file's `E(...)` table. `BlockList`'s three
 * add methods raise it for an address that does not parse, and the observable
 * shape is an `Error` -- not a `TypeError` -- carrying only `code`.
 *
 * A differential against node found ours raising `ERR_INVALID_ARG_VALUE` here,
 * on every one of 430 generated addresses.
 */
export class ERR_INVALID_ADDRESS extends NodeError {
  override readonly code = "ERR_INVALID_ADDRESS";

  constructor() {
    super("Invalid socket address");
  }
}

/** `Directory handle was closed`. */
export class ERR_DIR_CLOSED extends NodeError {
  override readonly code = "ERR_DIR_CLOSED";

  constructor() {
    super("Directory handle was closed");
  }
}

/** A synchronous directory operation cannot overtake an async one. */
export class ERR_DIR_CONCURRENT_OPERATION extends NodeError {
  override readonly code = "ERR_DIR_CONCURRENT_OPERATION";

  constructor() {
    super("Cannot do synchronous work on directory handle with concurrent asynchronous operations");
  }
}

/** The SystemError returned when `rm` is asked to remove a directory. */
export class ERR_FS_EISDIR extends NodeError {
  override readonly code = "ERR_FS_EISDIR";
  readonly info: {
    errno: number;
    code: string;
    message: string;
    syscall: "rm";
    path: string;
  };
  errno: number;
  syscall: "rm";
  path: string;

  constructor(errno: number, systemCode: string, description: string, path: string) {
    super(`Path is a directory: rm returned ${systemCode} (${description}) ${path}`);
    this.name = "SystemError";
    this.errno = errno;
    this.syscall = "rm";
    this.path = path;
    this.info = {
      errno,
      code: systemCode,
      message: description,
      syscall: "rm",
      path,
    };
  }
}

/**
 * V8's optional `Error.captureStackTrace` host seam. A compiled NTS program
 * keeps no JavaScript frames, while the Node conformance host does. Modelling
 * the optional member explicitly keeps both cases typed without asserting a
 * different type for the global constructor.
 */
interface StackCapturingErrorConstructor extends ErrorConstructor {
  captureStackTrace?(target: object, below?: CallableFunction): void;
}

const stackCapturingError: StackCapturingErrorConstructor = Error;

export function captureStackTrace(target: object, below?: CallableFunction): void {
  stackCapturingError.captureStackTrace?.(target, below);
}

/** A class rather than a `typeof` result: `Buffer`, `TracingChannel`. */
function isClassName(value: string): boolean {
  if (value.length === 0) return false;
  const first = value.charCodeAt(0);
  if (first < 65 || first > 90) return false;
  for (let i = 1; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const alphaNumeric =
      (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (!alphaNumeric) return false;
  }
  return true;
}

/**
 * Type names that format as `of type x` rather than `an instance of X`.
 */
function isTypeName(value: string): boolean {
  switch (value) {
    case "string":
    case "function":
    case "number":
    case "object":
    case "Function":
    case "Object":
    case "boolean":
    case "bigint":
    case "symbol":
      return true;
    default:
      return false;
  }
}

type ExpectedCategory = "type" | "instance" | "other";

function expectedCategory(value: string, objectIsInstance: boolean): ExpectedCategory {
  if (isTypeName(value)) {
    return objectIsInstance && value.toLowerCase() === "object" ? "instance" : "type";
  }
  return isClassName(value) ? "instance" : "other";
}

function countExpected(
  values: readonly string[],
  category: ExpectedCategory,
  objectIsInstance: boolean,
): number {
  let count = 0;
  for (const value of values) {
    if (expectedCategory(value, objectIsInstance) === category) count++;
  }
  return count;
}

/** `a`, `a or b`, `a, b, or c`, selecting one category without arrays. */
function formatExpected(
  values: readonly string[],
  category: ExpectedCategory,
  objectIsInstance: boolean,
  count: number,
): string {
  let result = "";
  let written = 0;
  for (const value of values) {
    if (expectedCategory(value, objectIsInstance) !== category) continue;
    if (written > 0) {
      result += written === count - 1 ? (count === 2 ? " or " : ", or ") : ", ";
    }
    result += category === "type" ? value.toLowerCase() : value;
    written++;
  }
  return result;
}

/** `The "path" argument must be of type string. Received type number (42)`. */
/**
 * `ERR_INVALID_ARG_TYPE` with a message node's C++ wrote rather than its
 * template.
 *
 * A handful of node's validations happen in the binding rather than in
 * JavaScript, and those carry the standard `code` with a message that does not
 * follow the standard shape. `fs.accessSync("/tmp", "x")` is the one this
 * profile reaches: node answers `mode must be int32 or null/undefined` -- no
 * quoted name, no "The ... argument" prefix, no "Received" suffix -- because
 * `accessSync` hands `mode` straight to `binding.access`.
 *
 * Reproducing that through the template is not possible, and should not be:
 * the template is right about every case node builds in JavaScript. This is the
 * escape hatch for the ones it does not, and it exists so that matching node
 * does not mean weakening the template.
 */
export class ERR_INVALID_ARG_TYPE_BINDING extends NativeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_ARG_TYPE";

  constructor(message: string) {
    super(message);
  }
}

export class ERR_INVALID_ARG_TYPE extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_ARG_TYPE";

  constructor(name: string, expected: string | string[], actual: unknown) {
    // node `lib/internal/errors.js:1390`. Expected types split into the ones
    // `typeof` can name and the ones that are classes, because the two read
    // differently: "of type string" against "an instance of Buffer".
    const kind = name.includes(".") ? "property" : "argument";
    const subject = name.endsWith(" argument") ? `${name} ` : `"${name}" ${kind} `;

    const wanted: readonly string[] = Array.isArray(expected) ? expected : [expected];
    let namedClassCount = 0;
    for (const value of wanted) {
      if (!isTypeName(value) && isClassName(value)) namedClassCount++;
    }

    // With a class in the list, a bare `object` is the odd one out and reads
    // better beside the classes: "an instance of TracingChannel or Object",
    // not "of type object or an instance of TracingChannel".
    const objectIsInstance = namedClassCount > 0;
    const typeCount = countExpected(wanted, "type", objectIsInstance);
    const instanceCount = countExpected(wanted, "instance", objectIsInstance);
    const otherCount = countExpected(wanted, "other", objectIsInstance);

    let described = "";
    if (typeCount > 0) {
      described += `${typeCount > 1 ? "one of type" : "of type"} ${formatExpected(wanted, "type", objectIsInstance, typeCount)}`;
      if (instanceCount > 0 || otherCount > 0) {
        described += " or ";
      }
    }
    if (instanceCount > 0) {
      described += `an instance of ${formatExpected(wanted, "instance", objectIsInstance, instanceCount)}`;
      if (otherCount > 0) {
        described += " or ";
      }
    }
    if (otherCount > 0) {
      if (otherCount > 1) {
        described += `one of ${formatExpected(wanted, "other", objectIsInstance, otherCount)}`;
      } else {
        const only = formatExpected(wanted, "other", objectIsInstance, otherCount);
        described += only.toLowerCase() !== only ? `an ${only}` : only;
      }
    }

    super(`The ${subject}must be ${described}. Received ${determineSpecificType(actual)}`);
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

/**
 * `Channel closed`.
 *
 * What `send` reports once the channel is gone: node hands it to the callback if there
 * is one and emits it as an `error` if there is not, rather than returning false and
 * saying nothing.
 */
export class ERR_IPC_CHANNEL_CLOSED extends NodeError {
  override readonly code = "ERR_IPC_CHANNEL_CLOSED";

  constructor() {
    super("Channel closed");
  }
}

/**
 * `IPC channel is already disconnected`.
 *
 * node's `disconnect` on an already-disconnected channel emits this as an `error`
 * rather than emitting `disconnect` a second time, which is the difference between
 * one `disconnect` event and two.
 */
export class ERR_IPC_DISCONNECTED extends NodeError {
  override readonly code = "ERR_IPC_DISCONNECTED";

  constructor() {
    super("IPC channel is already disconnected");
  }
}

/**
 * `Forked processes must have an IPC channel, missing value 'ipc' in options.stdio`.
 *
 * A plain Error in node. `fork` requires an `'ipc'` entry in `stdio`, and a caller
 * who spells out four pipes without one gets this rather than a child with no
 * channel.
 */
export class ERR_CHILD_PROCESS_IPC_REQUIRED extends NodeError {
  override readonly code = "ERR_CHILD_PROCESS_IPC_REQUIRED";

  constructor(where: string) {
    super(`Forked processes must have an IPC channel, missing value 'ipc' in ${where}`);
  }
}

/**
 * `Child process can have only one IPC pipe`.
 *
 * A plain Error in node, not a TypeError or a RangeError, and thrown
 * *synchronously* from `spawn` when a second `'ipc'` appears in `stdio`.
 */
export class ERR_IPC_ONE_PIPE extends NodeError {
  override readonly code = "ERR_IPC_ONE_PIPE";

  constructor() {
    super("Child process can have only one IPC pipe");
  }
}

/**
 * `stdout maxBuffer length exceeded`.
 *
 * A **RangeError** in node, not an Error, and
 * test-child-process-exec-maxbuf asserts `err instanceof RangeError` beside the
 * code and the message.
 */
export class ERR_CHILD_PROCESS_STDIO_MAXBUFFER extends NodeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";

  constructor(streamName: string) {
    super(`${streamName} maxBuffer length exceeded`);
  }
}

/** `The value of "pid" is out of range. It must be an integer. Received NaN`. */
export class ERR_OUT_OF_RANGE extends NodeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
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
function inspectString(value: string): string {
  // Node's escaping table, not `JSON.stringify`'s. The two agree on almost
  // nothing in the control range: `JSON.stringify` writes `\u0001` where node
  // writes `\x01`, uses lowercase hex where node uses upper, and passes `\x7f`
  // through unescaped entirely. This read `JSON.stringify(value).slice(1, -1)`
  // and patched up `\u0000` alone, so every control character except NUL came
  // out in the wrong notation:
  //
  //     "\x01"  node '\x01'   was '\u0001'
  //     "\x1f"  node '\x1F'   was '\u001f'
  //     "\x7f"  node '\x7F'   was unescaped
  //
  // `runtime/node/util/src/inspect.ts` already had this right; this is a
  // private second copy in `internal/` that had it wrong, which is the whole
  // reason it was worth writing down rather than quietly editing.
  //
  // Still an approximation in one respect, deliberately: node chooses its quote
  // character to avoid escaping (`util.inspect("it's")` is double-quoted), and
  // this always single-quotes and escapes. That belongs with the real
  // `util.inspect` this function's header already promises will replace it.
  let escaped = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x27) {
      escaped += "\\'";
    } else if (code === 0x5c) {
      escaped += "\\\\";
    } else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      escaped += escapeControlCharacter(code);
    } else if (code >= 0xd800 && code <= 0xdfff) {
      // A well-formed pair passes through as itself; a lone surrogate is named.
      if (code <= 0xdbff && i + 1 < value.length) {
        const trailing = value.charCodeAt(i + 1);
        if (trailing >= 0xdc00 && trailing <= 0xdfff) {
          escaped += value.slice(i, i + 2);
          i++;
          continue;
        }
      }
      escaped += `\\u${code.toString(16)}`;
    } else {
      escaped += value[i];
    }
  }
  return `'${escaped}'`;
}

/** Node `lib/internal/util/inspect.js`. Five named escapes, then `\xHH` upper. */
function escapeControlCharacter(code: number): string {
  switch (code) {
    case 0x08:
      return "\\b";
    case 0x09:
      return "\\t";
    case 0x0a:
      return "\\n";
    case 0x0c:
      return "\\f";
    case 0x0d:
      return "\\r";
    default: {
      const hex = code.toString(16).toUpperCase();
      return `\\x${hex.length === 1 ? `0${hex}` : hex}`;
    }
  }
}

/**
 * Node's `keyStrRegExp`, spelled as the character test it is.
 *
 * `lib/internal/util/inspect.js:249` is `/^[a-zA-Z_][a-zA-Z_0-9]*$/`, and
 * `:2336` uses it to decide whether a key prints bare or quoted.
 *
 * **This used to accept `$` and node does not.** The regex here read
 * `/^[A-Za-z_$][A-Za-z0-9_$]*$/`, which is the JavaScript identifier rule and
 * not node's rule for this decision -- node prints `{ '$a': 1 }`, `{ 'a$b': 1 }`
 * and `{ '$': 1 }`, all quoted, and this would have printed the first two bare.
 * Found by reading node's source while looking at something else; nothing was
 * testing it.
 *
 * Written as a loop rather than a literal because the loop is what the two
 * spellings have in common, and this one is checkable character by character
 * against node's set. The regular expression engine is a separate question and
 * this function is not the place to be waiting on it.
 */
function isBareKey(name: string): boolean {
  if (name.length === 0) return false;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    const letter = (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
    const underscore = c === 0x5f;
    if (letter || underscore) continue;
    // Digits are allowed everywhere except first, which is the only way the
    // two character classes in node's expression differ.
    if (i > 0 && c >= 0x30 && c <= 0x39) continue;
    return false;
  }
  return true;
}

function inspectPropertyName(name: string): string {
  return isBareKey(name) ? name : inspectString(name);
}

function isStringKeyedObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function inspectValueWithin(value: unknown, ancestors: Set<object>): string {
  if (typeof value === "string") {
    return inspectString(value);
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
    if (ancestors.has(value)) return "[Circular]";
    ancestors.add(value);
    const items = new Array<string>(value.length);
    for (let index = 0; index < value.length; index++) {
      items[index] = inspectValueWithin(value[index], ancestors);
    }
    ancestors.delete(value);
    return `[ ${items.join(", ")} ]`;
  }
  if (typeof value === "function") {
    return "[Function]";
  }
  if (typeof value === "symbol") {
    return String(value);
  }
  if (value instanceof Uint8Array) {
    return value.length === 0
      ? "Uint8Array(0) []"
      : `Uint8Array(${value.length}) [ ${value.join(", ")} ]`;
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  if (isStringKeyedObject(value)) {
    if (ancestors.has(value)) return "[Circular]";
    ancestors.add(value);
    const keys = Object.keys(value);
    const entries = new Array<string>(keys.length);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      if (key === undefined) {
        throw new Error(`inspected object is missing key ${index}`);
      }
      entries[index] = `${inspectPropertyName(key)}: ${inspectValueWithin(value[key], ancestors)}`;
    }
    ancestors.delete(value);
    return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
  }
  return "[Object]";
}

export function inspectValue(value: unknown): string {
  return inspectValueWithin(value, new Set<object>());
}

/** `The "ext" argument must be of type string. Received ...` for a value. */
export class ERR_INVALID_ARG_VALUE extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_ARG_VALUE";

  constructor(name: string, value: unknown, reason = "is invalid") {
    // The value itself, not a description of its type: this error is about
    // *which* value was wrong, and `'auto'` is more use than `type string`.
    let inspected = inspectValue(value);
    if (inspected.length > 128) {
      inspected = `${inspected.slice(0, 128)}...`;
    }
    const kind = name.includes(".") ? "property" : "argument";
    super(`The ${kind} '${name}' ${reason}. Received ${inspected}`);
  }
}

/**
 * `The MIME syntax for a type in "no-slash" is invalid`, with the offending index
 * appended when there is one.
 *
 * The index is omitted for `-1`, which is how node distinguishes "this production
 * is empty or absent" from "this production has a character that cannot appear in
 * it". `"/x"` has no type at all and reports no index; `"a b/c"` has one at 1.
 */
export class ERR_INVALID_MIME_SYNTAX extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_MIME_SYNTAX";

  constructor(production: string, str: string, invalidIndex: number) {
    const at = invalidIndex !== -1 ? ` at ${invalidIndex}` : "";
    super(`The MIME syntax for a ${production} in "${str}" is invalid${at}`);
  }
}

/** `The "listener" argument must be of type function. Received …`. */
export class ERR_INVALID_ARG_TYPE_FUNCTION extends ERR_INVALID_ARG_TYPE {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  constructor(name: string, actual: unknown) {
    super(name, "function", actual);
  }
}

/** `Unhandled error. (…)` — an `error` event with nobody listening. */
export class ERR_UNHANDLED_ERROR extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_UNHANDLED_ERROR";
  context: unknown;

  constructor(err?: string) {
    super(`Unhandled error.${err === undefined ? "" : ` (${err})`}`);
  }
}

/** `URI malformed` — a lone surrogate, which has no UTF-8 encoding. */
export class ERR_INVALID_URI extends NodeURIError {
  override get ["constructor"](): unknown {
    return URIError;
  }
  override readonly code = "ERR_INVALID_URI";

  constructor() {
    super("URI malformed");
  }
}

/** `Unknown encoding: utf9`. */
export class ERR_UNKNOWN_ENCODING extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_UNKNOWN_ENCODING";

  constructor(encoding: unknown) {
    // Node formats this `%s` through util.inspect. The typed API admits a
    // string without quotes; other inputs retain the small, closed structural
    // inspection used by the rest of this error module.
    const displayed = typeof encoding === "string" ? encoding : inspectValue(encoding);
    super(`Unknown encoding: ${displayed}`);
  }
}

/** `The "actual" and "expected" arguments must be specified`. */
export class ERR_MISSING_ARGS extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_MISSING_ARGS";

  constructor(...names: (string | readonly string[])[]) {
    const quoted = names.map((name) =>
      Array.isArray(name) ? name.map((part) => `"${part}"`).join(" or ") : `"${name}"`,
    );
    const list =
      quoted.length === 1
        ? quoted[0]
        : quoted.length === 2
          ? `${quoted[0]} and ${quoted[1]}`
          : `${quoted.slice(0, -1).join(", ")}, and ${quoted[quoted.length - 1]}`;
    super(`The ${list} argument${names.length > 1 ? "s" : ""} must be specified`);
  }
}

/** `Query pairs must be iterable`. */
export class ERR_ARG_NOT_ITERABLE extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_ARG_NOT_ITERABLE";

  constructor(name: string) {
    super(`${name} must be iterable`);
  }
}

/** `Console expects a writable stream instance for stdout`. */
export class ERR_CONSOLE_WRITABLE_STREAM extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_CONSOLE_WRITABLE_STREAM";

  constructor(name: string) {
    super(`Console expects a writable stream instance for ${name}`);
  }
}

/** Two options that cannot both be given, such as `colorMode` and `colors`. */
export class ERR_INCOMPATIBLE_OPTION_PAIR extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INCOMPATIBLE_OPTION_PAIR";

  constructor(first: string, second: string) {
    super(`Option "${first}" cannot be used in combination with option "${second}"`);
  }
}

/** `Cannot set cursor row without setting its column`. */
export class ERR_INVALID_CURSOR_POS extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_CURSOR_POS";

  constructor() {
    super("Cannot set cursor row without setting its column");
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
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_FALSY_VALUE_REJECTION";
  readonly reason: unknown;

  constructor(reason: unknown) {
    super("Promise was rejected with falsy value");
    this.reason = reason;
  }
}

/** `Class constructor Assert cannot be invoked without \`new\``. */
export class ERR_CONSTRUCT_CALL_REQUIRED extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_CONSTRUCT_CALL_REQUIRED";

  constructor(name: string) {
    super(`Class constructor ${name} cannot be invoked without \`new\``);
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
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_AMBIGUOUS_ARGUMENT";

  constructor(name: string, reason: string) {
    super(`The "${name}" argument is ambiguous. ${reason}`);
  }
}

/** A callback or supplied function returned something it should not have. */
export class ERR_INVALID_RETURN_VALUE extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_RETURN_VALUE";

  constructor(input: string, name: string, value: unknown) {
    super(
      `Expected ${input} to be returned from the "${name}" function but got ` +
        `${determineSpecificType(value)}.`,
    );
  }
}

/** Something was asked for while the process was on its way out. */
export class ERR_UNAVAILABLE_DURING_EXIT extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_UNAVAILABLE_DURING_EXIT";

  constructor() {
    super("Cannot call function in process exit handler");
  }
}

/** An operation on something that is no longer in a state to allow it. */
export class ERR_INVALID_STATE extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_INVALID_STATE";

  constructor(reason: string) {
    super(`Invalid state: ${reason}`);
  }
}

/** The TypeError-flavoured form of `ERR_INVALID_STATE`. */
export class ERR_INVALID_STATE_TYPE extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_STATE";

  constructor(reason: string) {
    super(`Invalid state: ${reason}`);
  }
}

/** The RangeError-flavoured form of `ERR_INVALID_STATE`. */
export class ERR_INVALID_STATE_RANGE extends NodeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_INVALID_STATE";

  constructor(reason: string) {
    super(`Invalid state: ${reason}`);
  }
}

/** `Invalid URL` — the input could not be parsed as one. */
export class ERR_INVALID_URL extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_URL";
  readonly input: string;

  constructor(input: string) {
    super("Invalid URL");
    // The offending text is a property rather than part of the message: node
    // keeps messages free of user data so that they group when logged.
    this.input = input;
  }

  override toString(): string {
    return `${this.name}: ${this.message}`;
  }
}

/** The URL or Agent selected a protocol this client cannot speak. */
export class ERR_INVALID_PROTOCOL extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_PROTOCOL";

  constructor(actual: string, expected: string) {
    super(`Protocol "${actual}" not supported. Expected "${expected}"`);
  }
}

/** `File URL host must be "localhost" or empty on linux`. */
export class ERR_INVALID_FILE_URL_HOST extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_FILE_URL_HOST";

  constructor(platform: string) {
    super(`File URL host must be "localhost" or empty on ${platform}`);
  }
}

/** `File URL path must be absolute`. */
export class ERR_INVALID_FILE_URL_PATH extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_FILE_URL_PATH";
  readonly input: unknown;

  constructor(reason: string, input?: unknown) {
    super(`File URL path ${reason}`);
    this.input = input;
  }
}

/** `The URL must be of scheme file`. */
export class ERR_INVALID_URL_SCHEME extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_URL_SCHEME";

  constructor(expected: string | readonly string[]) {
    const list = typeof expected === "string" ? [expected] : expected;
    const wanted =
      list.length === 2 ? `one of scheme ${list[0]} or ${list[1]}` : `of scheme ${list[0]}`;
    super(`The URL must be ${wanted}`);
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

/** A peer closed an established connection before its message completed. */
export class ConnResetException extends Error {
  readonly code = "ECONNRESET";

  override get ["constructor"](): unknown {
    return Error;
  }

  constructor(message: string) {
    super(message);
    this.name = "Error";
  }
}

/**
 * A class the program is given an instance of but may not construct.
 *
 * The message says only `Illegal constructor`, matching what a browser throws
 * for the same mistake.
 */
export class ERR_ILLEGAL_CONSTRUCTOR extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_ILLEGAL_CONSTRUCTOR";

  constructor() {
    super("Illegal constructor");
  }
}

/**
 * A `defineProperty` an exotic object will not accept.
 *
 * `process.env` is the only user of this: it is backed by the real
 * environment, where a value is a string and nothing else. An accessor has
 * nowhere to live, and a non-writable or non-configurable property would be a
 * promise the environment cannot keep -- another process can change it.
 */
export class ERR_INVALID_OBJECT_DEFINE_PROPERTY extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_OBJECT_DEFINE_PROPERTY";

  constructor(message: string) {
    super(message);
  }
}

/** `Unknown signal: SIGBANANA`. */
export class ERR_UNKNOWN_SIGNAL extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_UNKNOWN_SIGNAL";

  constructor(signal: string) {
    super(`Unknown signal: ${signal}`);
  }
}

/** Only one capture callback may be installed at a time. */
export class ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET";

  constructor() {
    super(
      "`process.setupUncaughtExceptionCapture()` was called while a capture callback was already active",
    );
  }
}

/** A user or group name/id that the operating system cannot resolve. */
export class ERR_UNKNOWN_CREDENTIAL extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_UNKNOWN_CREDENTIAL";

  constructor(kind: "User" | "Group", value: number | string) {
    super(`${kind} identifier does not exist: ${value}`);
  }
}

/** The host cannot do this at all, as opposed to refusing this request. */
export class ERR_FEATURE_UNAVAILABLE_ON_PLATFORM extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM";

  constructor(feature: string) {
    super(
      `The feature ${feature} is unavailable on this platform, which is being used to run Node.js`,
    );
  }
}

/**
 * The `RangeError` twin of `ERR_INVALID_ARG_VALUE`.
 *
 * Same code, different base. Node uses it where the argument is the right
 * type but outside the range the call can act on -- a negative previous CPU
 * reading, say -- because `catch (e) { if (e instanceof RangeError) }` should
 * work for that and not for a type mistake.
 */
export class ERR_INVALID_ARG_VALUE_RANGE extends NodeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_INVALID_ARG_VALUE";

  constructor(name: string, value: unknown, reason = "is invalid") {
    const kind = name.includes(".") ? "property" : "argument";
    super(`The ${kind} '${name}' ${reason}. Received ${inspectValue(value)}`);
  }
}

/** A whole-file read cannot be represented by libuv's signed I/O length. */
export class ERR_FS_FILE_TOO_LARGE extends NodeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_FS_FILE_TOO_LARGE";

  constructor(size: number) {
    super(`File size (${size}) is greater than 2 GiB`);
  }
}

/** The promised fs watcher could not buffer another pending event. */
export class ERR_FS_WATCH_QUEUE_OVERFLOW extends NodeError {
  override readonly code = "ERR_FS_WATCH_QUEUE_OVERFLOW";

  constructor(maxQueue: number) {
    super(`fs.watch() queued more than ${maxQueue} events`);
  }
}

/** A callback that was already called, called again. */
export class ERR_MULTIPLE_CALLBACK extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_MULTIPLE_CALLBACK";

  constructor() {
    super("Callback called multiple times");
  }
}

/** A caught non-Error value promoted to Node's ordinary operation failure. */
export class ERR_OPERATION_FAILED extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_OPERATION_FAILED";

  constructor(reason: string) {
    super(`Operation failed: ${reason}`);
  }
}

/**
 * Two errors where one is expected.
 *
 * A stream can fail twice -- once in its own `_destroy` and once in what it
 * was destroying because of -- and the caller is given one `error`. Dropping
 * either loses the one that explains the other, so both are kept: an
 * `AggregateError` carrying the outer error's message and code, so a program
 * matching on `err.code` still matches while `err.errors` has the detail.
 *
 * Already-aggregated errors accumulate rather than nest, or a chain of five
 * failures would be five levels deep for no gain.
 */
export function aggregateTwoErrors(inner: unknown, outer: unknown): unknown {
  if (inner && outer && inner !== outer) {
    if (outer instanceof AggregateError) {
      const errors: unknown = outer.errors;
      if (Array.isArray(errors)) errors.push(inner);
      return outer;
    }
    const message = outer instanceof Error ? outer.message : undefined;
    const aggregate = new NodeAggregateError([outer, inner], message, knownErrorCode(outer));
    captureStackTrace(aggregate, aggregateTwoErrors);
    return aggregate;
  }
  return inner || outer;
}

/** An AggregateError whose Node error code remains visible to callers. */
class NodeAggregateError extends AggregateError {
  readonly code: string | undefined;

  constructor(errors: readonly unknown[], message: string | undefined, code: string | undefined) {
    super(errors, message);
    this.code = code;
  }
}

function knownErrorCode(value: unknown): string | undefined {
  if (
    value instanceof NodeError ||
    value instanceof NodeTypeError ||
    value instanceof NodeRangeError ||
    value instanceof NodeURIError ||
    value instanceof NodeAggregateError
  ) {
    return value.code;
  }
  return undefined;
}

// The stream errors. Node keeps these in one table with a printf-style
// template; here each is a class, so the arguments a message needs are the
// constructor's parameters and cannot be forgotten at a call site.

/** A subclass did not provide a method the base class requires. */
export class ERR_METHOD_NOT_IMPLEMENTED extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_METHOD_NOT_IMPLEMENTED";

  constructor(name: string) {
    super(`The ${name} method is not implemented`);
  }
}

/** `Cannot pipe, not readable`. A `Writable` inherits `pipe` and refuses it. */
export class ERR_STREAM_CANNOT_PIPE extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_STREAM_CANNOT_PIPE";

  constructor() {
    super("Cannot pipe, not readable");
  }
}

export class ERR_STREAM_DESTROYED extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_STREAM_DESTROYED";

  constructor(name: string) {
    super(`Cannot call ${name} after a stream was destroyed`);
  }
}

export class ERR_STREAM_ALREADY_FINISHED extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_STREAM_ALREADY_FINISHED";

  constructor(name: string) {
    super(`Cannot call ${name} after a stream was finished`);
  }
}

/**
 * `May not write null values to stream`.
 *
 * A `TypeError` rather than an `Error`, because `null` is the end-of-stream
 * marker on the readable side and writing it is a category mistake rather than
 * a runtime condition.
 */
export class ERR_STREAM_NULL_VALUES extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_STREAM_NULL_VALUES";

  constructor() {
    super("May not write null values to stream");
  }
}

export class ERR_STREAM_WRITE_AFTER_END extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_STREAM_WRITE_AFTER_END";

  constructor() {
    super("write after end");
  }
}

/** The stream closed before it said it was done. */
export class ERR_STREAM_PREMATURE_CLOSE extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_STREAM_PREMATURE_CLOSE";

  constructor() {
    super("Premature close");
  }
}

export class ERR_STREAM_PUSH_AFTER_EOF extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_STREAM_PUSH_AFTER_EOF";

  constructor() {
    super("stream.push() after EOF");
  }
}

export class ERR_STREAM_UNSHIFT_AFTER_END_EVENT extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_STREAM_UNSHIFT_AFTER_END_EVENT";

  constructor() {
    super("stream.unshift() after end event");
  }
}

export class ERR_STREAM_UNABLE_TO_PIPE extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_STREAM_UNABLE_TO_PIPE";

  constructor() {
    super("Cannot pipe to a closed or destroyed stream");
  }
}

/** A brotli parameter key the library does not have. */
export class ERR_BROTLI_INVALID_PARAM extends NodeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_BROTLI_INVALID_PARAM";

  constructor(parameter: unknown) {
    super(`${parameter} is not a valid Brotli parameter`);
  }
}

/** A zstd parameter key the library does not have. */
export class ERR_ZSTD_INVALID_PARAM extends NodeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_ZSTD_INVALID_PARAM";

  constructor(parameter: unknown) {
    super(`${parameter} is not a valid zstd parameter`);
  }
}

/** An operation on a socket that has already been closed. */
export class ERR_SOCKET_CLOSED extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_SOCKET_CLOSED";

  constructor() {
    super("Socket is closed");
  }
}

/** A socket was destroyed while its connection request was still pending. */
export class ERR_SOCKET_CLOSED_BEFORE_CONNECTION extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_SOCKET_CLOSED_BEFORE_CONNECTION";

  constructor() {
    super("Socket closed before the connection was established");
  }
}

/** A role-neutral bound handle transfers to exactly one server or socket. */
export class ERR_SOCKET_HANDLE_ADOPTED extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_SOCKET_HANDLE_ADOPTED";

  constructor() {
    super("The bound socket has already been adopted by a server or socket");
  }
}

/** A reset was requested for a non-TCP transport. */
export class ERR_INVALID_HANDLE_TYPE extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_HANDLE_TYPE";

  constructor() {
    super("This handle type cannot be sent");
  }
}

/** A destination address was rejected by a net.BlockList. */
export class ERR_IP_BLOCKED extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_IP_BLOCKED";

  constructor(address: string) {
    super(`IP(${address}) is blocked by net.BlockList`);
  }
}

/** A header changed after the head was already on the wire. */
export class ERR_HTTP_HEADERS_SENT extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_HTTP_HEADERS_SENT";

  constructor(action: string) {
    super(`Cannot ${action} headers after they are sent to the client`);
  }
}

/** A HEAD response or bodyless status was given payload bytes under strict policy. */
export class ERR_HTTP_BODY_NOT_ALLOWED extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_HTTP_BODY_NOT_ALLOWED";

  constructor() {
    super("Adding content for this request method or response status is not allowed.");
  }
}

/** Strict HTTP body bytes do not match the declared Content-Length. */
export class ERR_HTTP_CONTENT_LENGTH_MISMATCH extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_HTTP_CONTENT_LENGTH_MISMATCH";

  constructor(actual: number, expected: number) {
    super(
      `Response body's content-length of ${actual} byte(s) does not match the content-length of ${expected} byte(s) set in header`,
    );
  }
}

/** Trailers require chunked framing so the recipient can locate them. */
export class ERR_HTTP_TRAILER_INVALID extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_HTTP_TRAILER_INVALID";

  constructor() {
    super("Trailers are invalid with this transfer encoding");
  }
}

function formatInvalidStatusCode(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[${value.join(", ")}]`;
  }
  if (value !== null && typeof value === "object") return "{}";
  return String(value);
}

/** An HTTP response status outside Node's accepted three-digit range. */
export class ERR_HTTP_INVALID_STATUS_CODE extends NodeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_HTTP_INVALID_STATUS_CODE";

  constructor(statusCode: unknown) {
    super(`Invalid status code: ${formatInvalidStatusCode(statusCode)}`);
  }
}

/** `undefined` is never a meaningful serialized HTTP header value. */
export class ERR_HTTP_INVALID_HEADER_VALUE extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_HTTP_INVALID_HEADER_VALUE";

  constructor(value: unknown, name: string) {
    super(`Invalid value "${String(value)}" for header "${name}"`);
  }
}

/** A transport cannot carry two server responses at the same time. */
export class ERR_HTTP_SOCKET_ASSIGNED extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_HTTP_SOCKET_ASSIGNED";

  constructor() {
    super("ServerResponse has an already assigned socket");
  }
}

/** HTTP parses bytes itself, so its transport cannot decode them into strings. */
export class ERR_HTTP_SOCKET_ENCODING extends NodeError {
  override get ["constructor"](): unknown {
    return Error;
  }
  override readonly code = "ERR_HTTP_SOCKET_ENCODING";

  constructor() {
    super("Changing the socket encoding is not allowed per RFC7230 Section 3.");
  }
}

/** A string option was missing a value, or a boolean option was given one. */
export class ERR_PARSE_ARGS_INVALID_OPTION_VALUE extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_PARSE_ARGS_INVALID_OPTION_VALUE";

  constructor(message: string) {
    super(message);
  }
}

/** A positional was supplied to a command that accepts only named options. */
export class ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL";

  constructor(value: string) {
    super(`Unexpected argument '${value}'. This command does not take positional arguments`);
  }
}

/** An option was not present in the caller's strict option declaration. */
export class ERR_PARSE_ARGS_UNKNOWN_OPTION extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_PARSE_ARGS_UNKNOWN_OPTION";

  constructor(option: string, allowPositionals: boolean) {
    const positionalHint = allowPositionals
      ? ". To specify a positional argument starting with a '-', place it at the end " +
        `of the command after '--', as in '-- ${quoteJSONString(option)}`
      : "";
    super(`Unknown option '${option}'${positionalHint}`);
  }
}

/** An environment proxy URL could not be parsed safely. */
export class ERR_PROXY_INVALID_CONFIG extends NodeError {
  override readonly code = "ERR_PROXY_INVALID_CONFIG";

  constructor(message: string) {
    super(message);
  }
}

/** Text contains a character forbidden by the protocol field. */
export class ERR_INVALID_CHAR extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_CHAR";

  constructor(name: string, field?: string) {
    super(
      field === undefined
        ? `Invalid character in ${name}`
        : `Invalid character in ${name} ["${field}"]`,
    );
  }
}

/** A URL component contains bytes that must be percent-escaped. */
export class ERR_UNESCAPED_CHARACTERS extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_UNESCAPED_CHARACTERS";

  constructor(name: string) {
    super(`${name} contains unescaped characters`);
  }
}

/**
 * A header name or value containing something a header may not contain.
 *
 * The value case is the important one: a newline in a header value is response
 * splitting, and this is the check that stops a program which echoes user
 * input into a header from becoming exploitable.
 */
export class ERR_INVALID_HTTP_TOKEN extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_HTTP_TOKEN";

  constructor(what: string, token: string) {
    super(`${what} must be a valid HTTP token ["${token}"]`);
  }
}

export class ERR_INVALID_THIS extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_THIS";

  constructor(type: string) {
    super(`Value of "this" must be of type ${type}`);
  }
}

/** `Each query pair must be an iterable [name, value] tuple`. */
export class ERR_INVALID_TUPLE extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_TUPLE";

  constructor(name: string, reason: string) {
    super(`Each ${name} must be ${reason}`);
  }
}

/** `Attempt to access memory outside buffer bounds`. */
export class ERR_BUFFER_OUT_OF_BOUNDS extends NodeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_BUFFER_OUT_OF_BOUNDS";

  constructor(name?: string) {
    super(
      name === undefined
        ? "Attempt to access memory outside buffer bounds"
        : `"${name}" is outside of buffer bounds`,
    );
  }
}

/** `Buffer size must be a multiple of 16-bits`. */
export class ERR_INVALID_BUFFER_SIZE extends NodeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_INVALID_BUFFER_SIZE";

  constructor(unit: string) {
    super(`Buffer size must be a multiple of ${unit}`);
  }
}

/** `Cannot create a Buffer larger than 64 bytes`. */
export class ERR_BUFFER_TOO_LARGE extends NodeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_BUFFER_TOO_LARGE";

  constructor(maximum: number) {
    super(`Cannot create a Buffer larger than ${maximum} bytes`);
  }
}

/** `Trailing junk found after the end of the compressed stream`. */
export class ERR_TRAILING_JUNK_AFTER_STREAM_END extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_TRAILING_JUNK_AFTER_STREAM_END";

  constructor() {
    super("Trailing junk found after the end of the compressed stream");
  }
}

/**
 * `hook.init must be a function` -- a bad callback given to `createHook`.
 *
 * Checked at `createHook` rather than at the call, because a hook that throws
 * has nowhere to throw to: it runs between a resource being created and the
 * code that created it, so an error there is a fatal condition rather than
 * something the caller could catch.
 */
export class ERR_ASYNC_CALLBACK extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_ASYNC_CALLBACK";

  constructor(name: string) {
    super(`${name} must be a function`);
  }
}

/** `Invalid name for async "type": ` — an `AsyncResource` with an empty type. */
export class ERR_ASYNC_TYPE extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_ASYNC_TYPE";

  constructor(type: unknown) {
    super(`Invalid name for async "type": ${String(type)}`);
  }
}

/**
 * `Invalid triggerAsyncId value: -2`.
 *
 * A `RangeError` rather than a `TypeError` because the ids that fail this are
 * the right type and the wrong number: -1 means "none", 0 is the root, and
 * anything below -1 is not an id at all.
 */
export class ERR_INVALID_ASYNC_ID extends NodeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_INVALID_ASYNC_ID";

  constructor(name: string, value: unknown) {
    super(`Invalid ${name} value: ${String(value)}`);
  }
}

/**
 * `readline was closed` — an operation on an interface that is finished.
 *
 * An `Error` rather than a `TypeError`, because the arguments were fine: the
 * mistake is when it was called, not what with.
 */
export class ERR_USE_AFTER_CLOSE extends NodeError {
  override readonly code = "ERR_USE_AFTER_CLOSE";
  override get ["constructor"](): unknown {
    return Error;
  }

  constructor(name: string) {
    super(`${name} was closed`);
  }
}

/* --- datagram sockets ------------------------------------------------------
 *
 * A UDP socket has more states than a TCP one and most of these name a
 * transition it refused rather than a value it disliked -- which is why they
 * are plain `Error`s: nothing was passed wrongly, it was passed at the wrong
 * moment.
 */

/** `Socket is already bound` — `bind` on a socket that has one. */
export class ERR_SOCKET_ALREADY_BOUND extends NodeError {
  override readonly code = "ERR_SOCKET_ALREADY_BOUND";
  override get ["constructor"](): unknown {
    return Error;
  }

  constructor() {
    super("Socket is already bound");
  }
}

/** `Buffer size must be a positive integer`. */
export class ERR_SOCKET_BAD_BUFFER_SIZE extends NodeTypeError {
  override readonly code = "ERR_SOCKET_BAD_BUFFER_SIZE";
  override get ["constructor"](): unknown {
    return TypeError;
  }

  constructor() {
    super("Buffer size must be a positive integer");
  }
}

/** `Already connected` — a second `connect` on a connected datagram socket. */
export class ERR_SOCKET_DGRAM_IS_CONNECTED extends NodeError {
  override readonly code = "ERR_SOCKET_DGRAM_IS_CONNECTED";
  override get ["constructor"](): unknown {
    return Error;
  }

  constructor() {
    super("Already connected");
  }
}

/** `Not connected` — `remoteAddress` or a connected `send` without one. */
export class ERR_SOCKET_DGRAM_NOT_CONNECTED extends NodeError {
  override readonly code = "ERR_SOCKET_DGRAM_NOT_CONNECTED";
  override get ["constructor"](): unknown {
    return Error;
  }

  constructor() {
    super("Not connected");
  }
}

/** `Not running` — an operation on a socket whose handle has been closed. */
export class ERR_SOCKET_DGRAM_NOT_RUNNING extends NodeError {
  override readonly code = "ERR_SOCKET_DGRAM_NOT_RUNNING";
  override get ["constructor"](): unknown {
    return Error;
  }

  constructor() {
    super("Not running");
  }
}

/** `Server.listen()` was called again before the current handle was closed. */
export class ERR_SERVER_ALREADY_LISTEN extends NodeError {
  override readonly code = "ERR_SERVER_ALREADY_LISTEN";
  override get ["constructor"](): unknown {
    return Error;
  }

  constructor() {
    super("Listen method has been called more than once without closing.");
  }
}

/** `Bad socket type specified. Valid types are: udp4, udp6`. */
export class ERR_SOCKET_BAD_TYPE extends NodeTypeError {
  override readonly code = "ERR_SOCKET_BAD_TYPE";
  override get ["constructor"](): unknown {
    return TypeError;
  }

  constructor() {
    super("Bad socket type specified. Valid types are: udp4, udp6");
  }
}

/**
 * `Port should be >= 0 and < 65536. Received 70000.`
 *
 * A `RangeError`, and `allowZero` changes the operator rather than the
 * sentence: zero means "any free port" where a socket may ask for one, and
 * means nothing where it may not.
 */
export class ERR_SOCKET_BAD_PORT extends NodeRangeError {
  override readonly code = "ERR_SOCKET_BAD_PORT";
  override get ["constructor"](): unknown {
    return RangeError;
  }

  constructor(name: string, port: unknown, allowZero = true) {
    super(
      `${name} should be ${allowZero ? ">=" : ">"} 0 and < 65536. ` +
        `Received ${inspectValue(port)}.`,
    );
  }
}

/** `Invalid IP address: value` returned by a socket lookup callback. */
export class ERR_INVALID_IP_ADDRESS extends NodeTypeError {
  override readonly code = "ERR_INVALID_IP_ADDRESS";
  override get ["constructor"](): unknown {
    return TypeError;
  }

  constructor(address: unknown) {
    super(`Invalid IP address: ${String(address)}`);
  }
}

/** `Invalid address family: family host:port` from a socket lookup result. */
export class ERR_INVALID_ADDRESS_FAMILY extends NodeRangeError {
  override readonly code = "ERR_INVALID_ADDRESS_FAMILY";
  override get ["constructor"](): unknown {
    return RangeError;
  }
  readonly host: string;
  readonly port: number;

  constructor(addressFamily: unknown, host: string, port: number) {
    super(`Invalid address family: ${String(addressFamily)} ${host}:${port}`);
    this.host = host;
    this.port = port;
  }
}

/**
 * `-1 is not a valid timestamp`: a negative mark time, or a negative number
 * named where `performance.measure` wants a mark.
 */
export class ERR_PERFORMANCE_INVALID_TIMESTAMP extends NodeTypeError {
  override readonly code = "ERR_PERFORMANCE_INVALID_TIMESTAMP";
  override get ["constructor"](): unknown {
    return TypeError;
  }

  constructor(timestamp: number) {
    super(`${timestamp} is not a valid timestamp`);
  }
}

/** A `performance.measure` options bag whose fields contradict each other. */
export class ERR_PERFORMANCE_MEASURE_INVALID_OPTIONS extends NodeTypeError {
  override readonly code = "ERR_PERFORMANCE_MEASURE_INVALID_OPTIONS";
  override get ["constructor"](): unknown {
    return TypeError;
  }

  constructor(message: string) {
    super(message);
  }
}

/**
 * `ERR_OUT_OF_RANGE` as a binding throws it: the code, and a bare message with
 * none of the template's `The value of ... It must be ... Received`. The
 * `RangeError` twin of `ERR_INVALID_ARG_TYPE_BINDING`, for the same reason.
 * A histogram's `record(0n)` is `value is out of range`, because node's
 * C++ checks the bigint after the JavaScript let it through.
 */
export class ERR_OUT_OF_RANGE_BINDING extends NativeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_OUT_OF_RANGE";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Node's `internal/assert` failing: a condition node's own code relies on did
 * not hold. The message asks for a bug report, because by construction a
 * caller should not be able to reach it.
 */
export class ERR_INTERNAL_ASSERTION extends NodeError {
  override readonly code = "ERR_INTERNAL_ASSERTION";

  constructor(message?: string) {
    const suffix =
      "This is caused by either a bug in Node.js or incorrect usage of Node.js internals.\n" +
      "Please open an issue with this stack trace at https://github.com/nodejs/node/issues\n";
    super(message === undefined ? suffix : `${message}\n${suffix}`);
  }
}

/**
 * `c-ares failed to set servers: "There are pending queries." [ '1.2.3.4' ]`:
 * the resolver refused a new server list, with c-ares's reason and the list as
 * the caller gave it.
 */
export class ERR_DNS_SET_SERVERS_FAILED extends NodeError {
  override readonly code = "ERR_DNS_SET_SERVERS_FAILED";

  constructor(reason: string, servers: readonly string[]) {
    super(`c-ares failed to set servers: "${reason}" [${inspectValue(servers)}]`);
  }
}

/**
 * `ERR_INVALID_ARG_VALUE` as a binding throws it, with a bare message and none
 * of the template's `The argument ... Received`: the resolver's
 * `setLocalAddress` validates in C++ and says only `Invalid IP address.`.
 */
export class ERR_INVALID_ARG_VALUE_BINDING extends NativeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_INVALID_ARG_VALUE";

  constructor(message: string) {
    super(message);
  }
}

// -- node:crypto --------------------------------------------------------------

/** `Digest already called`: a `Hash` read once is finished. */
export class ERR_CRYPTO_HASH_FINALIZED extends NodeError {
  override readonly code = "ERR_CRYPTO_HASH_FINALIZED";

  constructor() {
    super("Digest already called");
  }
}

/** `Hash update failed`: OpenSSL refused input to a live context. */
export class ERR_CRYPTO_HASH_UPDATE_FAILED extends NodeError {
  override readonly code = "ERR_CRYPTO_HASH_UPDATE_FAILED";

  constructor() {
    super("Hash update failed");
  }
}

/** `Invalid digest: md55`, from the KDFs, `Hmac` and the one-shot signatures, all of which node checks in C++. */
export class ERR_CRYPTO_INVALID_DIGEST extends NativeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_CRYPTO_INVALID_DIGEST";

  constructor(digest: string) {
    super(`Invalid digest: ${digest}`);
  }
}

/**
 * `ERR_CRYPTO_INVALID_DIGEST` in C++'s other words: `Sign` and `Verify` say only
 * `Invalid digest`, and RSA-PSS key generation `Invalid MGF1 digest: sha0`.
 */
export class ERR_CRYPTO_INVALID_DIGEST_BINDING extends NativeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_CRYPTO_INVALID_DIGEST";

  constructor(message = "Invalid digest") {
    super(message);
  }
}

/** `Invalid key length`: more HKDF output than 255 blocks of the digest can make. */
export class ERR_CRYPTO_INVALID_KEYLEN extends NativeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_CRYPTO_INVALID_KEYLEN";

  constructor(message = "Invalid key length") {
    super(message);
  }
}

/** A key that is not what the operation needs, in C++'s words: `Supplied key is invalid`. */
export class ERR_CRYPTO_INVALID_KEYTYPE extends NativeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_CRYPTO_INVALID_KEYTYPE";

  constructor(message = "Invalid key type") {
    super(message);
  }
}

/** `Invalid key pair`: an ECDH object whose keys do not belong together. */
export class ERR_CRYPTO_INVALID_KEYPAIR extends NativeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_CRYPTO_INVALID_KEYPAIR";

  constructor() {
    super("Invalid key pair");
  }
}

/** `Invalid ECDH format: hybird`. */
export class ERR_CRYPTO_ECDH_INVALID_FORMAT extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_CRYPTO_ECDH_INVALID_FORMAT";

  constructor(format: string) {
    super(`Invalid ECDH format: ${format}`);
  }
}

/** `Public key is not valid for specified curve`. */
export class ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY extends NodeError {
  override readonly code = "ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY";

  constructor() {
    super("Public key is not valid for specified curve");
  }
}

/** `Incompatible key types for Diffie-Hellman: ec and dh`. */
export class ERR_CRYPTO_INCOMPATIBLE_KEY extends NodeError {
  override readonly code = "ERR_CRYPTO_INCOMPATIBLE_KEY";

  constructor(name: string, detail: string) {
    super(`Incompatible ${name}: ${detail}`);
  }
}

/**
 * `Invalid scrypt params`, with OpenSSL's own reason after a colon when it gave
 * one -- node keeps this code rather than a decorated OpenSSL error, for
 * backward compatibility, and says so beside the throw.
 */
export class ERR_CRYPTO_INVALID_SCRYPT_PARAMS extends NativeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_CRYPTO_INVALID_SCRYPT_PARAMS";

  constructor(reason?: string) {
    super(reason === undefined ? "Invalid scrypt params" : `Invalid scrypt params: ${reason}`);
  }
}

/** `Input buffers must have the same byte length`, from `timingSafeEqual`. */
export class ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH extends NativeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH";

  constructor() {
    super("Input buffers must have the same byte length");
  }
}

/** `Invalid key object type public, expected secret.` */
export class ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE";

  constructor(actual: string, expected: string) {
    super(`Invalid key object type ${actual}, expected ${expected}.`);
  }
}

/** `Unknown cipher`, from C++, for a name OpenSSL does not know. */
export class ERR_CRYPTO_UNKNOWN_CIPHER extends NativeError {
  override readonly code = "ERR_CRYPTO_UNKNOWN_CIPHER";

  constructor() {
    super("Unknown cipher");
  }
}

/** `Invalid initialization vector`: the wrong length, or none where one is needed. */
export class ERR_CRYPTO_INVALID_IV extends NativeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_CRYPTO_INVALID_IV";

  constructor() {
    super("Invalid initialization vector");
  }
}

/** An authentication tag refused, in C++'s own words: `Invalid authentication tag length: 5`. */
export class ERR_CRYPTO_INVALID_AUTH_TAG extends NativeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_CRYPTO_INVALID_AUTH_TAG";

  constructor(message: string) {
    super(message);
  }
}

/** `Invalid message length`: more than CCM's nonce leaves room to count. */
export class ERR_CRYPTO_INVALID_MESSAGELEN extends NativeRangeError {
  override get ["constructor"](): unknown {
    return RangeError;
  }
  override readonly code = "ERR_CRYPTO_INVALID_MESSAGELEN";

  constructor() {
    super("Invalid message length");
  }
}

/**
 * `Invalid state for operation setAutoPadding`: a cipher asked for something
 * its state does not allow, as node's JavaScript words it. C++ throws the same
 * code with only `Invalid state`, which is `ERR_CRYPTO_INVALID_STATE_BINDING`.
 */
export class ERR_CRYPTO_INVALID_STATE extends NodeError {
  override readonly code = "ERR_CRYPTO_INVALID_STATE";

  constructor(operation: string) {
    super(`Invalid state for operation ${operation}`);
  }
}

/**
 * `Invalid state`, as C++ throws it: `final()` after `final()`. `Sign` and
 * `Verify` say why: `Not initialised`.
 */
export class ERR_CRYPTO_INVALID_STATE_BINDING extends NativeError {
  override readonly code = "ERR_CRYPTO_INVALID_STATE";

  constructor(message = "Invalid state") {
    super(message);
  }
}

/** A crypto operation that failed with nothing from OpenSSL to say why, in C++'s own words. */
export class ERR_CRYPTO_OPERATION_FAILED extends NativeError {
  override readonly code = "ERR_CRYPTO_OPERATION_FAILED";

  constructor(message = "Operation failed") {
    super(message);
  }
}

/** `Invalid digest used`: an OAEP hash OpenSSL does not know, as C++ words it. */
export class ERR_OSSL_EVP_INVALID_DIGEST extends NativeError {
  override readonly code = "ERR_OSSL_EVP_INVALID_DIGEST";

  constructor() {
    super("Invalid digest used");
  }
}

/** `Unknown DH group`: a group name OpenSSL has no prime for. */
export class ERR_CRYPTO_UNKNOWN_DH_GROUP extends NativeError {
  override readonly code = "ERR_CRYPTO_UNKNOWN_DH_GROUP";

  constructor() {
    super("Unknown DH group");
  }
}

/** `At least one of the group, prime, or primeLength options is required`. */
export class ERR_MISSING_OPTION extends NodeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_MISSING_OPTION";

  constructor(option: string) {
    super(`${option} is required`);
  }
}

/** `Argon2 algorithm not supported`: an OpenSSL older than 3.2. */
export class ERR_CRYPTO_ARGON2_NOT_SUPPORTED extends NodeError {
  override readonly code = "ERR_CRYPTO_ARGON2_NOT_SUPPORTED";

  constructor() {
    super("Argon2 algorithm not supported");
  }
}

/** `No key provided to sign`. */
export class ERR_CRYPTO_SIGN_KEY_REQUIRED extends NodeError {
  override readonly code = "ERR_CRYPTO_SIGN_KEY_REQUIRED";

  constructor() {
    super("No key provided to sign");
  }
}

/** An operation OpenSSL could do and node declines, in C++'s own words. */
export class ERR_CRYPTO_UNSUPPORTED_OPERATION extends NativeError {
  override readonly code = "ERR_CRYPTO_UNSUPPORTED_OPERATION";

  constructor(message: string) {
    super(message);
  }
}

/**
 * `ERR_MISSING_ARGS` as C++ throws it, with its own sentence rather than the
 * template's list: `options.plaintextLength required for CCM mode with AAD`.
 */
export class ERR_MISSING_ARGS_BINDING extends NativeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_MISSING_ARGS";

  constructor(message: string) {
    super(message);
  }
}

/** `The selected key encoding pkcs1 can only be used for RSA keys.` */
export class ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS extends NodeError {
  override readonly code = "ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS";

  constructor(encoding: string, problem: string) {
    super(`The selected key encoding ${encoding} ${problem}.`);
  }
}

/** The same code as C++ throws it for a raw import: `...is incompatible with the key type`. */
export class ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS_BINDING extends NativeError {
  override readonly code = "ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS";

  constructor() {
    super("The selected key encoding is incompatible with the key type");
  }
}

/**
 * A JWK that cannot be a key. JavaScript's default is `Invalid JWK data`; C++
 * throws its own words -- `Invalid JWK RSA key`, `Invalid JWK format` -- which
 * are passed in.
 */
export class ERR_CRYPTO_INVALID_JWK extends NativeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_CRYPTO_INVALID_JWK";

  constructor(message = "Invalid JWK data") {
    super(message);
  }
}

/** `Unsupported JWK Key Type.`: a key JWK has no form for. */
export class ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE extends NativeError {
  override readonly code = "ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE";

  constructor() {
    super("Unsupported JWK Key Type.");
  }
}

/** `Unsupported JWK EC curve: secp224r1.` */
export class ERR_CRYPTO_JWK_UNSUPPORTED_CURVE extends NativeError {
  override readonly code = "ERR_CRYPTO_JWK_UNSUPPORTED_CURVE";

  constructor(message: string) {
    super(message);
  }
}

/** `Invalid EC curve name`. */
export class ERR_CRYPTO_INVALID_CURVE extends NativeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_CRYPTO_INVALID_CURVE";

  constructor() {
    super("Invalid EC curve name");
  }
}

/** `Passphrase required for encrypted key`. */
export class ERR_MISSING_PASSPHRASE extends NativeTypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  override readonly code = "ERR_MISSING_PASSPHRASE";

  constructor(message: string) {
    super(message);
  }
}
