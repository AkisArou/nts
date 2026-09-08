// The arbitrary-value half of clause 25.5: `SerializeJSONProperty` (25.5.4.2) over ordinary
// ECMAScript values, and the materialization of a parsed graph back into them.
//
// The rest of this module works over the erased graph, which is what §9 of the plan calls the
// generic representation and what a compiled target can carry. This file is the bridge to
// ordinary objects, and it exists because two boundaries genuinely take arbitrary values:
// `Response.json(data)` serializes whatever it is handed, and `response.json()` resolves to
// something the caller reads with `data.foo`. Neither is expressible over the graph.
//
// **This is the file the compiler cannot lower, and that is the honest place for the seam.**
// `Object.keys` over an arbitrary object and property creation on one are exactly the
// "arbitrary ordinary-object property maps" the plan keeps out of HIR. The answer the plan
// gives is direct typed materialization: at a typed boundary the compiler knows the shape and
// generates a parser that builds it, so neither function here is reached. Until that boundary
// exists these two are host-only, they are the only host-only part of the JSON implementation,
// and everything they are built from -- the escaper, the number formatter, the indent rules,
// the grammar -- is the shared code the compiled targets use.
//
// Both traversals carry an explicit work stack, for the reason the plan gives for the other
// two: a deeply nested value must not serialize on one target and kill the process on another.
import {
  CLOSE_BRACE,
  CLOSE_BRACKET,
  COMMA,
  isDigit,
  LOWER_F,
  LOWER_N,
  LOWER_T,
  MINUS,
  OPEN_BRACE,
  OPEN_BRACKET,
  QUOTE,
  readMemberKey,
  Scanner,
} from "./parse.ts";
import {
  assembleContainer,
  member as plainMemberText,
  numberText,
  quoteJSONString,
  resolveGap,
} from "./text.ts";
import { JsonValue } from "./value.ts";

/** 25.5.4.2's replacer, called with the holder as its `this`. */
export type PlainReplacer = (this: unknown, key: string, value: unknown) => unknown;

export interface PlainStringifyOptions {
  readonly replacer?: PlainReplacer | undefined;
  /** 25.5.4's array form of the replacer: an inclusion list that also fixes the order. */
  readonly propertyList?: readonly string[] | undefined;
  readonly space?: number | string | undefined;
}

/**
 * 25.5.4.2 step 4: a boxed primitive is unwrapped before it is classified.
 *
 * `Object.prototype.toString` rather than `instanceof`, because `instanceof` compares against
 * one realm's constructor and a value that crossed a realm boundary would be missed -- and a
 * missed `new Number(1)` does not fail loudly, it serializes as `{}`.
 */
function unwrapBoxed(value: object): unknown {
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object Number]") return Number(value);
  if (tag === "[object String]") return String(value);
  if (tag === "[object Boolean]") return Boolean(value.valueOf());
  if (tag === "[object BigInt]") return value.valueOf();
  return value;
}

function isRawJsonNode(value: unknown): value is JsonValue {
  return value instanceof JsonValue && value.kind === "raw";
}

/**
 * 25.5.4.2 steps 2 through 4: `toJSON`, then the replacer, then unwrapping.
 *
 * The order is the specification's and it is observable: `toJSON` runs first, so a replacer
 * sees what `toJSON` returned rather than the original object. Reversing them changes what a
 * `Date` is handed to a replacer as.
 */
function transformValue(
  holder: unknown,
  key: string,
  initial: unknown,
  replacer: PlainReplacer | undefined,
): unknown {
  let value = initial;
  if ((typeof value === "object" && value !== null) || typeof value === "bigint") {
    // `GetV`, so a `toJSON` inherited from a prototype counts -- which is how `Date` works,
    // since `toJSON` lives on `Date.prototype` and not on the instance.
    const toJSON: unknown = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") {
      value = (toJSON as (this: unknown, key: string) => unknown).call(value, key);
    }
  }
  if (replacer !== undefined) value = replacer.call(holder, key, value);
  if (typeof value === "object" && value !== null) value = unwrapBoxed(value);
  return value;
}

/**
 * The text of a value that is not a container, or `undefined` if it has no serialization.
 *
 * 25.5.4.2 step 11 returns `undefined` for anything left over -- `undefined` itself, a
 * function, a symbol -- which an object omits and an array renders as `null`.
 */
