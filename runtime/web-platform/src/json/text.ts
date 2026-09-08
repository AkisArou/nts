// The text primitives of clause 25.5.4: escaping, the Unicode escape, the number form, and
// the indent unit.
//
// Split from the traversal that uses them, and the split is not cosmetic. Every function here
// takes values and returns text; none of them takes a callback. `stringify.ts` and `plain.ts`
// both accept a replacer, which is a call through a function-typed slot, and **a backend that
// cannot lower one declines the whole module** -- so a single optional callback anywhere in a
// file costs every function in that file its compiled axis. The JVM backend declines
// `stringifyJsonValue` for exactly that reason today.
//
// Keeping the leaves in their own file is what lets them compile on all three backends while
// the traversal waits for closure slots, and the boundary is a real one: this is the part of
// serialization that is a pure function of its input.
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
 * Every escape below U+0100, whole, built once.
 *
 * This is the range that matters: 25.5.4.3 sends every control character here, and a control
 * character is the only thing most documents ever escape. Composing one costs four `charAt`
 * calls and four concatenations -- eight temporary strings per character -- and a profile of the
 * compiled serializer put `unicodeEscape` at 10.9% with the reference-counting traffic those
 * temporaries generate at 20% on top of it. A lookup is one index and no allocation.
 *
 * Two hundred and fifty-six strings, built at module load. Above the range the composed form
 * still runs, because a table over all sixty-five thousand code units would be the wrong trade.
 */
const SHORT_ESCAPES: string[] = buildShortEscapes();

function buildShortEscapes(): string[] {
  const out: string[] = [];
  for (let unit = 0; unit < 0x100; unit++) {
    out.push("\\u00" + HEX.charAt((unit >> 4) & 0xf) + HEX.charAt(unit & 0xf));
  }
  return out;
}

/**
 * 25.5.4.4: a code unit as `\uXXXX`, lowercase and padded to four digits.
 *
 * Built from a table rather than `toString(16)` plus padding, because this is the inner loop
 * for any string carrying control characters or lone surrogates.
 */
