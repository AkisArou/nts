// `node:querystring`, from node v24.20.0 `lib/querystring.js`.
//
// The parser is one pass with no allocation per character: it walks the string
// tracking where the last field started and only slices when it reaches a
// separator. That is upstream's design and the reason `parse` is fast on a long
// query, so it is transcribed rather than replaced with `split`.

import { encodeStr, hexTable, isHexTable } from "../../internal/querystring.ts";
import { Buffer } from "../../buffer/src/main.ts";

export type ParsedUrlQuery = Record<string, string | string[]>;

/** A value `stringify` will accept. */
export type StringifiableValue =
  | string
  | number
  | bigint
  | boolean
  | ReadonlyArray<string | number | bigint | boolean>
  | null
  | undefined;

/**
 * Characters that need no escaping in a query string, node
 * `lib/querystring.js:146`: `! - . _ ~ ' ( ) *`, the digits, and the letters.
 */
// prettier-ignore
const noEscape: number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0 - 15
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 16 - 31
  0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, // 32 - 47
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, // 48 - 63
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 64 - 79
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, // 80 - 95
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 96 - 111
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, // 112 - 127
];

/** Hex digit values, indexed by code unit; -1 where there is none. */
// prettier-ignore
const unhexTable: number[] = (() => {
  const table = new Array<number>(256).fill(-1);
  for (let i = 0; i <= 9; i++) table[48 + i] = i;
  for (let i = 0; i < 6; i++) {
    table[65 + i] = 10 + i;  // A-F
    table[97 + i] = 10 + i;  // a-f
  }
  return table;
})();

/**
 * Percent-decoding onto bytes, node `lib/querystring.js:84`.
 *
 * Returns a `Buffer` because that is what node returns and what its callers
 * read: the test indexes it and calls `toString()`, which has to decode UTF-8
 * rather than join the digits with commas.
 */
export function unescapeBuffer(s: string, decodeSpaces = false): Buffer {
  const out = Buffer.allocUnsafe(s.length);
  let index = 0;
  let outIndex = 0;
  const maxLength = s.length - 2;
  let hasHex = false;

  while (index < s.length) {
    let currentChar = s.charCodeAt(index);
    if (currentChar === 43 /* + */ && decodeSpaces) {
      out[outIndex++] = 32;
      index++;
      continue;
    }
    if (currentChar === 37 /* % */ && index < maxLength) {
      currentChar = s.charCodeAt(++index);
      const hexHigh = unhexTable[currentChar] ?? -1;
      if (!(hexHigh >= 0)) {
        out[outIndex++] = 37;
        continue;
      }
      const nextChar = s.charCodeAt(++index);
      const hexLow = unhexTable[nextChar] ?? -1;
      if (!(hexLow >= 0)) {
        out[outIndex++] = 37;
        index--;
      } else {
        hasHex = true;
        currentChar = hexHigh * 16 + hexLow;
      }
    }
    out[outIndex++] = currentChar;
    index++;
  }
  return hasHex ? out.slice(0, outIndex) : out;
}

/** Upstream `lib/querystring.js:131`. */
export function unescape(s: string, decodeSpaces?: boolean): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return unescapeBuffer(s, decodeSpaces ?? false).toString();
  }
}

/** Upstream `lib/querystring.js:163`. `encodeURIComponent`, table-driven. */
export function escape(str: unknown): string {
  let value: string;
  if (typeof str !== "string") {
    if (typeof str === "object" && str !== null) {
      value = String(str);
    } else {
      value = `${str}`;
    }
  } else {
    value = str;
  }
  return encodeStr(value, noEscape, hexTable);
}

/** Upstream `lib/querystring.js:178`. */
function stringifyPrimitive(v: unknown): string {
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return `${v}`;
  }
  if (typeof v === "bigint") {
    return `${v}`;
  }
  if (typeof v === "boolean") {
    return v ? "true" : "false";
  }
  return "";
}

/** Upstream `lib/querystring.js:195`. */
function encodeStringified(v: unknown, encode: (s: string) => string): string {
  if (typeof v === "string") {
    return v.length ? encode(v) : "";
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    // At 1e21 and above the default spelling is exponential, and the `+` in it
    // needs escaping.
    return Math.abs(v) < 1e21 ? `${v}` : encode(`${v}`);
  }
  if (typeof v === "bigint") {
    return `${v}`;
  }
  if (typeof v === "boolean") {
    return v ? "true" : "false";
  }
  return "";
}

