// The JSON grammar, scanned and parsed without recursion.
//
// 25.5.2.1 `ParseJSON` validates against ECMA-404 and then evaluates; this does both in one
// pass, which is the same language and one traversal instead of two.
//
// **No recursion, deliberately.** `docs/records/notebooks/web-platform-integration-plan.md` §9 requires an
// explicit work stack so that a provider's thread stack cannot choose observable behaviour --
// "deep input must never become a JVM `StackOverflowError` on one target and a C/LLVM signal
// death on another". A recursive-descent parser makes nesting depth a property of the host,
// which is exactly the class of divergence this lane exists to prevent.
//
// The grammar is ECMA-404's, not JavaScript's, and the differences are the point: no trailing
// comma, no comment, no leading `+`, no leading zero, no unquoted key, no single quote, no
// `NaN` or `Infinity` literal, and only four whitespace characters. Anything JavaScript would
// accept and JSON would not is a `SyntaxError` here.
import { JsonValue } from "./value.ts";

// Character codes, as plain constants: `const enum` is not erasable syntax and this project
// compiles with `erasableSyntaxOnly`.
const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const SPACE = 0x20;
export const QUOTE = 0x22;
const PLUS = 0x2b;
export const COMMA = 0x2c;
export const MINUS = 0x2d;
const DOT = 0x2e;
const SLASH = 0x2f;
const ZERO = 0x30;
const NINE = 0x39;
const COLON = 0x3a;
const UPPER_E = 0x45;
export const OPEN_BRACKET = 0x5b;
const BACKSLASH = 0x5c;
export const CLOSE_BRACKET = 0x5d;
const LOWER_B = 0x62;
const LOWER_E = 0x65;
export const LOWER_F = 0x66;
export const LOWER_N = 0x6e;
const LOWER_R = 0x72;
export const LOWER_T = 0x74;
const LOWER_U = 0x75;
export const OPEN_BRACE = 0x7b;
export const CLOSE_BRACE = 0x7d;

/**
 * One open container while parsing. Both payload lists are fields so the frame has no union,
 * but only the kind's own are allocated: an array frame's `keys` and `values` and an object
 * frame's `items` are one shared empty list that nothing pushes to, because every push below
 * is guarded by `isArray`. A frame per container allocated all three, and the two it could
 * never use were two of the nine arrays an object cost.
 */
class Frame {
  isArray = false;
  start = 0;
  items: JsonValue[] = UNUSED_ITEMS;
  values: JsonValue[] = UNUSED_VALUES;
  /** The keys an object frame expects, in order; see {@link templateFor}. */
  template: readonly string[] = UNUSED_KEYS;
  /**
   * Whether every key so far has been the template's, in its order: then {@link matched} counts
   * them and {@link keys} is not used. An array of records spells the same keys in every row, so
   * the row shares the row before's list instead of building and growing one of its own -- three
   * of `benchmarks/cases/json-parse`'s twenty-eight allocations a row. The first key that is not
   * the template's next copies the shared prefix into `keys`, and the frame builds its own.
   */
  sharing = true;
  matched = 0;
  keys: string[] = UNUSED_KEYS;
  /**
   * The keys of the last object this array frame received that kept its own list unchanged (the
   * plain path in {@link JsonValue.objectValue}). A sibling ending with exactly that list is plain
   * too, so it does not ask again.
   */
  plainKeys: readonly string[] = UNUSED_KEYS;
  pendingKey = "";
  /** Whether {@link pendingKey} is the template's next, so the member continues the sharing. */
  pendingShared = false;

  /**
   * Make this frame the container opened now. A frame outlives its container: the stack keeps one
   * per depth it has reached and reopens it, rather than allocating one per container -- two of a
   * record row's allocations.
   */
  open(isArray: boolean, start: number, template: readonly string[]): void {
    this.isArray = isArray;
    this.start = start;
    this.items = isArray ? [] : UNUSED_ITEMS;
    this.values = isArray ? UNUSED_VALUES : [];
    this.template = template;
    this.sharing = !isArray;
    this.matched = 0;
    this.keys = UNUSED_KEYS;
    this.plainKeys = UNUSED_KEYS;
    this.pendingKey = "";
    this.pendingShared = false;
  }

  /** How many members this object frame has. */
  keyCount(): number {
    return this.sharing ? this.matched : this.keys.length;
  }

