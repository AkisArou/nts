// Serialization, from clause 25.5.4 of the pinned specification text.
//
// `QuoteJSONString` (25.5.4.3), `UnicodeEscape` (25.5.4.4), `SerializeJSONObject` (25.5.4.5)
// and `SerializeJSONArray` (25.5.4.6), over the erased graph. The arbitrary-value entry point
// — `toJSON`, a replacer function, a property list, `[[IsRawJSON]]`, and the cycle check that
// only an arbitrary value can need — comes with the public `JSON` surface; a graph built by
// the parser is a tree by construction, since a node is immutable and assembled bottom-up.
//
// **No recursion here either.** The plan requires that *both* traversals use an explicit work
// stack, for the same reason: a deeply nested value must not serialize on one target and kill
// the process on another.
import {
  containerSuffix,
  memberPrefix,
  numberText,
  firstEscapeIndex,
  quoteFromIndex,
  quoteJSONString,
  resolveGap,
} from "./text.ts";
import { JsonValue } from "./value.ts";

// Re-exported so the entry points and the tests keep one import site for the whole
// serializer. The definitions live in `text.ts` because they carry no callback and therefore
// compile where this file's replacer does not; see the note at the head of that file.
export { quoteJSONString, resolveGap };

/** One open container while serializing. */
class Frame {
  readonly node: JsonValue;
  readonly indent: string;
  /** The object keys this frame will emit, after any inclusion list is applied. */
  readonly keys: readonly string[];
  /** Parallel to {@link keys}. */
  readonly values: readonly JsonValue[];
  /**
   * How many members this container has written.
   *
   * A count rather than a list. The serializer streams into one accumulator instead of building
   * a string per container and copying it into its parent, so all a frame needs to know is
   * whether a separator is due and whether the closer takes an indent.
   */
  emitted = 0;
  index = 0;

  constructor(
    node: JsonValue,
    indent: string,
    entries: { keys: readonly string[]; values: readonly JsonValue[] },
  ) {
    this.node = node;
    this.indent = indent;
    this.keys = entries.keys;
    this.values = entries.values;
  }
}

function scalarText(node: JsonValue): string {
  switch (node.kind) {
    case "hole":
      // A deleted array element. 25.5.4.6 writes `null` for an element whose serialization is
      // undefined, and a hole reads as undefined.
      return "null";
    case "raw":
      // 25.5.4.2: a value with `[[IsRawJSON]]` returns its `rawJSON` text unchanged. It was
      // validated by 25.5.3 before the node existed, so there is nothing to re-check here.
      return node.text;
    case "null":
      return "null";
    case "boolean":
      return node.boolean ? "true" : "false";
    case "number":
      return numberText(node.number);
    default:
      return quoteJSONString(node.text);
  }
}

/**
 * How a value is transformed on its way out.
 *
 * 25.5.4.2 applies the replacer to **every** value including the root, whose key is the empty
 * string, so a replacer can omit the whole document. `propertyList` is 25.5.4's array form of
 * the same argument: an inclusion list, applied to objects only, in the order the list gives
 * rather than the order the object has.
 */
export interface JsonSerializeOptions {
  /** The already-resolved indent unit; see {@link resolveGap}. */
  readonly gap?: string | undefined;
  /** Returns `undefined` to omit the value, which an array renders as `null` and an object skips. */
  readonly replacer?: ((key: string, value: JsonValue) => JsonValue | undefined) | undefined;
  /** An inclusion list for object keys. Absent means every own key, in the object's order. */
  readonly propertyList?: readonly string[] | undefined;
}

/** The keys an object contributes, and the value each one holds. */
function objectEntries(
  node: JsonValue,
  propertyList: readonly string[] | undefined,
): { keys: readonly string[]; values: readonly JsonValue[] } {
  if (propertyList === undefined) return { keys: node.keys, values: node.values };
  // 25.5.4.5 walks `state.[[PropertyList]]` rather than the object, so the list decides both
  // which keys appear and what order they appear in. A key the object does not have
  // contributes nothing, and a key the list repeats was already deduplicated when the list
  // was built.
  const keys: string[] = [];
  const values: JsonValue[] = [];
  for (const key of propertyList) {
    const at = node.keys.indexOf(key);
    if (at < 0) continue;
    keys.push(key);
    values.push(node.values[at] as JsonValue);
  }
  return { keys, values };
}

