// The erased tagged JSON graph.
//
// `docs/web-platform-integration-plan.md` §9 asks for a generic result that "can be carried,
// narrowed, validated, reviver-transformed and stringified" without introducing "arbitrary
// ordinary-object property maps, prototype behavior, or unchecked `any` into HIR". This is
// that representation. It is deliberately *not* the fast path: direct typed materialization
// at a `JsonParse` boundary is, and it specializes past this graph entirely.
//
// One node type with a tag and concrete slots, rather than a union of node shapes. A property
// whose type is a union of dissimilar types is not representable in this compiler's lowering
// yet -- the frontier carries refusals of exactly that form -- so the shape that survives is a
// discriminant plus fields that are each one type.
//
// The spec text this is written against is pinned at
// `runtime/web-platform/third_party/ecma262/json-25.5.txt`.

/**
 * The JSON value kinds. A string discriminant, which lowers; a union of shapes does not.
 *
 * Two of these are not parse results. `raw` is what `JSON.rawJSON` (25.5.3) produces: a
 * pre-validated fragment that `SerializeJSONProperty` returns verbatim, carried in
 * {@link JsonValue.text}. `hole` is an array element a reviver deleted — 25.5.2.4 uses
 * `[[Delete]]`, which leaves a hole rather than shortening the array, and a hole reads as
 * absent and serializes as `null`.
 */
export type JsonKind =
  | "null"
  | "boolean"
  | "number"
  | "string"
  | "array"
  | "object"
  | "raw"
  | "hole";

/**
 * Whether `key` is a canonical array index, and which one.
 *
 * ECMA-262 defines an array index as a String `P` for which `ToString(ToUint32(P))` is `P` and
 * `ToUint32(P)` is less than 2^32 - 1. The plan names the consequences directly: `"01"`,
 * `"-1"`, `"1.5"` and `"4294967295"` are *not* indices and stay in the string-key bucket,
 * because none of them round-trips through `ToUint32`.
 *
 * Returns -1 for anything that is not an index, so the caller needs no second predicate.
 */
export function arrayIndexOf(key: string): number {
  const length = key.length;
  if (length === 0 || length > 10) return -1;
  const first = key.charCodeAt(0);
  // A leading zero only round-trips for "0" itself: `ToString(ToUint32("01"))` is `"1"`.
  if (first === 48 && length > 1) return -1;
  let value = 0;
  for (let index = 0; index < length; index++) {
    const code = key.charCodeAt(index);
    if (code < 48 || code > 57) return -1;
    value = value * 10 + (code - 48);
  }
  // 2^32 - 1 is excluded: it is the one all-digit value that is not an index.
  return value < 4294967295 ? value : -1;
}

/**
 * A parsed JSON value.
 *
 * Exactly one of the payload slots is meaningful, selected by `kind`. Reading another is a
 * caller error rather than a checked condition -- this is an internal representation with a
 * single producer, and every consumer switches on `kind` first.
 */
/**
 * The member count past which duplicate detection switches from a scan to a map.
 *
 * Not tuned to a benchmark peak: the two curves cross somewhere in the low tens and the exact
 * point moves with key length and engine, so this is a round number inside the region where
 * neither choice is bad rather than a claim about where the crossing is.
 */
const WIDE_OBJECT = 16;

function buildSeen(keys: readonly string[]): Map<string, number> {
  // No first-occurrence guard, because the list cannot contain a repeat: a key is only pushed
  // onto it when the lookup did not find it. A sabotage making this keep the *last* position
  // instead of the first passed the whole suite, which is what a branch that cannot be taken
  // looks like from the outside -- so it is gone rather than left in as untestable defence.
  const seen = new Map<string, number>();
  for (let at = 0; at < keys.length; at++) seen.set(keys[at] as string, at);
  return seen;
}