  /**
   * Record the pending member's key, as its value is pushed beside it.
   *
   * The key alone, and not the value: a value handed to a method that stores it is retained by
   * the store and released by the caller, and a count that falls without reaching zero makes a
   * JSON value a cycle candidate -- five a row, and a collection every parse, where the value
   * pushed in the parser's own loop is moved into the list instead.
   */
  addKey(): void {
    if (this.sharing && this.pendingShared) {
      this.matched++;
      return;
    }
    if (this.sharing) {
      this.keys = this.template.slice(0, this.matched);
      this.sharing = false;
    }
    this.keys.push(this.pendingKey);
  }

  /** The object's keys, once it is closed: the template itself when they are all of it. */
  finishedKeys(): readonly string[] {
    if (!this.sharing) return this.keys;
    return this.matched === this.template.length
      ? this.template
      : this.template.slice(0, this.matched);
  }
}

const UNUSED_ITEMS: JsonValue[] = [];
const UNUSED_KEYS: string[] = [];
const UNUSED_VALUES: JsonValue[] = [];

/**
 * The message shape for a JSON syntax error.
 *
 * 25.5.2.1 requires a `SyntaxError` and says nothing about a subtype, so this throws a plain
 * one and puts the offset in the message, which is what every engine does. An earlier draft
 * declared a `JsonSyntaxError extends SyntaxError` carrying a numeric `position`; that was an
 * invention, and dropping it is a correction rather than a concession to the lowering.
 */
function syntaxError(message: string, position: number): SyntaxError {
  return new SyntaxError(`${message} in JSON at position ${position}`);
}

export class Scanner {
  readonly source: string;
  readonly length: number;
  at = 0;

  constructor(source: string) {
    this.source = source;
    this.length = source.length;
  }

  fail(message: string): SyntaxError {
    return syntaxError(message, this.at);
  }

  /** ECMA-404 whitespace is exactly these four. ` ` and `﻿` are not JSON space. */
  skipWhitespace(): void {
    let at = this.at;
    while (at < this.length) {
      const code = this.source.charCodeAt(at);
      if (
        code !== SPACE &&
        code !== TAB &&
        code !== LINE_FEED &&
        code !== CARRIAGE_RETURN
      ) {
        break;
      }
      at++;
    }
    this.at = at;
  }

  peek(): number {
    return this.at < this.length ? this.source.charCodeAt(this.at) : -1;
  }

  /** A literal `true`, `false` or `null`, matched whole so `nul` fails at the right place. */
  expectWord(word: string): void {
    const end = this.at + word.length;
    if (end > this.length) throw this.fail(`Unexpected token ${this.describe()}`);
    for (let offset = 0; offset < word.length; offset++) {
      if (this.source.charCodeAt(this.at + offset) !== word.charCodeAt(offset)) {
        throw this.fail(`Unexpected token ${this.describe()}`);
      }
    }
    this.at = end;
  }

  describe(): string {
    if (this.at >= this.length) return "end of input";
    return `'${this.source.charAt(this.at)}'`;
  }

