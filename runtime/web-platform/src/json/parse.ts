// The JSON grammar, scanned and parsed without recursion.
//
// 25.5.2.1 `ParseJSON` validates against ECMA-404 and then evaluates; this does both in one
// pass, which is the same language and one traversal instead of two.
//
// **No recursion, deliberately.** `docs/web-platform-integration-plan.md` §9 requires an
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
const QUOTE = 0x22;
const PLUS = 0x2b;
const COMMA = 0x2c;
const MINUS = 0x2d;
const DOT = 0x2e;
const SLASH = 0x2f;
const ZERO = 0x30;
const NINE = 0x39;
const COLON = 0x3a;
const UPPER_E = 0x45;
const OPEN_BRACKET = 0x5b;
const BACKSLASH = 0x5c;
const CLOSE_BRACKET = 0x5d;
const LOWER_B = 0x62;
const LOWER_E = 0x65;
const LOWER_F = 0x66;
const LOWER_N = 0x6e;
const LOWER_R = 0x72;
const LOWER_T = 0x74;
const LOWER_U = 0x75;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;

/** One open container while parsing. Both payload lists exist so the frame has no union. */
class Frame {
  readonly isArray: boolean;
  readonly start: number;
  readonly items: JsonValue[] = [];
  readonly keys: string[] = [];
  readonly values: JsonValue[] = [];
  pendingKey = "";

  constructor(isArray: boolean, start: number) {
    this.isArray = isArray;
    this.start = start;
  }
}

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

class Scanner {
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
    const start = this.at;
    const negative = this.peek() === MINUS;
    if (negative) this.at++;
    const intStart = this.at;
    // Accumulated while the digits are scanned, so an integer costs no substring. Exact only
    // while it stays inside the integers a double represents without rounding, which is what
    // the digit count below bounds; anything longer, or carrying a fraction or an exponent,
    // falls through to the slice.
    let integer = 0;
    if (this.peek() === ZERO) {
      this.at++;
    } else {
      if (!isDigit(this.peek())) throw this.fail(`Unexpected token ${this.describe()}`);
      while (isDigit(this.peek())) {
        integer = integer * 10 + (this.source.charCodeAt(this.at) - ZERO);
        this.at++;
      }
    }
    if (this.at === intStart) throw this.fail("No number after minus sign");
    const digits = this.at - intStart;
    if (this.peek() !== DOT && this.peek() !== LOWER_E && this.peek() !== UPPER_E && digits <= 15) {
      // `-0` is a number JSON can write and `-integer` gives it, which `Number("-0")` also does.
      return negative ? -integer : integer;
    }
    if (this.peek() === DOT) {
      this.at++;
      if (!isDigit(this.peek())) throw this.fail("Unterminated fractional number");
      while (isDigit(this.peek())) this.at++;
    }
    const exponent = this.peek();
    if (exponent === LOWER_E || exponent === UPPER_E) {
      this.at++;
      const sign = this.peek();
      if (sign === PLUS || sign === MINUS) this.at++;
      if (!isDigit(this.peek())) throw this.fail("Exponent part is missing a number");
      while (isDigit(this.peek())) this.at++;
    }
    return Number(this.source.slice(start, this.at));
  }
}

function isDigit(code: number): boolean {
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
  const frames: Frame[] = [];
  for (;;) {
    scanner.skipWhitespace();
    const start = scanner.at;
    const code = scanner.peek();
    let value: JsonValue;
    let opened = false;

    if (code === OPEN_BRACE) {
      scanner.at++;
      const frame = new Frame(false, start);
      frames.push(frame);
      scanner.skipWhitespace();
      if (scanner.peek() === CLOSE_BRACE) {
        scanner.at++;
        frames.pop();
        value = JsonValue.objectValue(frame.keys, frame.values, start, scanner.at);
      } else {
        readMemberKey(scanner, frame);
        opened = true;
        value = JsonValue.nullValue(start, start);
      }
    } else if (code === OPEN_BRACKET) {
      scanner.at++;
      const frame = new Frame(true, start);
      frames.push(frame);
      scanner.skipWhitespace();
      if (scanner.peek() === CLOSE_BRACKET) {
        scanner.at++;
        frames.pop();
        value = JsonValue.arrayValue(frame.items, start, scanner.at);
      } else {
        opened = true;
        value = JsonValue.nullValue(start, start);
      }
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

    // A container was opened and its first member still has to be read, so go round again
    // rather than unwinding. This is the branch a recursive parser would have made a call.
    if (opened) continue;

    for (;;) {
      if (frames.length === 0) return value;
      const frame = frames[frames.length - 1] as Frame;
      if (frame.isArray) {
        frame.items.push(value);
      } else {
        frame.keys.push(frame.pendingKey);
        frame.values.push(value);
      }
      scanner.skipWhitespace();
      const next = scanner.peek();
      if (next === COMMA) {
        scanner.at++;
        // A trailing comma is JavaScript, not JSON: the next token has to open a value.
        if (!frame.isArray) readMemberKey(scanner, frame);
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
      value = frame.isArray
        ? JsonValue.arrayValue(frame.items, frame.start, scanner.at)
        : JsonValue.objectValue(frame.keys, frame.values, frame.start, scanner.at);
    }
  }
}

/** Reads `"key" :` and parks the key on the frame until its value completes. */
function readMemberKey(scanner: Scanner, frame: Frame): void {
  scanner.skipWhitespace();
  if (scanner.peek() !== QUOTE) {
    throw scanner.fail(`Expected property name or '}'`);
  }
  frame.pendingKey = scanner.readString();
  scanner.skipWhitespace();
  if (scanner.peek() !== COLON) {
    throw scanner.fail(`Expected ':' after property name`);
  }
  scanner.at++;
}