function encodeStringifiedCustom(v: unknown, encode: (s: string) => string): string {
  return encode(stringifyPrimitive(v));
}

export interface StringifyOptions {
  encodeURIComponent?: (v: string) => string;
}

/** Upstream `lib/querystring.js:227`. */
export function stringify(
  obj?: Record<string, StringifiableValue> | null,
  sep?: string,
  eq?: string,
  options?: StringifyOptions,
): string {
  sep ||= "&";
  eq ||= "=";

  let encode: (s: string) => string = QueryString.escape;
  if (options && typeof options.encodeURIComponent === "function") {
    encode = options.encodeURIComponent;
  }
  // Compared against the *original* `escape`, not `QueryString.escape`: a
  // caller who replaced the module's `escape` gets the custom path, which is
  // the point of replacing it. Upstream compares against `qsEscape` for the
  // same reason.
  const convert = encode === escape ? encodeStringified : encodeStringifiedCustom;

  if (obj !== null && typeof obj === "object") {
    const keys = Object.keys(obj);
    let fields = "";
    for (const k of keys) {
      const v = obj[k];
      let ks = convert(k, encode);
      ks += eq;

      if (Array.isArray(v)) {
        if (v.length === 0) {
          continue;
        }
        if (fields) {
          fields += sep;
        }
        for (let j = 0; j < v.length; ++j) {
          if (j) {
            fields += sep;
          }
          fields += ks;
          fields += convert(v[j], encode);
        }
      } else {
        if (fields) {
          fields += sep;
        }
        fields += ks;
        fields += convert(v, encode);
      }
    }
    return fields;
  }
  return "";
}

/** Upstream `lib/querystring.js:275`. */
function charCodes(str: string): number[] {
  const codes = new Array<number>(str.length);
  for (let i = 0; i < str.length; ++i) {
    codes[i] = str.charCodeAt(i);
  }
  return codes;
}

const defSepCodes = [38]; // &
const defEqCodes = [61]; // =

/** Upstream `lib/querystring.js:286`. A repeated key becomes an array. */
function addKeyVal(
  obj: ParsedUrlQuery,
  key: string,
  value: string,
  keyEncoded: boolean,
  valEncoded: boolean,
  decode: (s: string) => string,
): ParsedUrlQuery {
  if (key.length > 0 && keyEncoded) {
    key = decodeStr(key, decode);
  }
  if (value.length > 0 && valEncoded) {
    value = decodeStr(value, decode);
  }

  const current = Object.hasOwn(obj, key) ? obj[key] : undefined;
  if (current === undefined) {
    // In the direct TypeScript lane an ordinary object inherits the legacy
    // `__proto__` setter. A computed property in an object literal is always
    // an own data property, so seed that one exceptional key this way and
    // preserve everything already parsed. NTS records have no prototype, but
    // taking the same path keeps both representations observably identical.
    if (key === "__proto__") {
      const replacement: ParsedUrlQuery = { ["__proto__"]: value };
      for (const existingKey of Object.keys(obj)) {
        const existingValue = obj[existingKey];
        if (existingValue !== undefined) {
          replacement[existingKey] = existingValue;
        }
      }
      return replacement;
    }
    obj[key] = value;
  } else if (Array.isArray(current)) {
    current.push(value);
  } else {
    obj[key] = [current, value];
  }
  return obj;
}

export interface ParseOptions {
  maxKeys?: number;
  decodeURIComponent?: (v: string) => string;
}

