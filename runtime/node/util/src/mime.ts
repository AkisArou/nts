// From Node v26.13.0 lib/internal/mime.js (complete body).
// Import/export and primordial scaffolding are normalized; static types follow.
import { ERR_ILLEGAL_CONSTRUCTOR, ERR_INVALID_MIME_SYNTAX } from "../../internal/errors.ts";





// Lookup table for the code point classes used by the MIME Sniffing
// standard. Only code points <= 0xFF can be in either class.
// https://mimesniff.spec.whatwg.org/#http-token-code-point
// https://mimesniff.spec.whatwg.org/#http-quoted-string-token-code-point
const kHTTPToken = 1;
const kHTTPQuotedStringToken = 2;
const codePointClass = new Uint8Array(256);
{
  codePointClass[0x09] = kHTTPQuotedStringToken;
  for (let c = 0x20; c <= 0x7E; c++) codePointClass[c] = kHTTPQuotedStringToken;
  for (let c = 0x80; c <= 0xFF; c++) codePointClass[c] = kHTTPQuotedStringToken;
  const tokens = "!#$%&'*+-.^_`|~0123456789" +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i < tokens.length; i++) {
    codePointClass[(tokens).charCodeAt(i)]! |= kHTTPToken;
  }
}

const kNoThrow = Symbol('kNoThrow');

// https://fetch.spec.whatwg.org/#http-whitespace
function isHTTPWhitespace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D;
}

/**
 * Returns the offset from `start` of the first code point in
 * `str[start, end)` that is not in `cls`, or -1 if they all are.
 * @param {string} str
 * @param {number} start
 * @param {number} end
 * @param {number} cls
 * @returns {number}
 */
function findInvalid(str: string, start: number, end: number, cls: number): number {
  for (let i = start; i < end; i++) {
    const c = (str).charCodeAt(i);
    if (c > 0xFF || (codePointClass[c]! & cls) === 0) return i - start;
  }
  return -1;
}

function toASCIILower(str: string): string {
  let hasUpper = false;
  for (let i = 0; i < str.length; i++) {
    const c = (str).charCodeAt(i);
    if (c > 0x7F) {
      let result = '';
      for (let j = 0; j < str.length; j++) {
        const char = str[j]!;
        result += char >= 'A' && char <= 'Z' ?
          (char).toLowerCase() :
          char;
      }
      return result;
    }
    if (c <= 0x5A && c >= 0x41) hasUpper = true;
  }
  // Returning the input unchanged when possible avoids an allocation and
  // keeps its cached hash for Map lookups.
  return hasUpper ? (str).toLowerCase() : str;
}

// Results of parseTypeAndSubtype(). Kept in module state to avoid allocating
// a result object per parse; they are consumed synchronously by the caller.
let parsedType = '';
let parsedSubtype = '';
let parsedParamsStart = 0;
let parsedParamsEnd = 0;
let failedProduction = '';
let failedIndex = -1;

/**
 * Parses the type and subtype of a MIME type string and locates its
 * parameters. Returns false on failure, with failedProduction and
 * failedIndex describing the error.
 * @see https://mimesniff.spec.whatwg.org/#parse-a-mime-type
 * @param {string} str
 * @returns {boolean}
 */
