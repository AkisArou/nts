// The public `JSON` surface, from clause 25.5 of the pinned specification text.
//
// `JSON.parse` (25.5.2) with its reviver and `context.source`, `JSON.stringify` (25.5.4) with
// its replacer and `space`, `JSON.rawJSON` (25.5.3) and `JSON.isRawJSON` (25.5.1).
//
// The values here are the erased graph rather than arbitrary ECMAScript objects, which is the
// architecture §9 of the plan describes: a generic result "can be carried, narrowed,
// validated, reviver-transformed and stringified" without introducing ordinary-object
// property maps into HIR. So a reviver receives and returns a `JsonValue`, and `toJSON` — a
// method looked up on an arbitrary object — has no meaning over a graph and is not part of
// this entry point. It belongs to the typed boundary, where the compiler can see the object.
import { parseJsonText } from "./parse.ts";
import { resolveGap, stringifyJsonValue } from "./stringify.ts";
import { JsonValue } from "./value.ts";

/**
 * What a reviver is told about the value it is being handed.
 *
 * 25.5.2.4 gives `source` only when the value is **not an Object** and is still the one the
 * parse produced. An array or object never carries it, because its source text is not a
 * meaningful thing to hand back — the reviver may already have replaced its children.
 */
export interface JsonReviveContext {
  readonly source?: string;
}

/** Returns `undefined` to delete the property, per 25.5.2.4. */
export type JsonReviver = (
  key: string,
  value: JsonValue,
  context: JsonReviveContext,
) => JsonValue | undefined;

/** One container being revived, holding the children that have survived so far. */
class ReviveFrame {
  readonly node: JsonValue;
  readonly key: string;
  readonly items: JsonValue[] = [];
  readonly keys: string[] = [];
  readonly values: JsonValue[] = [];
  index = 0;

  constructor(node: JsonValue, key: string) {
    this.node = node;
    this.key = key;
  }
}

function reviveScalar(
  key: string,
  node: JsonValue,
  reviver: JsonReviver,
  text: string,
): JsonValue | undefined {
  // 25.5.2.4 step 3: a non-Object that is still the parsed value gets its source text. Every
  // node here is still the parsed value, because nothing has replaced it yet — the reviver
  // runs bottom-up and a parent is only reached after its children.
  return reviver(key, node, { source: text.slice(node.start, node.end) });
}

/**
 * 25.5.2 steps 5-9 and 25.5.2.4, iteratively.
 *
 * Children are revived before their parent, which is the order the recursion in 25.5.2.4
 * produces and the order a reviver depends on: by the time it sees an object, that object's
 * members have already been through it.
 */
function internalize(root: JsonValue, reviver: JsonReviver, text: string): JsonValue | undefined {
  if (root.kind !== "array" && root.kind !== "object") {
    return reviveScalar("", root, reviver, text);
  }

  const frames: ReviveFrame[] = [new ReviveFrame(root, "")];
  for (;;) {
    const frame = frames[frames.length - 1] as ReviveFrame;
    const isArray = frame.node.kind === "array";
    const count = isArray ? frame.node.items.length : frame.node.keys.length;

    if (frame.index < count) {
      const key = isArray ? String(frame.index) : (frame.node.keys[frame.index] as string);
      const child = (isArray ? frame.node.items[frame.index] : frame.node.values[frame.index]) as JsonValue;
      frame.index++;
      if (child.kind === "array" || child.kind === "object") {
        frames.push(new ReviveFrame(child, key));
        continue;
      }
      const revived = reviveScalar(key, child, reviver, text);
      record(frame, key, revived, isArray);
      continue;
    }

    const rebuilt = isArray
      ? JsonValue.arrayValue(frame.items, frame.node.start, frame.node.end)
      : JsonValue.objectValue(frame.keys, frame.values, frame.node.start, frame.node.end);
    // A container never carries `source`: 25.5.2.4 only reaches the source branch for a
    // non-Object.
    const revived = reviver(frame.key, rebuilt, {});
    frames.pop();
    if (frames.length === 0) return revived;
    const parent = frames[frames.length - 1] as ReviveFrame;
    record(parent, frame.key, revived, parent.node.kind === "array");
  }
}

