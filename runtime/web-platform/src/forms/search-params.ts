import { decodeUTF8, utf8 } from "../core/encoding.ts";
import { toUSVString } from "../core/webidl.ts";

export type SearchParamEntry = readonly [name: string, value: string];

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

export function formEncode(input: string): string {
  let result = "";

  for (const byte of utf8.encode(input)) {
    if (
      (byte >= 65 && byte <= 90) ||
      (byte >= 97 && byte <= 122) ||
      (byte >= 48 && byte <= 57) ||
      byte === 42 ||
      byte === 45 ||
      byte === 46 ||
      byte === 95
    ) {
      result += String.fromCharCode(byte);
    } else if (byte === 32) {
      result += "+";
    } else {
      result += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return result;
}

export function formDecode(input: string): string {
  const source = utf8.encode(input.replace(/\+/g, " "));
  const bytes = new Uint8Array(source.length);
  let length = 0;

  for (let i = 0; i < source.length; ++i) {
    const byte = source[i];
    if (byte === undefined) {
      break;
    }
    if (byte === 37) {
      const high = hexDigit(source[i + 1]);
      const low = hexDigit(source[i + 2]);
      if (high >= 0 && low >= 0) {
        bytes[length++] = high * 16 + low;
        i += 2;
        continue;
      }
    }
    bytes[length++] = byte;
  }
  return decodeUTF8(bytes.subarray(0, length), false, true);
}

/** Standalone URLSearchParams. Live linkage to URL is supplied by the existing NTS URL package. */
export class URLSearchParams {
  private list: SearchParamEntry[] = [];

  constructor(init: string | readonly SearchParamEntry[] | URLSearchParams = "") {
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
    } else {
      for (const [name, value] of init) {
        this.append(name, value);
      }
    }
  }

  get size(): number {
    return this.list.length;
  }

  append(name: string, value: string): void {
    this.list.push([toUSVString(name), toUSVString(value)]);
  }

  get(name: string): string | null {
    const key = toUSVString(name);
    for (const item of this.list) {
      if (item[0] === key) {
        return item[1];
      }
    }
    return null;
  }

  getAll(name: string): string[] {
    const key = toUSVString(name);
    const values: string[] = [];
    for (const item of this.list) {
      if (item[0] === key) {
        values.push(item[1]);
      }
    }
    return values;
  }

  has(name: string, value?: string): boolean {
    const key = toUSVString(name);
    const match = value === undefined ? undefined : toUSVString(value);
    for (const item of this.list) {
      if (item[0] === key && (match === undefined || item[1] === match)) {
        return true;
      }
    }
    return false;
  }

  delete(name: string, value?: string): void {
    const key = toUSVString(name);
    const match = value === undefined ? undefined : toUSVString(value);
    let write = 0;
    for (const item of this.list) {
      if (item[0] !== key || (match !== undefined && item[1] !== match)) {
        this.list[write++] = item;
      }
    }
    this.list.length = write;
  }

  set(name: string, value: string): void {
    const key = toUSVString(name);
    const val = toUSVString(value);
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
    for (let i = 0; i < this.list.length; ++i) {
      const entry = this.list[i];
      if (entry !== undefined) {
        yield [entry[0], entry[1]];
      }
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
    let result = "";
    for (const entry of this.list) {
      if (result.length !== 0) {
        result += "&";
      }
      result += formEncode(entry[0]) + "=" + formEncode(entry[1]);
    }
    return result;
  }

  [Symbol.iterator](): Generator<SearchParamEntry, void, unknown> {
    return this.entries();
  }
}