function parseTypeAndSubtype(str: string): boolean {
  const length = str.length;

  // Skip leading HTTP whitespace.
  let position = 0;
  while (position < length &&
         isHTTPWhitespace((str).charCodeAt(position))) {
    position++;
  }

  // Collect the type, up to '/'.
  const typeStart = position;
  let invalidTypeIndex = -1;
  let typeHasUpper = false;
  for (; position < length; position++) {
    const c = (str).charCodeAt(position);
    if (c === 0x2F /* / */) break;
    if (c > 0xFF || (codePointClass[c]! & kHTTPToken) === 0) {
      if (invalidTypeIndex === -1) invalidTypeIndex = position - typeStart;
    } else if (c <= 0x5A && c >= 0x41) {
      typeHasUpper = true;
    }
  }
  if (position === typeStart || invalidTypeIndex !== -1 || position >= length) {
    failedProduction = 'type';
    failedIndex = invalidTypeIndex;
    return false;
  }
  const typeEnd = position;

  // Skip '/' and collect the subtype, up to ';'. In the same pass, find the
  // first non-token code point and where the trailing HTTP whitespace starts.
  position++;
  const subtypeStart = position;
  let subtypeEnd = position;
  let firstNonToken = -1;
  let subtypeHasUpper = false;
  for (; position < length; position++) {
    const c = (str).charCodeAt(position);
    if (c === 0x3B /* ; */) break;
    if (c <= 0xFF && (codePointClass[c]! & kHTTPToken) !== 0) {
      if (c <= 0x5A && c >= 0x41) subtypeHasUpper = true;
    } else if (firstNonToken === -1) {
      firstNonToken = position;
    }
    if (!isHTTPWhitespace(c)) subtypeEnd = position + 1;
  }
  const subtypeRawEnd = position;
  // Whitespace is not a token code point, so a non-token code point at or
  // after subtypeEnd is part of the trailing whitespace, which is removed.
  const invalidSubtypeIndex = firstNonToken !== -1 && firstNonToken < subtypeEnd ?
    firstNonToken - subtypeStart : -1;
  if (subtypeEnd === subtypeStart || invalidSubtypeIndex !== -1) {
    failedProduction = 'subtype';
    failedIndex = invalidSubtypeIndex;
    return false;
  }

  // Parameters are everything after the ';' up to the trailing whitespace.
  let paramsEnd = length;
  while (paramsEnd > subtypeRawEnd &&
         isHTTPWhitespace((str).charCodeAt(paramsEnd - 1))) {
    paramsEnd--;
  }

  const type = (str).slice(typeStart, typeEnd);
  const subtype = (str).slice(subtypeStart, subtypeEnd);
  // Both are ASCII-only at this point, so toLowerCase() is ASCII lowercase.
  parsedType = typeHasUpper ? (type).toLowerCase() : type;
  parsedSubtype = subtypeHasUpper ? (subtype).toLowerCase() : subtype;
  parsedParamsStart = subtypeRawEnd + 1;
  parsedParamsEnd = paramsEnd;
  return true;
}

/**
 * Parses MIME type parameters from `str[position, end)` into `params`.
 * `position` is just past the ';' that follows the subtype, and `end`
 * excludes trailing HTTP whitespace. This is step 11 of
 * https://mimesniff.spec.whatwg.org/#parse-a-mime-type
 * @param {string} str
 * @param {number} position
 * @param {number} end
 * @param {SafeMap<string, string>} params
 */
function parseParameters(str: string, position: number, end: number, params: Map<string, string>): void {
  while (position < end) {
    // Skip HTTP whitespace.
    while (position < end &&
           isHTTPWhitespace((str).charCodeAt(position))) {
      position++;
    }

    // Collect the parameter name, up to ';' or '='.
    const nameStart = position;
    let nameIsToken = true;
    let nameHasUpper = false;
    for (; position < end; position++) {
      const c = (str).charCodeAt(position);
      if (c === 0x3B /* ; */ || c === 0x3D /* = */) break;
      if (c > 0xFF || (codePointClass[c]! & kHTTPToken) === 0) {
        nameIsToken = false;
      } else if (c <= 0x5A && c >= 0x41) {
        nameHasUpper = true;
      }
    }
    const nameEnd = position;

    if (position < end) {
      // Parameters without a value are ignored.
      if ((str).charCodeAt(position) === 0x3B /* ; */) {
        position++;
        continue;
      }
      // Skip '='.
      position++;
    }
    if (position >= end) break;

    let value: string;
    if ((str).charCodeAt(position) === 0x22 /* " */) {
      // Collect an HTTP quoted string with the extract-value flag.
      // https://fetch.spec.whatwg.org/#collect-an-http-quoted-string
      position++;
      value = '';
      let chunkStart = position;
      while (true) {
        while (position < end) {
          const c = (str).charCodeAt(position);
          if (c === 0x22 /* " */ || c === 0x5C /* \ */) break;
          position++;
        }
        if (position >= end) {
          value += (str).slice(chunkStart, position);
          break;
        }
        const quoteOrBackslash = (str).charCodeAt(position);
        value += (str).slice(chunkStart, position);
        position++;
        if (quoteOrBackslash === 0x5C /* \ */) {
          if (position >= end) {
            value += '\\';
            break;
          }
          // The escaped code point starts the next chunk.
          chunkStart = position;
          position++;
        } else {
          break;
        }
      }
      // Skip anything else up to the next ';'.
      while (position < end &&
             (str).charCodeAt(position) !== 0x3B /* ; */) {
        position++;
      }
      if (findInvalid(value, 0, value.length, kHTTPQuotedStringToken) !== -1) {
        position++;
        continue;
      }
    } else {
      // Collect the value up to ';', validating it and finding where its
      // trailing HTTP whitespace starts in the same pass. CR and LF are not
      // quoted-string token code points, but trailing ones are removed, so
      // the value is only invalid if a bad code point comes before valueEnd.
      const valueStart = position;
      let valueEnd = position;
      let firstInvalid = -1;
      for (; position < end; position++) {
        const c = (str).charCodeAt(position);
        if (c === 0x3B /* ; */) break;
        if (firstInvalid === -1 &&
            (c > 0xFF || (codePointClass[c]! & kHTTPQuotedStringToken) === 0)) {
          firstInvalid = position;
        }
        if (!isHTTPWhitespace(c)) valueEnd = position + 1;
      }
      // Parameters with an empty or invalid value are ignored.
      if (valueEnd === valueStart ||
          (firstInvalid !== -1 && firstInvalid < valueEnd)) {
        position++;
        continue;
      }
      value = (str).slice(valueStart, valueEnd);
    }

    if (nameEnd !== nameStart && nameIsToken) {
      // The name is ASCII-only, so toLowerCase() is ASCII lowercase.
      const name = nameHasUpper ?
        ((str).slice(nameStart, nameEnd)).toLowerCase() :
        (str).slice(nameStart, nameEnd);
      if (!params.has(name)) params.set(name, value);
    }
    // Skip ';'.
    position++;
  }
}