  /**
   * A JSON string literal, cursor on the opening quote.
   *
   * Escapes are decoded to UTF-16 code units and **lone surrogates survive**: `"\ud800"` parses
   * to a string holding that code unit, not U+FFFD. §9 of the plan is explicit that parsing
   * operates on code units and must not normalise through UTF-8, and `QuoteJSONString`
   * re-escapes such a unit on the way out, so the pair round-trips.
   */
  readString(): string {
    if (this.peek() !== QUOTE) throw this.fail(`Unexpected token ${this.describe()}`);
    this.at++;
    const start = this.at;
    let at = start;
    // Fast path: scan for a quote, and only build a new string if an escape appears.
    while (at < this.length) {
      const code = this.source.charCodeAt(at);
      if (code === QUOTE) {
        const text = this.source.slice(start, at);
        this.at = at + 1;
        return text;
      }
      if (code === BACKSLASH) break;
      if (code < SPACE) {
        this.at = at;
        throw this.fail("Bad control character in string literal");
      }
      at++;
    }
    if (at >= this.length) {
      this.at = at;
      throw this.fail("Unterminated string");
    }

    let out = this.source.slice(start, at);
    while (at < this.length) {
      const code = this.source.charCodeAt(at);
      if (code === QUOTE) {
        this.at = at + 1;
        return out;
      }
      if (code < SPACE) {
        this.at = at;
        throw this.fail("Bad control character in string literal");
      }
      if (code !== BACKSLASH) {
        out += this.source.charAt(at);
        at++;
        continue;
      }
      at++;
      if (at >= this.length) {
        this.at = at;
        throw this.fail("Unterminated string");
      }
      const escape = this.source.charCodeAt(at);
      at++;
      if (escape === QUOTE) out += '"';
      else if (escape === BACKSLASH) out += "\\";
      else if (escape === SLASH) out += "/";
      else if (escape === LOWER_B) out += "\b";
      else if (escape === LOWER_F) out += "\f";
      else if (escape === LOWER_N) out += "\n";
      else if (escape === LOWER_R) out += "\r";
      else if (escape === LOWER_T) out += "\t";
      else if (escape === LOWER_U) {
        if (at + 4 > this.length) {
          this.at = at;
          throw this.fail("Bad Unicode escape");
        }
        let unit = 0;
        for (let digit = 0; digit < 4; digit++) {
          const value = hexValue(this.source.charCodeAt(at + digit));
          if (value < 0) {
            this.at = at + digit;
            throw this.fail("Bad Unicode escape");
          }
          unit = unit * 16 + value;
        }
        at += 4;
        out += String.fromCharCode(unit);
      } else {
        this.at = at - 1;
        throw this.fail("Bad escaped character");
      }
    }
    this.at = at;
    throw this.fail("Unterminated string");
  }

  /**
   * A JSON number literal, validated against ECMA-404 and converted by the canonical
   * `Number` conversion rather than a second parser.
   *
   * The grammar is narrower than JavaScript's in four ways that all have to be refused here,
   * because the validated text is then handed to a conversion that would happily accept them:
   * no leading `+`, no leading zero before another digit, no bare `.5` or `5.`, and no
   * `Infinity` or `NaN`. `1e400` is *not* one of them -- it is valid JSON and evaluates to
   * `Infinity`, which `JSON.stringify` then writes back as `null`.
   */
  readNumber(): number {
    const end = scanNumber(this.source, this.at);
    if (end < 0) {
      // The scan reports *which* rule the text broke; the message is chosen here because that is
      // where the position and the offending token are.
      this.at = numberFailurePosition(this.source, this.at);
      if (end === NUMBER_NO_INTEGER_DIGIT) throw this.fail(`Unexpected token ${this.describe()}`);
      if (end === NUMBER_NO_DIGIT_AFTER_MINUS) throw this.fail("No number after minus sign");
      if (end === NUMBER_UNTERMINATED_FRACTION) throw this.fail("Unterminated fractional number");
      throw this.fail("Exponent part is missing a number");
    }
    const start = this.at;
    this.at = end;
    return numberValueOf(this.source, start, end);
  }
}

// Why the number scan is three functions rather than one.
//
// `readNumber` used to do all of it, and could not be compiled: it raises `SyntaxError`, which
// is not a representable type in this lowering yet, so the whole function was refused and with
// it the hottest loop in the parser. The scan and the conversion are pure computation over a
// string and an index, and neither of them needs to raise anything -- so they are separated out
// and only the choosing of a message is left in the method.
//
// This is the same boundary `json/text.ts` draws for the serializer, and it is a real one rather
// than a shape forced by the compiler: a scanner that reports where it stopped and why is
// independently testable and independently measurable, which is how it reached the compiled
// axis and the bench table. That it also routes around a refusal is true and is not the
// justification; the refusal is reported and MainClaude has it.

/** The first digit of the integer part was missing. */
const NUMBER_NO_INTEGER_DIGIT = -1;
/** A minus sign with nothing after it. Unreachable through `peek`, kept for the grammar's sake. */
const NUMBER_NO_DIGIT_AFTER_MINUS = -2;
/** A decimal point with no digit after it. */
const NUMBER_UNTERMINATED_FRACTION = -3;
/** An `e` with no digit after it, sign or not. */
const NUMBER_NO_EXPONENT_DIGIT = -4;

/** The digit count past which an accumulated integer may already have rounded. */
const EXACT_INTEGER_DIGITS = 15;