function plainScalarText(value: unknown): string | undefined {
  if (isRawJsonNode(value)) return value.text;
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "string") return quoteJSONString(value);
  if (typeof value === "number") return numberText(value);
  // 25.5.4.2 step 10. A BigInt has no JSON form and is an error rather than an omission,
  // because silently dropping a number is worse than refusing one.
  if (typeof value === "bigint") throw new TypeError("Do not know how to serialize a BigInt");
  return undefined;
}

/** One open container, and the members it has finished. */
class PlainFrame {
  readonly holder: object;
  readonly isArray: boolean;
  readonly keys: readonly string[];
  readonly length: number;
  readonly indent: string;
  readonly parts: string[] = [];
  index = 0;
  parentKey = "";

  constructor(holder: object, isArray: boolean, keys: readonly string[], indent: string) {
    this.holder = holder;
    this.isArray = isArray;
    this.keys = keys;
    this.length = isArray ? (holder as unknown[]).length : keys.length;
    this.indent = indent;
  }
}

/**
 * The keys an object contributes.
 *
 * `Object.keys` is `EnumerableOwnProperties(value, key)` from 25.5.4.5 step 5: own, enumerable,
 * string-keyed, in `OrdinaryOwnPropertyKeys` order -- integer indices ascending first, then the
 * rest in insertion order. A property list replaces it entirely and imposes its own order,
 * because 25.5.4.5 walks the list rather than the object.
 */
function plainKeys(holder: object, propertyList: readonly string[] | undefined): readonly string[] {
  return propertyList === undefined ? Object.keys(holder) : propertyList;
}

function assemblePlain(frame: PlainFrame, gap: string): string {
  return assembleContainer(frame.parts, frame.isArray, frame.indent, gap);
}

function plainMember(key: string, text: string, gap: string): string {
  return plainMemberText(key, text, gap);
}

/**
 * 25.5.4 `JSON.stringify` over an arbitrary value.
 *
 * Returns `undefined` when the value has no serialization at all, which is what the real
 * `JSON.stringify(Symbol())` returns and what WebIDL's "serialize a JavaScript value to JSON
 * bytes" turns into a `TypeError`.
 */
export function stringifyPlain(
  value: unknown,
  options: PlainStringifyOptions = {},
): string | undefined {
  const gap = resolveGap(options.space);
  const replacer = options.replacer;
  const propertyList = options.propertyList;

  // 25.5.4 step 12: the value is serialized as the sole property of a wrapper whose key is the
  // empty string, which is why a replacer is called for the root at all.
  const wrapper: Record<string, unknown> = { "": value };
  const root = transformValue(wrapper, "", value, replacer);

  if (!isContainer(root)) return plainScalarText(root);

  // 25.5.4.5 step 1 and 25.5.4.6 step 1: a container already on the stack is a cycle. Held as
  // an array and searched linearly -- the stack is the nesting depth, not the document size.
  const open: object[] = [];
  const frames: PlainFrame[] = [];
  pushContainer(frames, open, root, "", "", propertyList);

  for (;;) {
    const frame = frames[frames.length - 1] as PlainFrame;

    if (frame.index < frame.length) {
      const key = frame.isArray ? String(frame.index) : (frame.keys[frame.index] as string);
      frame.index++;
      // A plain member read. A throwing getter throws from here, which is what propagates a
      // user error out of `Response.json` rather than turning it into a serialization failure.
      const raw: unknown = (frame.holder as Record<string, unknown>)[key];
      const child = transformValue(frame.holder, key, raw, replacer);

      if (isContainer(child)) {
        pushContainer(frames, open, child, key, frame.indent + gap, propertyList);
        continue;
      }
      const text = plainScalarText(child);
      if (text === undefined) {
        // 25.5.4.6 step 8: an array element with no serialization is `null`. 25.5.4.5 skips it.
        if (frame.isArray) frame.parts.push("null");
        continue;
      }
      frame.parts.push(frame.isArray ? text : plainMember(key, text, gap));
      continue;
    }

    const finished = assemblePlain(frame, gap);
    frames.pop();
    open.pop();
    if (frames.length === 0) return finished;
    const parent = frames[frames.length - 1] as PlainFrame;
    parent.parts.push(
      parent.isArray ? finished : plainMember(frame.parentKey, finished, gap),
    );
  }
}