/**
 * The positions `0..indexOrder.length`, ordered by the array index each one holds.
 *
 * **This is a hand-written sort because `Array#sort` with a comparator is not lowered yet** --
 * `NTS1001 this array method is not supported by this lowering yet`, which was raised at the
 * `order.sort(...)` this replaced. It was the only refusal between `JsonValue.objectValue` and
 * the compiled axis, and through `readValue` the only one between the whole JSON parser and it.
 * Agreed with the compiler lane to write the sort rather than leave the parser blocked: a
 * comparator sort is a large general feature and a key-ordering helper is a poor forcing case
 * for it. The refusal is recorded rather than removed -- see the note in `docs/BASELINE.md`.
 *
 * **Merge rather than insertion, and that is not premature.** The values being ordered are array
 * indices, and an object carrying many of them is an ordinary document -- a sparse array written
 * as an object is exactly that. An O(n^2) pass here would be a real regression on real input,
 * and this function has already had one quadratic in it: the duplicate scan, which cost 28.68ms
 * where it now costs 0.81ms.
 *
 * Stable, though nothing depends on it: the keys reaching here are already deduplicated, so
 * there are no ties to preserve.
 */
function ascendingByIndex(indexOrder: readonly number[]): readonly number[] {
  const count = indexOrder.length;
  let current: number[] = [];
  for (let at = 0; at < count; at++) current.push(at);
  if (count < 2) return current;

  // Filled by pushing rather than sized up front: an array literal of a known length is one
  // more thing to check lowers, and the buffer is written whole on every pass anyway.
  let buffer: number[] = [];
  for (let at = 0; at < count; at++) buffer.push(0);

  for (let width = 1; width < count; width = width * 2) {
    for (let start = 0; start < count; start = start + width * 2) {
      const middle = start + width < count ? start + width : count;
      const end = start + width * 2 < count ? start + width * 2 : count;
      let left = start;
      let right = middle;
      let at = start;
      while (left < middle && right < end) {
        const leftKey = indexOrder[current[left] as number] as number;
        const rightKey = indexOrder[current[right] as number] as number;
        if (leftKey <= rightKey) {
          buffer[at] = current[left] as number;
          left++;
        } else {
          buffer[at] = current[right] as number;
          right++;
        }
        at++;
      }
      while (left < middle) {
        buffer[at] = current[left] as number;
        left++;
        at++;
      }
      while (right < end) {
        buffer[at] = current[right] as number;
        right++;
        at++;
      }
    }
    const swap = current;
    current = buffer;
    buffer = swap;
  }
  return current;
}

/**
 * The empty payloads a scalar node carries, allocated once.
 *
 * Every scalar wrote `[], [], []` at its constructor, so a `null`, a `boolean`, a `number` and a
 * `string` each allocated **three arrays it can never put anything in** -- and a document is
 * mostly scalars. On the compiled axis that was the single largest cost in the parse profile:
 * `nts_array_new` at 13.9%, `nts_array_grow` at 5.4% and `malloc` at 2.9%, against
 * `parseJsonText` itself at 23%.
 *
 * Sharing them is sound because the fields are `readonly` and nothing writes through them: the
 * parser accumulates into a `Frame`'s own arrays and hands the finished ones to a container
 * node, so a scalar's three are never the target of a `push`. That is checked rather than
 * assumed -- every `.items.push`, `.keys.push` and `.values.push` in this module is on a frame.
 *
 * `readonly` is the type system's claim and not the runtime's, so this is a shared mutable
 * array on a host. It is the same trade the specification makes for a frozen empty array, and
 * the alternative is three allocations per scalar to defend against a write that no code in
 * this module performs.
 */
const NO_ITEMS: readonly JsonValue[] = [];
const NO_KEYS: readonly string[] = [];
const NO_VALUES: readonly JsonValue[] = [];