function escapeQuoteOrSolidus(str: string): string {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const char = str[i]!;
    result += (char === '"' || char === '\\') ? `\\${char}` : char;
  }
  return result;
}

const encode = (value: string): string => {
  if (value.length === 0) return '""';
  if (findInvalid(value, 0, value.length, kHTTPToken) === -1) return value;
  return `"${escapeQuoteOrSolidus(value)}"`;
};

let instantiateMimeParams: (str: string, start: number, end: number) => MIMEParams;
class MIMEParams {
  // Parsing is deferred until the parameters are first accessed, as most
  // users only need the type and subtype. Until then #data is null and
  // #string[#start, #end) holds the unparsed parameters.
  #data: Map<string, string> | null = null;
  #string: string | null = null;
  #start = 0;
  #end = 0;

  /**
   * Used to instantiate a MIMEParams object within the MIMEType class and
   * to allow it to be parsed lazily.
   * @returns {MIMEParams}
   */
  static {
    instantiateMimeParams = function instantiateMimeParams(str: string, start: number, end: number): MIMEParams {
      const instance = new MIMEParams();
      instance.#string = str;
      instance.#start = start;
      instance.#end = end;
      return instance;
    };
  }

  /**
   * @param {string} name
   * @returns {void}
   */
  delete(name: unknown): void {
    this.#parse().delete(toASCIILower(`${name}`));
  }

  get(name: unknown): string | null {
    const value = this.#parse().get(toASCIILower(`${name}`));
    return value === undefined ? null : value;
  }

  has(name: unknown): boolean {
    return this.#parse().has(toASCIILower(`${name}`));
  }

  set(rawName: unknown, rawValue: unknown): void {
    const data = this.#parse();
    let name = toASCIILower(`${rawName}`);
    let value = `${rawValue}`;
    const invalidNameIndex = findInvalid(name, 0, name.length, kHTTPToken);
    if (name.length === 0 || invalidNameIndex !== -1) {
      throw new ERR_INVALID_MIME_SYNTAX(
        'parameter name',
        name,
        invalidNameIndex,
      );
    }
    const invalidValueIndex = findInvalid(value, 0, value.length,
                                          kHTTPQuotedStringToken);
    if (invalidValueIndex !== -1) {
      throw new ERR_INVALID_MIME_SYNTAX(
        'parameter value',
        value,
        invalidValueIndex,
      );
    }
    data.set(name, value);
  }

  *entries(): IterableIterator<[string, string]> {
    yield* this.#parse().entries();
  }

  *keys(): IterableIterator<string> {
    yield* this.#parse().keys();
  }

  *values(): IterableIterator<string> {
    yield* this.#parse().values();
  }

  toString(): string {
    let ret = '';
    for (const { 0: key, 1: value } of this.#parse()) {
      const encoded = encode(value);
      // Ensure they are separated
      if (ret.length) ret += ';';
      ret += `${key}=${encoded}`;
    }
    return ret;
  }