/** A value 25.5.4.2 step 10 sends to `SerializeJSONObject` or `SerializeJSONArray`. */
function isContainer(value: unknown): value is object {
  if (isRawJsonNode(value)) return false;
  // "is an Object and is not callable" -- a function is omitted rather than serialized as `{}`.
  return typeof value === "object" && value !== null;
}

function pushContainer(
  frames: PlainFrame[],
  open: object[],
  value: object,
  parentKey: string,
  indent: string,
  propertyList: readonly string[] | undefined,
): void {
  if (open.indexOf(value) >= 0) {
    throw new TypeError("Converting circular structure to JSON");
  }
  const isArray = Array.isArray(value);
  const frame = new PlainFrame(value, isArray, isArray ? [] : plainKeys(value, propertyList), indent);
  frame.parentKey = parentKey;
  frames.push(frame);
  open.push(value);
}

/** One container being materialized, and the value being filled in. */
class MaterializeFrame {
  readonly node: JsonValue;
  readonly target: Record<string, unknown> | unknown[];
  readonly key: string;
  index = 0;

  constructor(node: JsonValue, target: Record<string, unknown> | unknown[], key: string) {
    this.node = node;
    this.target = target;
    this.key = key;
  }
}

function scalarOf(node: JsonValue): unknown {
  switch (node.kind) {
    case "null":
      return null;
    case "boolean":
      return node.boolean;
    case "number":
      return node.number;
    case "hole":
      // A reviver deleted this element. 25.5.2.4 leaves a hole, and reading one gives
      // `undefined` -- which is what an array with a genuine hole gives too.
      return undefined;
    case "raw":
      return node.text;
    default:
      return node.text;
  }
}

function containerFor(node: JsonValue): Record<string, unknown> | unknown[] {
  if (node.kind === "array") return new Array<unknown>(node.items.length);
  // A null prototype would be the safer object, but it is not what `JSON.parse` produces and
  // the difference is observable: `Object.getPrototypeOf(JSON.parse("{}"))` is `Object.prototype`.
  return {};
}

function place(target: Record<string, unknown> | unknown[], key: string, value: unknown): void {
  // `CreateDataPropertyOrThrow`. Assignment produces exactly that on a freshly built object --
  // an own data property, writable, enumerable and configurable -- for every key but one.
  // `__proto__` is the exception, and the only one: `Object.prototype` declares an accessor for
  // it, so assigning would invoke the inherited setter and change the prototype instead of
  // creating a property, and `JSON.parse('{"__proto__":1}')` would come back with no own key.
  //
  // The distinction used to be paid for on every member. `defineProperty` was 16% of the time
  // in a parse-heavy profile -- the largest single cost in the module -- for a rule that
  // applies to one key name.
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return;
  }
  (target as Record<string, unknown>)[key] = value;
}

/**
 * A parsed graph as ordinary ECMAScript values.
 *
 * The inverse of {@link stringifyPlain} and the other half of the host-only seam: this is what
 * makes `await response.json()` resolve to something a caller reads with `data.foo`. A typed
 * boundary replaces it, because there the compiler builds the result type directly instead of
 * building a graph and walking it again.
 */
export function toPlainValue(node: JsonValue): unknown {
  if (node.kind !== "array" && node.kind !== "object") return scalarOf(node);

  const root = containerFor(node);
  const frames: MaterializeFrame[] = [new MaterializeFrame(node, root, "")];

  for (;;) {
    const frame = frames[frames.length - 1] as MaterializeFrame;
    const isArray = frame.node.kind === "array";
    const count = isArray ? frame.node.items.length : frame.node.keys.length;

    if (frame.index < count) {
      const key = isArray ? String(frame.index) : (frame.node.keys[frame.index] as string);
      const child = (isArray ? frame.node.items[frame.index] : frame.node.values[frame.index]) as JsonValue;
      frame.index++;
      if (child.kind === "array" || child.kind === "object") {
        frames.push(new MaterializeFrame(child, containerFor(child), key));
        continue;
      }
      // A hole is an absence rather than an `undefined` member: the element is left unset so
      // the array keeps its length and the index stays empty, which is what deletion produced.
      if (child.kind === "hole") continue;
      place(frame.target, key, scalarOf(child));
      continue;
    }

    frames.pop();
    if (frames.length === 0) return frame.target;
    const parent = frames[frames.length - 1] as MaterializeFrame;
    place(parent.target, frame.key, frame.target);
  }
}