export class JsonValue {
  readonly kind: JsonKind;
  /** `boolean` values. */
  readonly boolean: boolean;
  /** `number` values, already converted by the canonical `Number` conversion. */
  readonly number: number;
  /** `string` values, as UTF-16 code units with lone surrogates preserved. */
  readonly text: string;
  /** `array` elements, in order. */
  readonly items: readonly JsonValue[];
  /** `object` keys, in `OrdinaryOwnPropertyKeys` order; parallel to {@link values}. */
  readonly keys: readonly string[];
  /** `object` values, parallel to {@link keys}. */
  readonly values: readonly JsonValue[];
  /**
   * The span of source text this value was parsed from, as `[start, end)` code-unit offsets.
   *
   * 25.5.2.4 hands the reviver a `context.source` for an unmodified primitive, which is "the
   * source text matched by parseNode". Recording the span rather than a parse node is the
   * whole of that requirement for a parser that owns its own input, and it costs two numbers
   * on a node that already exists.
   */
  readonly start: number;
  readonly end: number;

  private constructor(
    kind: JsonKind,
    start: number,
    end: number,
    boolean: boolean,
    numberValue: number,
    text: string,
    items: readonly JsonValue[],
    keys: readonly string[],
    values: readonly JsonValue[],
  ) {
    this.kind = kind;
    this.start = start;
    this.end = end;
    this.boolean = boolean;
    this.number = numberValue;
    this.text = text;
    this.items = items;
    this.keys = keys;
    this.values = values;
  }

  static nullValue(start: number, end: number): JsonValue {
    return new JsonValue("null", start, end, false, 0, "", NO_ITEMS, NO_KEYS, NO_VALUES);
  }

  static booleanValue(value: boolean, start: number, end: number): JsonValue {
    return new JsonValue("boolean", start, end, value, 0, "", NO_ITEMS, NO_KEYS, NO_VALUES);
  }

  static numberValue(value: number, start: number, end: number): JsonValue {
    return new JsonValue("number", start, end, false, value, "", NO_ITEMS, NO_KEYS, NO_VALUES);
  }

  static stringValue(value: string, start: number, end: number): JsonValue {
    return new JsonValue("string", start, end, false, 0, value, NO_ITEMS, NO_KEYS, NO_VALUES);
  }

  /**
   * A pre-validated JSON fragment, emitted verbatim by the serializer.
   *
   * 25.5.3 validates the text before the object exists, so a `raw` node is by construction
   * already valid JSON denoting a string, number, boolean or null.
   */
  static rawValue(text: string): JsonValue {
    return new JsonValue("raw", 0, text.length, false, 0, text, NO_ITEMS, NO_KEYS, NO_VALUES);
  }

  /**
   * An array element that a reviver deleted.
   *
   * Not `null`: a hole reads as absent where a `null` reads as the null value, and only the
   * serialized forms coincide. Splicing the element out instead would shorten the array and
   * produce a different document.
   */
  static holeValue(): JsonValue {
    return new JsonValue("hole", 0, 0, false, 0, "", NO_ITEMS, NO_KEYS, NO_VALUES);
  }

  static arrayValue(items: readonly JsonValue[], start: number, end: number): JsonValue {
    return new JsonValue("array", start, end, false, 0, "", items, [], []);
  }