/**
 * Place a revived child, or record its absence.
 *
 * 25.5.2.4 *deletes* rather than splices: `value.[[Delete]](propertyKey)` on an array leaves a
 * hole and does not shorten it, so `JSON.parse("[1,2,3]", dropIndexOne)` still has three
 * elements and stringifies as `[1,null,3]`. An implementation that removed the element instead
 * would produce `[1,3]`, which is a different document and passes any test that only checks
 * the surviving values.
 */
function record(
  frame: ReviveFrame,
  key: string,
  revived: JsonValue | undefined,
  isArray: boolean,
): void {
  if (isArray) {
    frame.items.push(revived ?? JsonValue.holeValue());
    return;
  }
  if (revived === undefined) return;
  frame.keys.push(key);
  frame.values.push(revived);
}

/**
 * 25.5.2 `JSON.parse`.
 *
 * Without a reviver this is the parse alone; with one, every value is offered to it
 * bottom-up, and a value the reviver drops is deleted from its holder.
 */
export function jsonParse(text: string, reviver?: JsonReviver): JsonValue | undefined {
  const parsed = parseJsonText(text);
  if (reviver === undefined) return parsed;
  return internalize(parsed, reviver, text);
}

/**
 * The arguments `JSON.stringify` takes after the value.
 *
 * Spelled out rather than derived from {@link JsonSerializeOptions} with `Omit` and an
 * intersection: an intersection in a parameter position is not representable in this
 * lowering yet, and the explicit interface is the clearer declaration in any case.
 */
export interface JsonStringifyOptions {
  /** Returns `undefined` to omit the value; see 25.5.4.2. */
  readonly replacer?: ((key: string, value: JsonValue) => JsonValue | undefined) | undefined;
  /** An inclusion list for object keys, which also decides their order. */
  readonly propertyList?: readonly string[] | undefined;
  /** A number of spaces capped at ten, or a string truncated to ten characters. */
  readonly space?: number | string | undefined;
}

/**
 * 25.5.4 `JSON.stringify`.
 *
 * `space` is resolved here rather than by the caller — a number becomes that many spaces
 * capped at ten, a string is truncated to ten characters, and anything else is no gap.
 * Returns `undefined` when a replacer discards the root, which is what the standard's
 * `SerializeJSONProperty` returning `undefined` produces.
 */
export function jsonStringify(
  value: JsonValue,
  options: JsonStringifyOptions = {},
): string | undefined {
  // Written out rather than spread conditionally. The spread existed only to satisfy
  // `exactOptionalPropertyTypes`, which is better answered by declaring the options as
  // explicitly optional -- and a spread assignment in an object literal is not lowered yet.
  return stringifyJsonValue(value, {
    gap: resolveGap(options.space),
    replacer: options.replacer,
    propertyList: options.propertyList,
  });
}

function isLowercaseAsciiLetter(unit: number): boolean {
  return unit >= 0x61 && unit <= 0x7a;
}

function isAsciiDigit(unit: number): boolean {
  return unit >= 0x30 && unit <= 0x39;
}

/**
 * 25.5.3 `JSON.rawJSON`.
 *
 * The first and last code-unit checks are the specification's, and they are what restricts the
 * argument to a primitive without parsing first: `[` and `{` are neither a lowercase letter,
 * a digit, a quotation mark nor a hyphen-minus, so a container is rejected before `ParseJSON`
 * is reached. Leading or trailing whitespace is rejected by the same two checks.
 */
export function jsonRawJSON(text: string): JsonValue {
  if (text.length === 0) throw new SyntaxError("JSON.rawJSON text must not be empty");
  const first = text.charCodeAt(0);
  if (
    !isLowercaseAsciiLetter(first) &&
    !isAsciiDigit(first) &&
    first !== 0x22 &&
    first !== 0x2d
  ) {
    throw new SyntaxError("JSON.rawJSON text must begin a primitive value");
  }
  const last = text.charCodeAt(text.length - 1);
  if (!isLowercaseAsciiLetter(last) && !isAsciiDigit(last) && last !== 0x22) {
    throw new SyntaxError("JSON.rawJSON text must end a primitive value");
  }
  // Still parsed: the code-unit checks admit `-x` and `truer`, which are not JSON.
  parseJsonText(text);
  return JsonValue.rawValue(text);
}

/** 25.5.1 `JSON.isRawJSON`. */
export function isRawJSON(value: JsonValue): boolean {
  return value.kind === "raw";
}
