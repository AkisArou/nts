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
  assembleContainer,
  member,
  numberText,
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
  readonly parts: string[] = [];
  index = 0;
  /** The key this container occupies in its parent, needed when it finishes. */
  parentKey = "";

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

  const frames: Frame[] = [new Frame(root, "", objectEntries(root, propertyList))];
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
        if (isArray) frame.parts.push("null");
        continue;
      }
      if (child.kind === "array" || child.kind === "object") {
        frames.push(new Frame(child, frame.indent + gap, objectEntries(child, propertyList)));
        // The parent's key for this container is needed when it finishes; the frame records it.
        (frames[frames.length - 1] as Frame).parentKey = key;
        continue;
      }
      const text = scalarText(child);
      frame.parts.push(isArray ? text : member(key, text, gap));
      continue;
    }

    const finished = assembleContainer(
      frame.parts,
      frame.node.kind === "array",
      frame.indent,
      gap,
    );
    frames.pop();
    if (frames.length === 0) return finished;
    const parent = frames[frames.length - 1] as Frame;
    parent.parts.push(
      parent.node.kind === "array" ? finished : member(frame.parentKey, finished, gap),
    );
  }
}