/**
 * ECMA-404's number grammar, scanned.
 *
 * Returns the index one past the number, or one of the negative codes above. Pure: it reads a
 * string and returns a number, which is why it compiles where `readNumber` does not.
 *
 * **There is no bounds guard, and that is not an oversight.** Past the end `charCodeAt` is NaN,
 * and every use of a unit here is either `=== ` some constant or `isDigit`, all of which NaN
 * fails -- so NaN *is* the end-of-input sentinel, exactly as the `-1` it replaced was. The guard
 * this used to carry duplicated the one inside `charCodeAt`. It also took a `length` parameter to
 * do it, which both callers passed `source.length`; the parameter is gone rather than left
 * unused, because a caller passing a narrower limit would now be silently wrong.
 *
 * **`| 0` at the top is load-bearing.** The runtime has two entries behind `charCodeAt`: one
 * taking an integer index, which is an unsigned compare and a read, and one taking a double,
 * which truncates through `ToIntegerOrInfinity`, compares twice in floating point against a
 * converted length, and converts again. A local proved `int32` gets the first and a `number`
 * parameter gets the second, on every character. Coercing once at entry keeps every read below on
 * the fast entry; doing it at each read instead still pays a conversion per character.
 *
 * Between them these took the row from 4.33us to 2.28us -- past node and past bun. Which entry
 * was chosen is visible in the emitted C, so this is checkable without running anything:
 * `nts_str_char_code_at_int` is the fast one.
 */
export function scanNumber(source: string, from: number): number {
  let at = from | 0;
  if (source.charCodeAt(at) === MINUS) at = (at + 1) | 0;
  const intStart = at;
  if (source.charCodeAt(at) === ZERO) {
    at = (at + 1) | 0;
  } else {
    if (!isDigit(source.charCodeAt(at))) return NUMBER_NO_INTEGER_DIGIT;
    while (isDigit(source.charCodeAt(at))) at = (at + 1) | 0;
  }
  if (at === intStart) return NUMBER_NO_DIGIT_AFTER_MINUS;
  if (source.charCodeAt(at) === DOT) {
    at = (at + 1) | 0;
    if (!isDigit(source.charCodeAt(at))) return NUMBER_UNTERMINATED_FRACTION;
    while (isDigit(source.charCodeAt(at))) at = (at + 1) | 0;
  }
  const exponent = source.charCodeAt(at);
  if (exponent === LOWER_E || exponent === UPPER_E) {
    at = (at + 1) | 0;
    const sign = source.charCodeAt(at);
    if (sign === PLUS || sign === MINUS) at = (at + 1) | 0;
    if (!isDigit(source.charCodeAt(at))) return NUMBER_NO_EXPONENT_DIGIT;
    while (isDigit(source.charCodeAt(at))) at = (at + 1) | 0;
  }
  return at;
}

/**
 * Where a failed scan stopped, so the message can name the offending token.
 *
 * Re-walked rather than returned alongside the code, because a scan that succeeds -- which is
 * every scan in a well-formed document -- would otherwise pay for a second return value it never
 * reads. The failing path is allowed to be slow.
 */
function numberFailurePosition(source: string, from: number): number {
  let at = from | 0;
  if (source.charCodeAt(at) === MINUS) at++;
  if (source.charCodeAt(at) === ZERO) {
    at++;
  } else {
    while (isDigit(source.charCodeAt(at))) at++;
  }
  if (source.charCodeAt(at) === DOT) {
    at++;
    while (isDigit(source.charCodeAt(at))) at++;
  }
  const exponent = source.charCodeAt(at);
  if (exponent === LOWER_E || exponent === UPPER_E) {
    at++;
    const sign = source.charCodeAt(at);
    if (sign === PLUS || sign === MINUS) at++;
    while (isDigit(source.charCodeAt(at))) at++;
  }
  return at;
}

/**
 * The value of a scanned number.
 *
 * An integer short enough to be exact is accumulated from its digits, which costs no substring;
 * `Number` on a slice is the fallback and is what 25.5.2 means in every other case. Pure, for
 * the same reason `scanNumber` is.
 */