  /**
   * Parses the deferred parameter string on first use.
   * @returns {SafeMap<string, string>}
   */
  #parse(): Map<string, string> {
    let data = this.#data;
    if (data !== null) return data;
    data = this.#data = new Map();
    const str = this.#string;
    if (str !== null) {
      this.#string = null;
      parseParameters(str, this.#start, this.#end, data);
    }
    return data;
  }
}
const MIMEParamsStringify = MIMEParams.prototype.toString;
interface NullPrototypePropertyDescriptor extends PropertyDescriptor {
  __proto__?: null;
}
const mimeParamsIteratorDescriptor: NullPrototypePropertyDescriptor = {
  __proto__: null,
  configurable: true,
  value: MIMEParams.prototype.entries,
  writable: true,
};
Object.defineProperty(MIMEParams.prototype, Symbol.iterator, mimeParamsIteratorDescriptor);
const mimeParamsJSONDescriptor: NullPrototypePropertyDescriptor = {
  __proto__: null,
  configurable: true,
  value: MIMEParamsStringify,
  writable: true,
};
Object.defineProperty(MIMEParams.prototype, 'toJSON', mimeParamsJSONDescriptor);

// mime.transcription.json proves that the private marker is passed only by
// parse(), after string conversion. This is an internal invariant, not a
// replacement for any public Node validation or error.
function assertMimeParseString(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new Error("nts internal invariant: MIME parser expected a string");
  }
}

class MIMEType {
  #type!: string;
  #subtype!: string;
  #parameters!: MIMEParams;
  constructor(rawString: unknown, noThrowSymbol: unknown = null) {
    // MIMEType.parse() has already parsed the string successfully.
    if (noThrowSymbol === kNoThrow) {
      assertMimeParseString(rawString);
      this.#init(rawString);
      return;
    }
    let string = `${rawString}`;
    if (noThrowSymbol != null) {
      throw new ERR_ILLEGAL_CONSTRUCTOR();
    }
    if (!parseTypeAndSubtype(string)) {
      throw new ERR_INVALID_MIME_SYNTAX(failedProduction, string, failedIndex);
    }
    this.#init(string);
  }

  // Consumes the results of a successful parseTypeAndSubtype(string).
  #init(string: string): void {
    this.#type = parsedType;
    this.#subtype = parsedSubtype;
    this.#parameters = instantiateMimeParams(string, parsedParamsStart,
                                             parsedParamsEnd);
  }

  // Like the constructor, but returns null instead of throwing on invalid input.
  static parse(rawString: unknown): MIMEType | null {
    let string = `${rawString}`;
    if (!parseTypeAndSubtype(string)) return null;
    return new MIMEType(string, kNoThrow);
  }

  get type() {
    return this.#type;
  }

  set type(rawValue: unknown) {
    let v = `${rawValue}`;
    const invalidTypeIndex = findInvalid(v, 0, v.length, kHTTPToken);
    if (v.length === 0 || invalidTypeIndex !== -1) {
      throw new ERR_INVALID_MIME_SYNTAX('type', v, invalidTypeIndex);
    }
    this.#type = toASCIILower(v);
  }

  get subtype() {
    return this.#subtype;
  }

  set subtype(rawValue: unknown) {
    let v = `${rawValue}`;
    const invalidSubtypeIndex = findInvalid(v, 0, v.length, kHTTPToken);
    if (v.length === 0 || invalidSubtypeIndex !== -1) {
      throw new ERR_INVALID_MIME_SYNTAX('subtype', v, invalidSubtypeIndex);
    }
    this.#subtype = toASCIILower(v);
  }

  get essence() {
    return `${this.#type}/${this.#subtype}`;
  }

  get params() {
    return this.#parameters;
  }

  toString(): string {
    let ret = `${this.#type}/${this.#subtype}`;
    const paramStr = (MIMEParamsStringify).call(this.#parameters);
    if (paramStr.length) ret += `;${paramStr}`;
    return ret;
  }
}
const mimeTypeJSONDescriptor: NullPrototypePropertyDescriptor = {
  __proto__: null,
  configurable: true,
  value: MIMEType.prototype.toString,
  writable: true,
};
Object.defineProperty(MIMEType.prototype, 'toJSON', mimeTypeJSONDescriptor);

// These properties are installed by the unchanged registration statements.
interface MIMEParams extends Iterable<[string, string]> {
  toJSON(): string;
}
interface MIMEType {
  toJSON(): string;
}
export { MIMEParams, MIMEType };