/**
 * Serialize a graph node.
 *
 * Returns `undefined` when the root is omitted, which is what `JSON.stringify` returns for a
 * value a replacer discarded.
 */
export function stringifyJsonValue(
  value: JsonValue,
  options: JsonSerializeOptions = {},
): string | undefined {
  const gap = options.gap ?? "";
  const replacer = options.replacer;
  const propertyList = options.propertyList;

  const root = replacer === undefined ? value : replacer("", value);
  if (root === undefined) return undefined;
  if (root.kind !== "array" && root.kind !== "object") return scalarText(root);

  // **Streamed into one accumulator, not assembled per container.** Building a string for each
  // container and copying it into its parent costs an allocation and a copy per level; on a
  // 534KB document that was measured at 1.27x against writing straight through, and the
  // accumulator's appends are in place because `out` is a local that never crosses a parameter.
  // That last part is not a style preference: passing the accumulator to a helper gives it two
  // live references, `nts_str_append` stops appending in place, and the whole thing goes
  // quadratic -- 50x, measured. Everything that touches `out` is therefore written here.
  let out = "";
  const frames: Frame[] = [new Frame(root, "", objectEntries(root, propertyList))];
  out += root.kind === "array" ? "[" : "{";

  for (;;) {
    const frame = frames[frames.length - 1] as Frame;
    const isArray = frame.node.kind === "array";
    const count = isArray ? frame.node.items.length : frame.keys.length;

    if (frame.index < count) {
      const key = isArray ? String(frame.index) : (frame.keys[frame.index] as string);
      const original = (isArray ? frame.node.items[frame.index] : frame.values[frame.index]) as JsonValue;
      const child = replacer === undefined ? original : replacer(key, original);
      frame.index++;
      if (child === undefined) {
        // 25.5.4.6: an omitted array element is `null`; 25.5.4.5 skips an omitted member.
        if (!isArray) continue;
        out += memberPrefix(frame.emitted !== 0, frame.indent, gap);
        out += "null";
        frame.emitted++;
        continue;
      }
      out += memberPrefix(frame.emitted !== 0, frame.indent, gap);
      if (!isArray) {
        // The quoted key, appended rather than built. `quoteJSONString` would allocate the
        // quoted string, copy it into the accumulator and free it -- once per member. A key
        // needing no escape, which is nearly all of them, is three in-place appends instead and
        // allocates nothing. The classification is not repeated to do this: `firstEscapeIndex`
        // is the same scan `quoteJSONString` runs for its own fast path.
        const keyEscape = firstEscapeIndex(key, 0);
        if (keyEscape < 0) {
          out += '"';
          out += key;
          out += '"';
        } else {
          out += quoteFromIndex(key, keyEscape);
        }
        out += gap === "" ? ":" : ": ";
      }
      frame.emitted++;
      if (child.kind === "array" || child.kind === "object") {
        frames.push(new Frame(child, frame.indent + gap, objectEntries(child, propertyList)));
        out += child.kind === "array" ? "[" : "{";
        continue;
      }
      // Strings are the one scalar worth appending rather than building, and the common one.
      // Everything else -- `null`, a boolean, a number, a raw node -- is either a literal or a
      // single `numberText` call with nothing to fuse.
      if (child.kind === "string") {
        const text = child.text;
        const valueEscape = firstEscapeIndex(text, 0);
        if (valueEscape < 0) {
          out += '"';
          out += text;
          out += '"';
        } else {
          out += quoteFromIndex(text, valueEscape);
        }
      } else {
        out += scalarText(child);
      }
      continue;
    }

    out += containerSuffix(frame.emitted !== 0, isArray, frame.indent, gap);
    frames.pop();
    if (frames.length === 0) return out;
  }
}
