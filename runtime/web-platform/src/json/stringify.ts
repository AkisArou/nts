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
import { JsonValue } from "./value.ts";

const BACKSPACE = 0x08;
const TAB = 0x09;
const LINE_FEED = 0x0a;
const FORM_FEED = 0x0c;
const CARRIAGE_RETURN = 0x0d;
const SPACE = 0x20;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const LEAD_SURROGATE_START = 0xd800;
const TRAIL_SURROGATE_END = 0xdfff;

const HEX = "0123456789abcdef";

/**
 * 25.5.4.4: a code unit as `\uXXXX`, lowercase and padded to four digits.
 *
 * Built from a table rather than `toString(16)` plus padding, because this is the inner loop
 * for any string carrying control characters or lone surrogates.
 */
function unicodeEscape(unit: number): string {
  return (
    "\\u" +
    (HEX.charAt((unit >> 12) & 0xf) +
      HEX.charAt((unit >> 8) & 0xf) +
      HEX.charAt((unit >> 4) & 0xf) +
      HEX.charAt(unit & 0xf))
  );
}

/**
 * 25.5.4.3 `QuoteJSONString`.
 *
 * Table 78 holds exactly seven single-character escapes — `\b`, `\t`, `\n`, `\f`, `\r`, `\"`
 * and `\\`. **`\v` is not among them**, so U+000B is written `\u000b`, and **`/` is not among
 * them either**, so a solidus is emitted bare even though the parser accepts `\/`.
 *
 * A lone surrogate is escaped rather than emitted: 25.5.4.3 sends any code point "with the
 * same numeric value as a leading surrogate or trailing surrogate" through `UnicodeEscape`.
 * That is the other half of the parser preserving one, and it is what makes the pair
 * round-trip instead of collapsing to U+FFFD.
 */
export function quoteJSONString(value: string): string {
  let out = '"';
  let plainFrom = 0;
  for (let at = 0; at < value.length; at++) {
    const unit = value.charCodeAt(at);
    // The common case is a character that needs nothing, so runs are copied in one slice
    // rather than one character at a time.
    if (
      unit > BACKSLASH ||
      (unit >= SPACE && unit !== QUOTE && unit !== BACKSLASH)
    ) {
      if (unit < LEAD_SURROGATE_START || unit > TRAIL_SURROGATE_END) continue;
      // A well-formed pair is one code point and is emitted as it stands; only an unpaired
      // half is escaped.
      if (unit <= 0xdbff && at + 1 < value.length) {
        const next = value.charCodeAt(at + 1);
        if (next >= 0xdc00 && next <= TRAIL_SURROGATE_END) {
          at++;
          continue;
        }
      }
      out += value.slice(plainFrom, at) + unicodeEscape(unit);
      plainFrom = at + 1;
      continue;
    }
    out += value.slice(plainFrom, at);
    plainFrom = at + 1;
    if (unit === QUOTE) out += '\\"';
    else if (unit === BACKSLASH) out += "\\\\";
    else if (unit === LINE_FEED) out += "\\n";
    else if (unit === CARRIAGE_RETURN) out += "\\r";
    else if (unit === TAB) out += "\\t";
    else if (unit === BACKSPACE) out += "\\b";
    else if (unit === FORM_FEED) out += "\\f";
    else out += unicodeEscape(unit);
  }
  return out + value.slice(plainFrom) + '"';
}

/**
 * A number as JSON text.
 *
 * 25.5.4.2: a finite number is `ToString(value)` and a non-finite one is `"null"`, so `NaN`,
 * `Infinity` and `-Infinity` all serialize to `null` and `1e400` — which is valid JSON and
 * parses to `Infinity` — does not round-trip. `-0` is `"0"`, which falls out of `ToString`
 * rather than needing a case.
 *
 * `String(value)` is the canonical `Number::toString`, which the plan requires this to use
 * rather than a second formatter: `nts_number_to_string` on C and LLVM, `NtsRuntime.numberToString`
 * on the JVM, both already cross-checked against each other.
 */
function numberText(value: number): string {
  return Number.isFinite(value) ? String(value) : "null";
}

/** One open container while serializing. */
class Frame {
  readonly node: JsonValue;
  readonly indent: string;
  readonly parts: string[] = [];
  index = 0;

  constructor(node: JsonValue, indent: string) {
    this.node = node;
    this.indent = indent;
  }
}

function scalarText(node: JsonValue): string {
  switch (node.kind) {
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
 * Assemble a finished container, applying the gap exactly as 25.5.4.5 and 25.5.4.6 describe:
 * an empty container is `{}` or `[]` with no gap inside it, and a non-empty one puts the
 * *outer* indent before the closing brace and the inner indent before each member.
 */
function assemble(frame: Frame, gap: string): string {
  const isArray = frame.node.kind === "array";
  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";
  if (frame.parts.length === 0) return open + close;
  if (gap === "") return open + frame.parts.join(",") + close;
  const inner = frame.indent + gap;
  return (
    open + "\n" + inner + frame.parts.join(",\n" + inner) + "\n" + frame.indent + close
  );
}

/** The text of one member of an object: a quoted key, a colon, and the gap's single space. */
function member(key: string, valueText: string, gap: string): string {
  return quoteJSONString(key) + ":" + (gap === "" ? "" : " ") + valueText;
}

/**
 * Serialize a graph node.
 *
 * `gap` is the already-resolved indent unit — 25.5.4 turns a number into that many spaces
 * capped at ten, and a string into its first ten characters, before serialization begins.
 */
export function stringifyJsonValue(value: JsonValue, gap = ""): string {
  if (value.kind !== "array" && value.kind !== "object") return scalarText(value);

  const frames: Frame[] = [new Frame(value, "")];
  for (;;) {
    const frame = frames[frames.length - 1] as Frame;
    const node = frame.node;
    const isArray = node.kind === "array";
    const count = isArray ? node.items.length : node.values.length;

    if (frame.index < count) {
      const child = (isArray ? node.items[frame.index] : node.values[frame.index]) as JsonValue;
      if (child.kind === "array" || child.kind === "object") {
        frames.push(new Frame(child, frame.indent + gap));
        continue;
      }
      const text = scalarText(child);
      frame.parts.push(isArray ? text : member(node.keys[frame.index] as string, text, gap));
      frame.index++;
      continue;
    }

    const finished = assemble(frame, gap);
    frames.pop();
    if (frames.length === 0) return finished;
    const parent = frames[frames.length - 1] as Frame;
    const parentNode = parent.node;
    if (parentNode.kind === "array") {
      parent.parts.push(finished);
    } else {
      parent.parts.push(member(parentNode.keys[parent.index] as string, finished, gap));
    }
    parent.index++;
  }
}

/**
 * 25.5.4 steps 5-8: resolve the `space` argument into the indent unit.
 *
 * A number is truncated toward zero, clamped to ten, and becomes that many spaces; anything
 * below one is no gap at all. A string is truncated to ten characters and used as it stands,
 * so a tab or any other text is a legal indent.
 */
export function resolveGap(space: number | string | undefined): string {
  if (typeof space === "number") {
    const count = Number.isNaN(space) ? 0 : Math.min(10, Math.trunc(space));
    return count < 1 ? "" : " ".repeat(count);
  }
  if (typeof space === "string") return space.length <= 10 ? space : space.slice(0, 10);
  return "";
}