/** Upstream `lib/querystring.js:317`. */
export function parse(
  qs?: string,
  sep?: string,
  eq?: string,
  options?: ParseOptions,
): ParsedUrlQuery {
  // NTS records have no prototype pointer, so an ordinary record already has
  // Node's intended null-prototype behavior in compiled code: `__proto__` is
  // just a key and no inherited name can collide with a query parameter.
  let obj: ParsedUrlQuery = {};

  if (typeof qs !== "string" || qs.length === 0) {
    return obj;
  }

  const sepCodes = !sep ? defSepCodes : charCodes(String(sep));
  const eqCodes = !eq ? defEqCodes : charCodes(String(eq));
  const sepLen = sepCodes.length;
  const eqLen = eqCodes.length;

  let pairs = 1000;
  if (options && typeof options.maxKeys === "number") {
    pairs = options.maxKeys > 0 ? options.maxKeys : -1;
  }

  let decode: (s: string) => string = QueryString.unescape;
  if (options && typeof options.decodeURIComponent === "function") {
    decode = options.decodeURIComponent;
  }
  // Against the original, for the reason `stringify` compares against the
  // original `escape`.
  const customDecode = decode !== unescape;

  let lastPos = 0;
  let sepIdx = 0;
  let eqIdx = 0;
  let key = "";
  let value = "";
  let keyEncoded = customDecode;
  let valEncoded = customDecode;
  const plusChar = customDecode ? "%20" : " ";
  let encodeCheck = 0;

  for (let i = 0; i < qs.length; ++i) {
    const code = qs.charCodeAt(i);

    if (code === sepCodes[sepIdx]) {
      if (++sepIdx === sepLen) {
        const end = i - sepIdx + 1;
        if (eqIdx < eqLen) {
          if (lastPos < end) {
            key += qs.slice(lastPos, end);
          } else if (key.length === 0) {
            if (--pairs === 0) {
              return obj;
            }
            lastPos = i + 1;
            sepIdx = eqIdx = 0;
            continue;
          }
        } else if (lastPos < end) {
          value += qs.slice(lastPos, end);
        }

        obj = addKeyVal(obj, key, value, keyEncoded, valEncoded, decode);

        if (--pairs === 0) {
          return obj;
        }
        keyEncoded = valEncoded = customDecode;
        key = value = "";
        encodeCheck = 0;
        lastPos = i + 1;
        sepIdx = eqIdx = 0;
      }
    } else {
      sepIdx = 0;
      if (eqIdx < eqLen) {
        if (code === eqCodes[eqIdx]) {
          if (++eqIdx === eqLen) {
            const end = i - eqIdx + 1;
            if (lastPos < end) {
              key += qs.slice(lastPos, end);
            }
            encodeCheck = 0;
            lastPos = i + 1;
          }
          continue;
        }
        eqIdx = 0;
        // A key is only decoded if it looks encoded: `%` then two hex digits.
        // Checking as we scan avoids a second pass over every key.
        if (!keyEncoded) {
          if (code === 37 /* % */) {
            encodeCheck = 1;
            continue;
          } else if (encodeCheck > 0) {
            if (isHexTable[code] === 1) {
              if (++encodeCheck === 3) {
                keyEncoded = true;
              }
              continue;
            }
            encodeCheck = 0;
          }
        }
        if (code === 43 /* + */) {
          if (lastPos < i) {
            key += qs.slice(lastPos, i);
          }
          key += plusChar;
          lastPos = i + 1;
          continue;
        }
      }
      if (code === 43 /* + */) {
        if (lastPos < i) {
          value += qs.slice(lastPos, i);
        }
        value += plusChar;
        lastPos = i + 1;
      } else if (!valEncoded) {
        if (code === 37 /* % */) {
          encodeCheck = 1;
        } else if (encodeCheck > 0) {
          if (isHexTable[code] === 1) {
            if (++encodeCheck === 3) {
              valEncoded = true;
            }
          } else {
            encodeCheck = 0;
          }
        }
      }
    }
  }

  if (lastPos < qs.length) {
    if (eqIdx < eqLen) {
      key += qs.slice(lastPos);
    } else if (sepIdx < sepLen) {
      value += qs.slice(lastPos);
    }
  } else if (eqIdx === 0 && key.length === 0) {
    // A trailing separator produces no pair at all.
    return obj;
  }

  obj = addKeyVal(obj, key, value, keyEncoded, valEncoded, decode);

  return obj;
}

/** Upstream `lib/querystring.js:478`. A decoder may throw on bad input. */
function decodeStr(s: string, decoder: (v: string) => string): string {
  try {
    return decoder(s);
  } catch {
    return QueryString.unescape(s, true);
  }
}

/**
 * The module object, as node has one.
 *
 * `parse` and `stringify` read `unescape` and `escape` off *this* at call time
 * rather than closing over the module-local bindings, because node's do:
 * replacing `querystring.unescape` changes what `parse` does, and its own tests
 * check that. An ESM module has no `module.exports` to read back, so the object
 * is explicit.
 */
export const QueryString = {
  escape,
  unescape,
  unescapeBuffer,
  parse,
  stringify,
  decode: parse,
  encode: stringify,
};

export const decode = parse;
export const encode = stringify;