  /**
   * An object, with its keys placed in `OrdinaryOwnPropertyKeys` order.
   *
   * Canonical array-index names come first in ascending numeric order, then every other key in
   * insertion order. An insertion-ordered map is not a conforming object case even when lookup
   * is correct, because `Object.keys`, `for...in` and `JSON.stringify` all observe this order.
   *
   * A repeated key takes the later value and keeps the earlier position: 25.5.2 note 2 says
   * "lexically preceding values for the same key shall be overwritten", and overwriting a
   * property does not move it.
   *
   * ### Why the duplicate check changes shape partway through
   *
   * Finding the earlier occurrence of a key was a linear scan of the keys so far, which is
   * quadratic in the number of members. That is invisible on the objects most documents are
   * made of and it is not invisible at all on a wide one: a benchmark against node measured a
   * flat 5,000-key object at **59x slower than the native parser**, against 2-8x everywhere
   * else. A ratio that far out of line with its neighbours is an algorithm, not a constant
   * factor.
   *
   * A `Map` fixes that and costs an allocation per object, which is the wrong trade for the
   * common case -- most objects have a handful of members, where a scan of four strings beats
   * building a hash table. So the scan stays until an object proves to be wide, and the map is
   * built once at the threshold and used from there on. Both paths implement the same rule.
   */
  static objectValue(
    sourceKeys: readonly string[],
    sourceValues: readonly JsonValue[],
    start: number,
    end: number,
  ): JsonValue {
    const indexKeys: string[] = [];
    const indexOrder: number[] = [];
    const indexValues: JsonValue[] = [];
    const stringKeys: string[] = [];
    const stringValues: JsonValue[] = [];

    // Null until an object turns out to be wide enough for the scan to be the wrong shape;
    // see the note above. `indexSeen` is separate because the two key spaces are disjoint.
    let indexSeen: Map<string, number> | null = null;
    let stringSeen: Map<string, number> | null = null;

    for (let at = 0; at < sourceKeys.length; at++) {
      const key = sourceKeys[at] as string;
      const value = sourceValues[at] as JsonValue;
      const index = arrayIndexOf(key);
      if (index >= 0) {
        const existing = indexSeen === null ? indexKeys.indexOf(key) : (indexSeen.get(key) ?? -1);
        if (existing >= 0) {
          indexValues[existing] = value;
        } else {
          if (indexSeen !== null) indexSeen.set(key, indexKeys.length);
          indexKeys.push(key);
          indexOrder.push(index);
          indexValues.push(value);
        }
        if (indexSeen === null && indexKeys.length >= WIDE_OBJECT) {
          indexSeen = buildSeen(indexKeys);
        }
        continue;
      }
      const existing = stringSeen === null ? stringKeys.indexOf(key) : (stringSeen.get(key) ?? -1);
      if (existing >= 0) {
        stringValues[existing] = value;
      } else {
        if (stringSeen !== null) stringSeen.set(key, stringKeys.length);
        stringKeys.push(key);
        stringValues.push(value);
      }
      if (stringSeen === null && stringKeys.length >= WIDE_OBJECT) {
        stringSeen = buildSeen(stringKeys);
      }
    }

    // **No array-index key, which is almost every object.** Then the string
    // arrays already hold the members in insertion order, which is what the
    // ordering below is for -- so they *are* the answer and copying them into a
    // second pair is the whole of the work skipped.
    //
    // Measured on `benches/cases/json-parse`, whose corpus is the serializer's
    // own document: `nts_array_grow` and `nts_array_new` were 12.3% of the row
    // and `JsonValue.objectValue` another 7.5%. An object cost nine arrays --
    // three `index*` that stay empty, `order` that stays empty, the two string
    // arrays, the final pair, and the empty items list -- of which two carry
    // data.
    //
    // Safe to hand over rather than copy: both are local to this function,
    // nothing else holds them, and a `JsonValue` does not mutate what it is
    // given. `ascendingByIndex` on an empty array answers an empty array, so
    // the general path below is what this is skipping and not something it
    // changes.
    if (indexKeys.length === 0) {
      return new JsonValue("object", start, end, false, 0, "", [], stringKeys, stringValues);
    }

    // Ascending numeric order, not lexicographic: "10" follows "9".
    const order = ascendingByIndex(indexOrder);

    const keys: string[] = [];
    const values: JsonValue[] = [];
    for (const at of order) {
      keys.push(indexKeys[at] as string);
      values.push(indexValues[at] as JsonValue);
    }
    for (let at = 0; at < stringKeys.length; at++) {
      keys.push(stringKeys[at] as string);
      values.push(stringValues[at] as JsonValue);
    }

    return new JsonValue("object", start, end, false, 0, "", [], keys, values);
  }
}
