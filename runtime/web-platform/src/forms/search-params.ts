import { decodeUTF8, utf8 } from "../core/encoding.ts";
import { coerceToUSVString } from "../core/webidl.ts";

export type SearchParamEntry = readonly [name: string, value: string];
export type SearchParamSequenceEntry = Iterable<string> & object;
export type SearchParamSequence = Iterable<SearchParamSequenceEntry>;
export type SearchParamRecord = Readonly<Record<string, string>>;
export type URLSearchParamsInit = string | SearchParamSequence | SearchParamRecord;

const upperHex = "0123456789ABCDEF";

function hexDigit(code: number | undefined): number {
  if (code === undefined) {
    return -1;
  }
  if (code >= 48 && code <= 57) {
    return code - 48;
  }
  if (code >= 65 && code <= 70) {
    return code - 55;
  }
  if (code >= 97 && code <= 102) {
    return code - 87;
  }
  return -1;
}

function compareEntriesByName(left: SearchParamEntry, right: SearchParamEntry): number {
  if (left[0] < right[0]) {
    return -1;
  }
  return left[0] > right[0] ? 1 : 0;
}

function isFormSafe(byte: number): boolean {
  return (
    (byte >= 65 && byte <= 90) ||
    (byte >= 97 && byte <= 122) ||
    (byte >= 48 && byte <= 57) ||
    byte === 42 ||
    byte === 45 ||
    byte === 46 ||
    byte === 95
  );
}

function isSearchParamSequence(
  init: SearchParamSequence | SearchParamRecord,
): init is SearchParamSequence {
  return Symbol.iterator in init;
}

function convertSequenceEntry(entry: SearchParamSequenceEntry): SearchParamEntry {
  if ((typeof entry !== "object" || entry === null) && typeof entry !== "function") {
    throw new TypeError("Each query pair must be an iterable [name, value] tuple");
  }

  let name = "";
  let value = "";
  let length = 0;
  for (const item of entry) {
    if (length === 0) name = coerceToUSVString(item);
    else if (length === 1) value = coerceToUSVString(item);
    else throw new TypeError("Each query pair must be an iterable [name, value] tuple");
    length++;
  }
  if (length !== 2) {
    throw new TypeError("Each query pair must be an iterable [name, value] tuple");
  }
  return [name, value];
}

export function formEncode(input: string): string {
  const source = utf8.encode(input);
  let length = 0;

  for (const byte of source) {
    length += isFormSafe(byte) || byte === 32 ? 1 : 3;
  }

  const output = new Uint8Array(length);
  let offset = 0;
  for (const byte of source) {
    if (isFormSafe(byte)) {
      output[offset++] = byte;
    } else if (byte === 32) {
      output[offset++] = 43;
    } else {
      output[offset++] = 37;
      output[offset++] = upperHex.charCodeAt(byte >>> 4);
      output[offset++] = upperHex.charCodeAt(byte & 15);
    }
  }
  return decodeUTF8(output, false, true);
}

export function formDecode(input: string): string {
  const source = utf8.encode(input);
  const bytes = new Uint8Array(source.length);
  let length = 0;

  for (let i = 0; i < source.length; ++i) {
    const byte = source[i];
    if (byte === undefined) {
      break;
    }
    if (byte === 43) {
      bytes[length++] = 32;
    } else if (byte === 37) {
      const high = hexDigit(source[i + 1]);
      const low = hexDigit(source[i + 2]);
      if (high >= 0 && low >= 0) {
        bytes[length++] = high * 16 + low;
        i += 2;
        continue;
      }
      bytes[length++] = byte;
    } else {
      bytes[length++] = byte;
    }
  }
  return decodeUTF8(bytes.subarray(0, length), false, true);
}

/** Standalone URLSearchParams. Live linkage to URL is supplied by the existing NTS URL package. */
export class URLSearchParams {
  private readonly list: SearchParamEntry[] = [];

  constructor(init: URLSearchParamsInit = "") {
    if (typeof init === "string") {
      const query = init.startsWith("?") ? init.slice(1) : init;
      for (const part of query.split("&")) {
        if (part === "") {
          continue;
        }
        const index = part.indexOf("=");
        this.append(
          formDecode(index < 0 ? part : part.slice(0, index)),
          formDecode(index < 0 ? "" : part.slice(index + 1)),
        );
      }
    } else if (isSearchParamSequence(init)) {
      for (const entry of init) {
        this.list.push(convertSequenceEntry(entry));
      }
    } else {
      for (const [name, value] of Object.entries(init)) {
        this.append(name, value);
      }
    }
  }

  get size(): number {
    return this.list.length;
  }

  append(name: string, value: string): void {
    this.list.push([coerceToUSVString(name), coerceToUSVString(value)]);
  }

  get(name: string): string | null {
    const key = coerceToUSVString(name);
    for (const item of this.list) {
      if (item[0] === key) {
        return item[1];
      }
    }
    return null;
  }

  getAll(name: string): string[] {
    const key = coerceToUSVString(name);
    const values: string[] = [];
    for (const item of this.list) {
      if (item[0] === key) {
        values.push(item[1]);
      }
    }
    return values;
  }

  has(name: string, value?: string): boolean {
    const key = coerceToUSVString(name);
    const match = value === undefined ? undefined : coerceToUSVString(value);
    for (const item of this.list) {
      if (item[0] === key && (match === undefined || item[1] === match)) {
        return true;
      }
    }
    return false;
  }

  delete(name: string, value?: string): void {
    const key = coerceToUSVString(name);
    const match = value === undefined ? undefined : coerceToUSVString(value);
    let write = 0;
    for (const item of this.list) {
      if (item[0] !== key || (match !== undefined && item[1] !== match)) {
        this.list[write++] = item;
      }
    }
    this.list.length = write;
  }

  set(name: string, value: string): void {
    const key = coerceToUSVString(name);
    const val = coerceToUSVString(value);
    let found = false;
    let write = 0;
    for (const item of this.list) {
      if (item[0] !== key) {
        this.list[write++] = item;
      } else if (!found) {
        this.list[write++] = [key, val];
        found = true;
      }
    }
    if (!found) {
      this.list[write++] = [key, val];
    }
    this.list.length = write;
  }

  sort(): void {
    this.list.sort(compareEntriesByName);
  }

  *entries(): Generator<SearchParamEntry, void, unknown> {
    for (const entry of this.list) {
      yield [entry[0], entry[1]];
    }
  }

  *keys(): Generator<string, void, unknown> {
    for (const entry of this.entries()) {
      yield entry[0];
    }
  }

  *values(): Generator<string, void, unknown> {
    for (const entry of this.entries()) {
      yield entry[1];
    }
  }

  forEach(
    callback: (this: unknown, value: string, name: string, parent: URLSearchParams) => void,
    thisArg?: unknown,
  ): void {
    for (const [name, value] of this.entries()) {
      callback.call(thisArg, value, name, this);
    }
  }

  toString(): string {
    const result: string[] = [];
    for (const entry of this.list) {
      if (result.length !== 0) result.push("&");
      result.push(formEncode(entry[0]), "=", formEncode(entry[1]));
    }
    return result.join("");
  }

  [Symbol.iterator](): Generator<SearchParamEntry, void, unknown> {
    return this.entries();
  }

  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "URLSearchParams",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}