/** One open container while parsing straight into ordinary values. */
class PlainParseFrame {
  readonly target: Record<string, unknown> | unknown[];
  readonly isArray: boolean;
  pendingKey = "";

  constructor(target: Record<string, unknown> | unknown[], isArray: boolean) {
    this.target = target;
    this.isArray = isArray;
  }
}

/**
 * Parse JSON text straight into ordinary ECMAScript values.
 *
 * `toPlainValue(parseJsonText(text))` walks the document twice: once to build the erased graph
 * and once to turn it into objects. Nothing between those two passes is observable unless a
 * reviver is present -- and a reviver is the rare case. On a 1.67MB document the two-pass route
 * costs 23.681ms against a one-pass bound of 8.450ms, so this is worth having.
 *
 * **The scanner is shared, not copied.** Every token, every error message, every number
 * conversion and every escape comes from the same {@link Scanner} `parseJsonText` uses, and the
 * key reader is literally the same function. What differs is only what gets built, so the
 * surface where this can disagree with the canonical parser is the container handling below --
 * and `test/json-plain-parse.test.ts` holds the two against each other over the whole corpus.
 *
 * Key order needs no work: `OrdinaryOwnPropertyKeys` puts array-index keys first in ascending
 * numeric order and the rest in insertion order, which is what an ordinary object does natively.
 * A repeated key keeps its first position and its last value in both routes for the same reason.
 *
 * Host-only, like the rest of this file: it produces arbitrary objects.
 */
export function parsePlainText(text: string): unknown {
  const scanner = new Scanner(text);
  scanner.skipWhitespace();
  const value = readPlain(scanner);
  scanner.skipWhitespace();
  if (scanner.at < scanner.length) {
    throw scanner.fail(`Unexpected non-whitespace character after JSON data`);
  }
  return value;
}

/** The control flow of `readValue`, building ordinary values instead of graph nodes. */
function readPlain(scanner: Scanner): unknown {
  const frames: PlainParseFrame[] = [];
  for (;;) {
    scanner.skipWhitespace();
    const code = scanner.peek();
    let value: unknown;
    let opened = false;

    if (code === OPEN_BRACE) {
      scanner.at++;
      const target: Record<string, unknown> = {};
      const frame = new PlainParseFrame(target, false);
      frames.push(frame);
      scanner.skipWhitespace();
      if (scanner.peek() === CLOSE_BRACE) {
        scanner.at++;
        frames.pop();
        value = target;
      } else {
        frame.pendingKey = readMemberKey(scanner);
        opened = true;
        value = null;
      }
    } else if (code === OPEN_BRACKET) {
      scanner.at++;
      const target: unknown[] = [];
      const frame = new PlainParseFrame(target, true);
      frames.push(frame);
      scanner.skipWhitespace();
      if (scanner.peek() === CLOSE_BRACKET) {
        scanner.at++;
        frames.pop();
        value = target;
      } else {
        opened = true;
        value = null;
      }
    } else if (code === QUOTE) {
      value = scanner.readString();
    } else if (code === MINUS || isDigit(code)) {
      value = scanner.readNumber();
    } else if (code === LOWER_T) {
      scanner.expectWord("true");
      value = true;
    } else if (code === LOWER_F) {
      scanner.expectWord("false");
      value = false;
    } else if (code === LOWER_N) {
      scanner.expectWord("null");
      value = null;
    } else {
      throw scanner.fail(`Unexpected token ${scanner.describe()}`);
    }

    // A container was opened and its first member still has to be read.
    if (opened) continue;

    for (;;) {
      if (frames.length === 0) return value;
      const frame = frames[frames.length - 1] as PlainParseFrame;
      if (frame.isArray) {
        (frame.target as unknown[]).push(value);
      } else {
        place(frame.target, frame.pendingKey, value);
      }
      scanner.skipWhitespace();
      const next = scanner.peek();
      if (next === COMMA) {
        scanner.at++;
        if (!frame.isArray) frame.pendingKey = readMemberKey(scanner);
        break;
      }
      const closer = frame.isArray ? CLOSE_BRACKET : CLOSE_BRACE;
      if (next !== closer) {
        throw scanner.fail(
          frame.isArray
            ? `Expected ',' or ']' after array element`
            : `Expected ',' or '}' after property value`,
        );
      }
      scanner.at++;
      frames.pop();
      value = frame.target;
    }
  }
}
