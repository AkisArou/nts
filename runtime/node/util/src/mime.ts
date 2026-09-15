// `MIMEType` and `MIMEParams`, from node v24.20.0 `lib/internal/mime.js`.
//
// A MIME type is not a string with a slash in it, which is the implementation
// everybody writes first. It is `type/subtype` followed by parameters, and every
// part of that has a grammar: a type is an HTTP token, a parameter value may be a
// quoted string with backslash escapes, whitespace is significant in some positions
// and not others, and a repeated parameter keeps its **first** value.
//
// Two things here are easy to get wrong and are why this follows node line by line
// rather than being rewritten.
//
// `toASCIILower` lowers `A-Z` and nothing else. `String.prototype.toLowerCase` is
// Unicode-aware, so it folds characters the MIME grammar does not consider equal
// and two distinct types could compare the same. Node tests for a non-ASCII
// character first and only then walks the string; the fast path is an optimisation
// and the slow path is the specification.
//
// And a parameter whose name is already present is **dropped**, not overwritten:
// `text/plain;a=1;a=2` answers `1`. That is the opposite of what assigning into a
// map does, which is why the parse loop tests `has` before `set`.
//
// Parsed eagerly where node defers it. Node's parse can raise nothing -- it ignores
// every malformed parameter rather than reporting one -- so laziness changes only
// when the work happens, and a `MIMEType` whose parameters are never read is not a
// case worth carrying two states for.

import { ERR_INVALID_MIME_SYNTAX } from "../../internal/errors.ts";