export function numberValueOf(source: string, start: number, end: number): number {
  const negative = source.charCodeAt(start) === MINUS;
  const intStart = negative ? start + 1 : start;
  let at = intStart | 0;
  let integer = 0;
  while (at < end) {
    const code = source.charCodeAt(at);
    if (!isDigit(code)) break;
    integer = integer * 10 + (code - ZERO);
    at++;
  }
  // Only when the digits are the whole number and there are few enough of them to be exact.
  // `-0` is a number JSON can write, and negating an accumulated zero gives it, which is what
  // `Number("-0")` gives too.
  if (at === end && at - intStart <= EXACT_INTEGER_DIGITS) {
    return negative ? -integer : integer;
  }
  return Number(source.slice(start, end));
}

export function isDigit(code: number): boolean {
  return code >= ZERO && code <= NINE;
}

function hexValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  return -1;
}

/**
 * Parse JSON text into the erased graph.
 *
 * `text` is a UTF-16 string; the caller has already applied `ToString`.
 */
export function parseJsonText(text: string): JsonValue {
  const scanner = new Scanner(text);
  scanner.skipWhitespace();
  const value = readValue(scanner);
  scanner.skipWhitespace();
  if (scanner.at < scanner.length) {
    throw scanner.fail(`Unexpected non-whitespace character after JSON data`);
  }
  return value;
}

