// Node's error codes, and the messages its own tests assert on.
//
// The message text is not decoration. `test-path.js` compares against a string
// built by `common.invalidArgTypeHelper`, so an error whose wording differs is
// a conformance failure even when the throw itself is correct. These are
// transcribed from node `lib/internal/errors.js`.
//
// Node attaches `code` to an ordinary `TypeError` and gives the class a name of
// the form `TypeError [ERR_INVALID_ARG_TYPE]`. We subclass instead, which is
// the same observable shape for `err.code`, `err.name` and `err.message`, and
// is what TypeScript can express without a class factory.

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

/**
 * What `util.inspect(value, { depth: -1 })` prints for a value with no
 * constructor: `[Object: null prototype] {}` and the like.
 *
 * A real `util.inspect` belongs in `node:util` and will replace this. Until
 * then this covers the shapes `determineSpecificType` can reach, which is
 * narrower than the general case: it is only called for an object whose
 * constructor is missing.
 */
function inspectShallow(value: unknown): string {
  if (Array.isArray(value)) {
    return "[Array]";
  }
  return "[Object: null prototype] {}";
}

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
export class ERR_INVALID_ARG_TYPE extends TypeError {
  readonly code = "ERR_INVALID_ARG_TYPE";

  constructor(name: string, expected: string | string[], actual: unknown) {
    // node `lib/internal/errors.js:1390`. Expected types split into the ones
    // `typeof` can name and the ones that are classes, because the two read
    // differently: "of type string" against "an instance of Buffer".
    const kind = name.includes(".") ? "property" : "argument";
    const subject = name.endsWith(" argument") ? `${name} ` : `"${name}" ${kind} `;

    const wanted = Array.isArray(expected) ? expected : [expected];
    const types: string[] = [];
    const instances: string[] = [];
    for (const one of wanted) {
      if (kTypes.includes(one)) {
        types.push(one.toLowerCase());
      } else {
        instances.push(one);
      }
    }

    let described = "";
    if (types.length > 0) {
      described += `${types.length > 1 ? "one of type" : "of type"} ${formatList(types)}`;
      if (instances.length > 0) {
        described += " or ";
      }
    }
    if (instances.length > 0) {
      described += `an instance of ${formatList(instances)}`;
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
export class ERR_OUT_OF_RANGE extends RangeError {
  readonly code = "ERR_OUT_OF_RANGE";

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
export class ERR_INVALID_ARG_VALUE extends TypeError {
  readonly code = "ERR_INVALID_ARG_VALUE";

  constructor(name: string, value: unknown, reason = "is invalid") {
    const kind = name.includes(".") ? "property" : "argument";
    super(`The ${kind} '${name}' ${reason}. Received ${determineSpecificType(value)}`);
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
export class ERR_UNHANDLED_ERROR extends Error {
  readonly code = "ERR_UNHANDLED_ERROR";
  context: unknown;

  constructor(err?: string) {
    super(`Unhandled error.${err === undefined ? "" : ` (${err})`}`);
    this.name = "Error";
  }
}

/** `URI malformed` — a lone surrogate, which has no UTF-8 encoding. */
export class ERR_INVALID_URI extends URIError {
  readonly code = "ERR_INVALID_URI";

  constructor() {
    super("URI malformed");
    this.name = "URIError";
  }
}

/** `Unknown encoding: utf9`. */
export class ERR_UNKNOWN_ENCODING extends TypeError {
  readonly code = "ERR_UNKNOWN_ENCODING";

  constructor(encoding: string) {
    super(`Unknown encoding: ${encoding}`);
    this.name = "TypeError";
  }
}