/** Anything that cannot appear in an HTTP token, which is what a type and a parameter name are. */
const NOT_HTTP_TOKEN_CODE_POINT = /[^!#$%&'*+\-.^_`|~A-Za-z0-9]/;

/**
 * Anything that cannot appear in an HTTP quoted string, which is what a parameter
 * value is: tab, printable ASCII, and the Latin-1 supplement.
 *
 * Built from a string rather than written as a literal because one of its range
 * boundaries is U+0080, which is itself a control character -- a source file
 * carrying it raw is a file nobody can review in a terminal.
 */
const NOT_HTTP_QUOTED_STRING_CODE_POINT = new RegExp(
  "[^\\t\\u0020-\\u007e\\u0080-\\u00ff]",
);

/** The first character that is not HTTP whitespace, or the end. */
const END_BEGINNING_WHITESPACE = /[^\r\n\t ]|$/;
/** Where the trailing HTTP whitespace begins. */
const START_ENDING_WHITESPACE = /[\r\n\t ]*$/;

const EQUALS_SEMICOLON_OR_END = /[;=]|$/;
const QUOTED_VALUE_PATTERN = /^(?:([\\]$)|[\\][\s\S]|[^"])*(?:(")|$)/u;

const SOLIDUS = "/";
const SEMICOLON = ";";

/**
 * Lower-case `A-Z` and leave everything else alone.
 *
 * Not `toLowerCase`, which is Unicode-aware: it would fold characters the MIME
 * grammar does not consider equal, so two distinct types could compare the same.
 */
function toASCIILower(str: string): string {
  if (!/[^\x00-\x7f]/.test(str)) return str.toLowerCase();
  let result = "";
  for (let index = 0; index < str.length; index++) {
    const char = str[index] as string;
    result += char >= "A" && char <= "Z" ? char.toLowerCase() : char;
  }
  return result;
}

/** `[type, subtype, positionAfterSubtype]`, or a throw naming which production failed. */
function parseTypeAndSubtype(str: string): [string, string, number] {
  let position = str.search(END_BEGINNING_WHITESPACE);
  const typeEnd = str.indexOf(SOLIDUS, position);
  const trimmedType = typeEnd === -1 ? str.slice(position) : str.slice(position, typeEnd);
  const invalidTypeIndex = trimmedType.search(NOT_HTTP_TOKEN_CODE_POINT);
  if (trimmedType === "" || invalidTypeIndex !== -1 || typeEnd === -1) {
    throw new ERR_INVALID_MIME_SYNTAX("type", str, invalidTypeIndex);
  }
  position = typeEnd + 1;
  const type = toASCIILower(trimmedType);

  const subtypeEnd = str.indexOf(SEMICOLON, position);
  const rawSubtype = subtypeEnd === -1 ? str.slice(position) : str.slice(position, subtypeEnd);
  position += rawSubtype.length;
  if (subtypeEnd !== -1) position += 1;
  const trimmedSubtype = rawSubtype.slice(0, rawSubtype.search(START_ENDING_WHITESPACE));
  const invalidSubtypeIndex = trimmedSubtype.search(NOT_HTTP_TOKEN_CODE_POINT);
  if (trimmedSubtype === "" || invalidSubtypeIndex !== -1) {
    throw new ERR_INVALID_MIME_SYNTAX("subtype", str, invalidSubtypeIndex);
  }
  return [type, toASCIILower(trimmedSubtype), position];
}

/** Undo the backslash escapes inside a quoted parameter value. */
function removeBackslashes(str: string): string {
  let result = "";
  let index = 0;
  // Stops one short, because a backslash is read together with the character after it.
  for (; index < str.length - 1; index++) {
    const char = str[index] as string;
    if (char === "\\") {
      index++;
      result += str[index] as string;
    } else {
      result += char;
    }
  }
  if (index === str.length - 1) result += str[index] as string;
  return result;
}

function escapeQuoteOrSolidus(str: string): string {
  let result = "";
  for (let index = 0; index < str.length; index++) {
    const char = str[index] as string;
    result += char === '"' || char === "\\" ? `\\${char}` : char;
  }
  return result;
}

/**
 * A parameter value as it goes on the wire: bare when it is a token, quoted when it
 * is not, and two quotes when it is empty.
 */
function encodeValue(value: string): string {
  if (value.length === 0) return '""';
  if (value.search(NOT_HTTP_TOKEN_CODE_POINT) === -1) return value;
  return `"${escapeQuoteOrSolidus(value)}"`;
}

export class MIMEParams {
  #data = new Map<string, string>();

  /**
   * Fill an instance from the text after the subtype.
   *
   * A static that this module **deletes from the class** after capturing it, which
   * is node's own arrangement. The reason is that `MIMEParams` must stay
   * constructible with no arguments -- `new MIMEParams("a=1")` answers an empty set
   * upstream, because its constructor takes nothing -- while `MIMEType` still needs
   * a way in. A constructor parameter would have been simpler and would have made
   * that call parse, which is a difference a caller can see.
   */
  static instantiateMimeParams(str: string): MIMEParams {
    const instance = new MIMEParams();
    instance.#parseInto(str);
    return instance;
  }

  delete(name: string): void {
    this.#data.delete(toASCIILower(`${name}`));
  }

  get(name: string): string | null {
    const value = this.#data.get(toASCIILower(`${name}`));
    return value === undefined ? null : value;
  }

  has(name: string): boolean {
    return this.#data.has(toASCIILower(`${name}`));
  }

  set(name: string, value: string): void {
    const key = toASCIILower(`${name}`);
    const text = `${value}`;
    const invalidNameIndex = key.search(NOT_HTTP_TOKEN_CODE_POINT);
    if (key.length === 0 || invalidNameIndex !== -1) {
      throw new ERR_INVALID_MIME_SYNTAX("parameter name", key, invalidNameIndex);
    }
    const invalidValueIndex = text.search(NOT_HTTP_QUOTED_STRING_CODE_POINT);
    if (invalidValueIndex !== -1) {
      throw new ERR_INVALID_MIME_SYNTAX("parameter value", text, invalidValueIndex);
    }
    this.#data.set(key, text);
  }

  *entries(): IterableIterator<[string, string]> {
    yield* this.#data.entries();
  }

  *keys(): IterableIterator<string> {
    yield* this.#data.keys();
  }

  *values(): IterableIterator<string> {
    yield* this.#data.values();
  }

  toString(): string {
    let result = "";
    for (const entry of this.#data) {
      if (result.length) result += ";";
      result += `${entry[0]}=${encodeValue(entry[1])}`;
    }
    return result;
  }

  /** Node aliases `toJSON` to `toString`, so `JSON.stringify` answers the wire form. */
  toJSON(): string {
    return this.toString();
  }

  /** Node defines `Symbol.iterator` as `entries`, so a params object spreads to pairs. */
  *[Symbol.iterator](): IterableIterator<[string, string]> {
    yield* this.entries();
  }

  #parseInto(str: string): void {
    const params = this.#data;
    let position = 0;
    const endOfSource = str.slice(position).search(START_ENDING_WHITESPACE) + position;
    while (position < endOfSource) {
      position += str.slice(position).search(END_BEGINNING_WHITESPACE);
      const afterParameterName = str.slice(position).search(EQUALS_SEMICOLON_OR_END) + position;
      const parameterString = toASCIILower(str.slice(position, afterParameterName));
      position = afterParameterName;
      if (position < endOfSource) {
        const terminator = str.charAt(position);
        position += 1;
        // A parameter with no value is dropped rather than stored empty.
        if (terminator === SEMICOLON) continue;
      }
      if (position >= endOfSource) break;
      const opener = str.charAt(position);
      let parameterValue: string;
      if (opener === '"') {
        position += 1;
        const insideMatch = QUOTED_VALUE_PATTERN.exec(str.slice(position));
        if (insideMatch === null) break;
        const whole = insideMatch[0] as string;
        position += whole.length;
        // The last character is dropped when it closed the quote or was a dangling
        // backslash: both are terminators rather than content.
        const inside = insideMatch[1] !== undefined || insideMatch[2] !== undefined
          ? whole.slice(0, -1)
          : whole;
        parameterValue = removeBackslashes(inside);
        if (insideMatch[1] !== undefined) parameterValue += "\\";
      } else {
        const valueEnd = str.indexOf(SEMICOLON, position);
        const rawValue = valueEnd === -1 ? str.slice(position) : str.slice(position, valueEnd);
        position += rawValue.length;
        const trimmedValue = rawValue.slice(0, rawValue.search(START_ENDING_WHITESPACE));
        if (trimmedValue === "") continue;
        parameterValue = trimmedValue;
      }
      // **`has` before `set`**: a repeated parameter keeps its first value, which is
      // the opposite of what assigning into a map does.
      if (
        parameterString !== "" &&
        parameterString.search(NOT_HTTP_TOKEN_CODE_POINT) === -1 &&
        parameterValue.search(NOT_HTTP_QUOTED_STRING_CODE_POINT) === -1 &&
        params.has(parameterString) === false
      ) {
        params.set(parameterString, parameterValue);
      }
      position++;
    }
  }
}