/** Reads one complete value, iterating over an explicit frame stack rather than recursing. */
function readValue(scanner: Scanner): JsonValue {
  // One frame per depth reached, reopened for each container at that depth: `depth` are open.
  const frames: Frame[] = [];
  let depth = 0;
  for (;;) {
    scanner.skipWhitespace();
    const start = scanner.at;
    const code = scanner.peek();
    let value: JsonValue;

    if (code === OPEN_BRACE || code === OPEN_BRACKET) {
      const isArray = code === OPEN_BRACKET;
      scanner.at++;
      const frame = openFrame(frames, depth, isArray, start);
      depth++;
      scanner.skipWhitespace();
      if (scanner.peek() !== (isArray ? CLOSE_BRACKET : CLOSE_BRACE)) {
        // A container was opened and its first member still has to be read, so go round again
        // rather than unwinding. This is the branch a recursive parser would have made a call.
        if (!isArray) readKey(scanner, frame);
        continue;
      }
      scanner.at++;
      depth--;
      value = closeFrame(frames, depth, scanner.at);
    } else if (code === QUOTE) {
      value = JsonValue.stringValue(scanner.readString(), start, scanner.at);
    } else if (code === MINUS || isDigit(code)) {
      value = JsonValue.numberValue(scanner.readNumber(), start, scanner.at);
    } else if (code === LOWER_T) {
      scanner.expectWord("true");
      value = JsonValue.booleanValue(true, start, scanner.at);
    } else if (code === LOWER_F) {
      scanner.expectWord("false");
      value = JsonValue.booleanValue(false, start, scanner.at);
    } else if (code === LOWER_N) {
      scanner.expectWord("null");
      value = JsonValue.nullValue(start, scanner.at);
    } else {
      throw scanner.fail(`Unexpected token ${scanner.describe()}`);
    }

    for (;;) {
      if (depth === 0) return value;
      const frame = frames[depth - 1] as Frame;
      if (frame.isArray) {
        frame.items.push(value);
      } else {
        frame.addKey();
        frame.values.push(value);
      }
      scanner.skipWhitespace();
      const next = scanner.peek();
      if (next === COMMA) {
        scanner.at++;
        // A trailing comma is JavaScript, not JSON: the next token has to open a value.
        if (!frame.isArray) readKey(scanner, frame);
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
      depth--;
      value = closeFrame(frames, depth, scanner.at);
    }
  }
}

/** The frame for a container opened at `depth`: the one that depth had, reopened. */
function openFrame(frames: Frame[], depth: number, isArray: boolean, start: number): Frame {
  const template = isArray ? UNUSED_KEYS : templateFor(frames, depth);
  if (depth === frames.length) frames.push(new Frame());
  const frame = frames[depth] as Frame;
  frame.open(isArray, start, template);
  return frame;
}

/**
 * The value of the container at `depth`, which has just closed at `end`.
 *
 * An object whose keys are the very list a plain sibling kept is plain itself -- the answer
 * depends on the list alone, and nothing changes a list once an object has it -- so it skips
 * {@link JsonValue.objectValue}'s check for index-like and repeated keys, a scan of every key
 * against every other once per row.
 */
function closeFrame(frames: Frame[], depth: number, end: number): JsonValue {
  const frame = frames[depth] as Frame;
  if (frame.isArray) return JsonValue.arrayValue(frame.items, frame.start, end);
  const keys = frame.finishedKeys();
  if (depth === 0) return JsonValue.objectValue(keys, frame.values, frame.start, end);
  const parent = frames[depth - 1] as Frame;
  if (!parent.isArray) return JsonValue.objectValue(keys, frame.values, frame.start, end);
  if (keys === parent.plainKeys) {
    return JsonValue.plainObjectValue(keys, frame.values, frame.start, end);
  }
  const value = JsonValue.objectValue(keys, frame.values, frame.start, end);
  // The plain path keeps the list it was given; every other path builds its own.
  if (value.keys === keys) parent.plainKeys = keys;
  return value;
}

/**
 * The keys an object opened now is likely to have, in order: those of the object before it in
 * the same array. That is what an array of records is -- every row spelling the same few keys --
 * and the guess costs nothing when it is wrong, because {@link readKey} only takes a key from it
 * after reading the same text in the source. Anything else expects nothing.
 */
function templateFor(frames: readonly Frame[], depth: number): readonly string[] {
  if (depth === 0) return UNUSED_KEYS;
  const parent = frames[depth - 1] as Frame;
  if (!parent.isArray || parent.items.length === 0) return UNUSED_KEYS;
  const previous = parent.items[parent.items.length - 1] as JsonValue;
  return previous.kind === "object" ? previous.keys : UNUSED_KEYS;
}

/**
 * Read the next member key into the frame: its expected one when the source spells exactly
 * that, and a fresh read otherwise.
 *
 * Taking the expected string is not only a skipped scan. A key read is a new string, made from
 * a slice of the source and given back when its object dies, and an array of records made one
 * per member per row -- 10,000 of `benchmarks/cases/json-parse`'s 2,000 rows -- each identical to
 * the one before. Now the rows share their keys.
 */
function readKey(scanner: Scanner, frame: Frame): void {
  const index = frame.keyCount();
  if (index < frame.template.length) {
    const expected = frame.template[index] as string;
    if (matchPlainKey(scanner, expected)) {
      frame.pendingKey = expected;
      frame.pendingShared = frame.sharing;
      return;
    }
  }
  frame.pendingKey = readMemberKey(scanner);
  frame.pendingShared = false;
}

/**
 * Consume `"expected" :` if that is what comes next, and say whether it was.
 *
 * Only a key the source writes *plainly* -- with no quote, backslash or control character in it --
 * is matched, and that is the whole correctness argument: for such a key the source text between
 * the quotes is the key, unit for unit, so comparing units is comparing keys. A key that needed
 * an escape (`"a\"b"`, `"\n"`) is never taken from the template, because its decoded units are
 * not its source text: a raw `"a"b"` would match the decoded `a"b` and be accepted where the
 * grammar refuses it. Those keys, and every mismatch, go to {@link readMemberKey} with nothing
 * consumed but whitespace.
 */
function matchPlainKey(scanner: Scanner, expected: string): boolean {
  scanner.skipWhitespace();
  const source = scanner.source;
  const open = scanner.at;
  if (source.charCodeAt(open) !== QUOTE) return false;
  const length = expected.length;
  const close = open + 1 + length;
  if (close >= scanner.length) return false;
  for (let index = 0; index < length; index++) {
    const code = expected.charCodeAt(index);
    if (code === QUOTE || code === BACKSLASH || code < SPACE) return false;
    if (source.charCodeAt(open + 1 + index) !== code) return false;
  }
  if (source.charCodeAt(close) !== QUOTE) return false;
  scanner.at = close + 1;
  scanner.skipWhitespace();
  if (scanner.peek() !== COLON) throw scanner.fail(`Expected ':' after property name`);
  scanner.at++;
  return true;
}

/** Reads `"key" :` and parks the key on the frame until its value completes. */
export function readMemberKey(scanner: Scanner): string {
  scanner.skipWhitespace();
  if (scanner.peek() !== QUOTE) {
    throw scanner.fail(`Expected property name or '}'`);
  }
  const key = scanner.readString();
  scanner.skipWhitespace();
  if (scanner.peek() !== COLON) {
    throw scanner.fail(`Expected ':' after property name`);
  }
  scanner.at++;
  return key;
}
