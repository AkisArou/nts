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
    return new JsonValue("null", start, end, false, 0, "", [], [], []);
  }

  static booleanValue(value: boolean, start: number, end: number): JsonValue {
    return new JsonValue("boolean", start, end, value, 0, "", [], [], []);
  }

  static numberValue(value: number, start: number, end: number): JsonValue {
    return new JsonValue("number", start, end, false, value, "", [], [], []);
  }

  static stringValue(value: string, start: number, end: number): JsonValue {
    return new JsonValue("string", start, end, false, 0, value, [], [], []);
  }

  /**
   * A pre-validated JSON fragment, emitted verbatim by the serializer.
   *
   * 25.5.3 validates the text before the object exists, so a `raw` node is by construction
   * already valid JSON denoting a string, number, boolean or null.
   */
  static rawValue(text: string): JsonValue {
    return new JsonValue("raw", 0, text.length, false, 0, text, [], [], []);
  }

  /**
   * An array element that a reviver deleted.
   *
   * Not `null`: a hole reads as absent where a `null` reads as the null value, and only the
   * serialized forms coincide. Splicing the element out instead would shorten the array and
   * produce a different document.
   */
  static holeValue(): JsonValue {
    return new JsonValue("hole", 0, 0, false, 0, "", [], [], []);
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

    for (let at = 0; at < sourceKeys.length; at++) {
      const key = sourceKeys[at] as string;
      const value = sourceValues[at] as JsonValue;
      const index = arrayIndexOf(key);
      if (index >= 0) {
        const existing = indexKeys.indexOf(key);
        if (existing >= 0) {
          indexValues[existing] = value;
        } else {
          indexKeys.push(key);
          indexOrder.push(index);
          indexValues.push(value);
        }
        continue;
      }
      const existing = stringKeys.indexOf(key);
      if (existing >= 0) {
        stringValues[existing] = value;
      } else {
        stringKeys.push(key);
        stringValues.push(value);
      }
    }

    // Ascending numeric order, not lexicographic: "10" follows "9".
    const order: number[] = [];
    for (let at = 0; at < indexKeys.length; at++) order.push(at);
    order.sort((left, right) => (indexOrder[left] as number) - (indexOrder[right] as number));

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