/**
 * Captured before the static is removed from the class, which is node's trick and is
 * the only way `MIMEType` can fill a `MIMEParams` that a caller cannot.
 */
const instantiateMimeParams = MIMEParams.instantiateMimeParams;
delete (MIMEParams as { instantiateMimeParams?: unknown }).instantiateMimeParams;

export class MIMEType {
  #type: string;
  #subtype: string;
  #parameters: MIMEParams;

  constructor(string: string) {
    const text = `${string}`;
    const data = parseTypeAndSubtype(text);
    this.#type = data[0];
    this.#subtype = data[1];
    this.#parameters = instantiateMimeParams(text.slice(data[2]));
  }

  get type(): string {
    return this.#type;
  }

  set type(value: string) {
    const text = `${value}`;
    const invalidTypeIndex = text.search(NOT_HTTP_TOKEN_CODE_POINT);
    if (text.length === 0 || invalidTypeIndex !== -1) {
      throw new ERR_INVALID_MIME_SYNTAX("type", text, invalidTypeIndex);
    }
    this.#type = toASCIILower(text);
  }

  get subtype(): string {
    return this.#subtype;
  }

  set subtype(value: string) {
    const text = `${value}`;
    const invalidSubtypeIndex = text.search(NOT_HTTP_TOKEN_CODE_POINT);
    if (text.length === 0 || invalidSubtypeIndex !== -1) {
      throw new ERR_INVALID_MIME_SYNTAX("subtype", text, invalidSubtypeIndex);
    }
    this.#subtype = toASCIILower(text);
  }

  /** `type/subtype` with no parameters, which is what a content negotiator compares. */
  get essence(): string {
    return `${this.#type}/${this.#subtype}`;
  }

  get params(): MIMEParams {
    return this.#parameters;
  }

  toString(): string {
    let result = `${this.#type}/${this.#subtype}`;
    const paramString = this.#parameters.toString();
    if (paramString.length) result += `;${paramString}`;
    return result;
  }

  /** Aliased to `toString`, as node's is. */
  toJSON(): string {
    return this.toString();
  }
}