function unicodeEscape(unit: number): string {
  // Bounded against the table's own length, which is the only spelling that is correct on both
  // targets and cannot drift.
  //
  // Reading past the end and testing the result for `undefined` works on a host and **refuses on
  // a compiled one**: an out-of-range index is a hard failure there, not `undefined`, which the
  // benchmark found by aborting with `index 55296 is outside [0, 256)` -- 55296 being U+D800, a
  // lone surrogate, the one input that reaches here from above the table. A separate numeric
  // bound would work on both but is a second constant that has to agree with the table, and a
  // sabotage moving it one past the end survived every test. `.length` is not a second constant.
  if (unit < SHORT_ESCAPES.length) return SHORT_ESCAPES[unit] as string;
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
 * Table 78 holds exactly seven single-character escapes -- `\b`, `\t`, `\n`, `\f`, `\r`, `\"`
 * and `\\`. **`\v` is not among them**, so U+000B is written ``, and **`/` is not among
 * them either**, so a solidus is emitted bare even though the parser accepts `\/`.
 *
 * A lone surrogate is escaped rather than emitted: 25.5.4.3 sends any code point "with the
 * same numeric value as a leading surrogate or trailing surrogate" through `UnicodeEscape`.
 * That is the other half of the parser preserving one, and it is what makes the pair
 * round-trip instead of collapsing to U+FFFD.
 */
/**
 * The index of the first code unit needing an escape, or -1 when none does.
 *
 * Split out of {@link quoteJSONString} so that **one** classification serves two callers.
 * `quoteJSONString` uses it for its own fast path; a serializer that owns an accumulator uses
 * it to decide whether it can append the string as it stands. Table 78 and the 25.5.4.3
 * surrogate rule are expressed once and only here.
 *
 * The surrogate arm is why this cannot be a per-unit predicate: a lead followed by a trail is
 * one code point and is emitted as it stands, so deciding whether a lead needs escaping means
 * looking at the unit after it.
 */
export function firstEscapeIndex(value: string, from: number): number {
  for (let at = from; at < value.length; at++) {
    const unit = value.charCodeAt(at);
    // The common case is a character that needs nothing.
    if (
      unit > BACKSLASH ||
      (unit >= SPACE && unit !== QUOTE && unit !== BACKSLASH)
    ) {
      if (unit < LEAD_SURROGATE_START || unit > TRAIL_SURROGATE_END) continue;
      // A well-formed pair is one code point and is emitted as it stands; only an unpaired
      // half is escaped. This is the reason the answer cannot be a per-unit predicate: whether
      // a lead needs escaping depends on the unit after it.
      if (unit <= 0xdbff && at + 1 < value.length) {
        const next = value.charCodeAt(at + 1);
        if (next >= 0xdc00 && next <= TRAIL_SURROGATE_END) {
          at++;
          continue;
        }
      }
      return at;
    }
    return at;
  }
  return -1;
}

/**
 * The quoted form, told where the first escape is so it does not look for it again.
 *
 * **Every subsequent escape is found by {@link firstEscapeIndex} too**, which is why the scan
 * is not written here a second time. An earlier version of this function carried its own copy
 * of the classification and the surrogate rule -- identical code, in a file whose whole argument
 * is that those rules are written once -- and it was wrong for exactly one commit.
 *
 * Successive calls resume where the last stopped, so the string is still scanned once end to
 * end however many escapes it contains.
 */
export function quoteFromIndex(value: string, from: number): string {
  let out = '"';
  let plainFrom = 0;
  let at = from;
  while (at >= 0) {
    out += value.slice(plainFrom, at);
    plainFrom = at + 1;
    const unit = value.charCodeAt(at);
    // Table 78, and `UnicodeEscape` for everything else that reaches here: a control character
    // below `SPACE`, or an unpaired surrogate.
    if (unit === QUOTE) out += '\\"';
    else if (unit === BACKSLASH) out += "\\\\";
    else if (unit === LINE_FEED) out += "\\n";
    else if (unit === CARRIAGE_RETURN) out += "\\r";
    else if (unit === TAB) out += "\\t";
    else if (unit === BACKSPACE) out += "\\b";
    else if (unit === FORM_FEED) out += "\\f";
    else out += unicodeEscape(unit);
    at = firstEscapeIndex(value, plainFrom);
  }
  return out + value.slice(plainFrom) + '"';
}

export function quoteJSONString(value: string): string {
  const first = firstEscapeIndex(value, 0);
  // Nothing needs escaping, which is the common case: most strings in most documents contain
  // nothing Table 78 or 25.5.4.3 has anything to say about.
  if (first < 0) return '"' + value + '"';
  return quoteFromIndex(value, first);
}

/**
 * A number as JSON text.
 *
 * 25.5.4.2: a finite number is `ToString(value)` and a non-finite one is `"null"`, so `NaN`,
 * `Infinity` and `-Infinity` all serialize to `null` and `1e400` -- which is valid JSON and
 * parses to `Infinity` -- does not round-trip. `-0` is `"0"`, which falls out of `ToString`
 * rather than needing a case.
 *
 * `String(value)` is the canonical `Number::toString`, which the plan requires this to use
 * rather than a second formatter: `nts_number_to_string` on C and LLVM,
 * `NtsRuntime.numberToString` on the JVM, both already cross-checked against each other.
 */
export function numberText(value: number): string {
  return Number.isFinite(value) ? String(value) : "null";
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

/** The text of one member of an object: a quoted key, a colon, and the gap's single space. */
/**
 * What goes before a container member: the separator, and the indent when there is a gap.
 *
 * 25.5.4.5 and 25.5.4.6's formatting, expressed for a serializer that writes as it walks rather
 * than collecting a list and joining it. `assembleContainer` below is written in terms of this
 * and {@link containerSuffix}, so the rule has one statement and two shapes of caller rather
 * than two statements that have to agree.
 *
 * Returns a literal in the gapless case -- `","` or `""` -- so the common path allocates
 * nothing.
 */
export function memberPrefix(afterFirst: boolean, indent: string, gap: string): string {
  if (gap === "") return afterFirst ? "," : "";
  return (afterFirst ? ",\n" : "\n") + indent + gap;
}

/**
 * What closes a container: the bracket, preceded by the *outer* indent when it has members.
 *
 * An empty container is `{}` or `[]` with no gap inside it however wide the gap is, which is why
 * this needs to know whether anything was written.
 */
export function containerSuffix(
  hasMembers: boolean,
  isArray: boolean,
  indent: string,
  gap: string,
): string {
  const close = isArray ? "]" : "}";
  if (!hasMembers || gap === "") return close;
  return "\n" + indent + close;
}

/**
 * Assemble a finished container from its already-serialized members.
 *
 * Kept for callers that collect a list -- `plain.ts` walks arbitrary values and does -- and
 * written in terms of {@link memberPrefix} and {@link containerSuffix} so that it cannot drift
 * from the streaming form. Spelled over primitives rather than over a frame so that everything
 * which assembles JSON can share it, including a serializer generated for a statically known
 * type, which has no frame at all.
 */
export function assembleContainer(
  parts: readonly string[],
  isArray: boolean,
  indent: string,
  gap: string,
): string {
  let out = isArray ? "[" : "{";
  for (let at = 0; at < parts.length; at++) {
    out += memberPrefix(at !== 0, indent, gap);
    out += parts[at] as string;
  }
  out += containerSuffix(parts.length !== 0, isArray, indent, gap);
  return out;
}

export function member(key: string, valueText: string, gap: string): string {
  // Branched rather than appending `""`. Concatenating an empty string is a whole append --
  // a length check, a capacity check and possibly a copy -- to add nothing, and the gapless
  // form is the one every compact document takes.
  if (gap === "") return quoteJSONString(key) + ":" + valueText;
  return quoteJSONString(key) + ": " + valueText;
}
