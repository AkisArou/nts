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

/** `The "path" argument must be of type string. Received type number (42)`. */
export class ERR_INVALID_ARG_TYPE extends TypeError {
  readonly code = "ERR_INVALID_ARG_TYPE";

  constructor(name: string, expected: string, actual: unknown) {
    // node `lib/internal/errors.js:1390`, narrowed to a single expected type,
    // which is every use in the modules built so far. A list formats as
    // "one of type a or b" and belongs here when a caller needs one.
    const kind = name.includes(".") ? "property" : "argument";
    const subject = name.endsWith(" argument") ? `${name} ` : `"${name}" ${kind} `;
    const described = kTypes.includes(expected)
      ? `of type ${expected.toLowerCase()}`
      : `an instance of ${expected}`;
    super(`The ${subject}must be ${described}. Received ${determineSpecificType(actual)}`);
    this.name = "TypeError";
  }
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
