import { decodeUTF8, utf8 } from "../core/encoding.ts";
import { toUSVString } from "../core/webidl.ts";

export type SearchParamEntry = readonly [name: string, value: string];

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
    )
      result += String.fromCharCode(byte);
    else if (byte === 32) result += "+";
    else result += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return result;
}

export function formDecode(input: string): string {
  const source = utf8.encode(input.replace(/\+/g, " "));
  const bytes = new Uint8Array(source.length);
  let length = 0;
  const hex = (c: number | undefined): number => {
    if (c === undefined) return -1;
    if (c >= 48 && c <= 57) return c - 48;
    if (c >= 65 && c <= 70) return c - 55;
    if (c >= 97 && c <= 102) return c - 87;
    return -1;
  };

  for (let i = 0; i < source.length; ++i) {
    const byte = source[i];
    if (byte === undefined) break;
    if (byte === 37) {
      const high = hex(source[i + 1]);
      const low = hex(source[i + 2]);
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
        if (part === "") continue;
        const index = part.indexOf("=");
        this.append(
          formDecode(index < 0 ? part : part.slice(0, index)),
          formDecode(index < 0 ? "" : part.slice(index + 1)),
        );
      }
    } else for (const [name, value] of init) this.append(name, value);
  }

  get size(): number {
    return this.list.length;
  }

  append(name: string, value: string): void {
    this.list.push([toUSVString(name), toUSVString(value)]);
  }

  get(name: string): string | null {
    return this.list.find((item) => item[0] === toUSVString(name))?.[1] ?? null;
  }

  getAll(name: string): string[] {
    const key = toUSVString(name);
    return this.list.filter((item) => item[0] === key).map((item) => item[1]);
  }

  has(name: string, value?: string): boolean {
    const key = toUSVString(name);
    const match = value === undefined ? undefined : toUSVString(value);
    return this.list.some((item) => item[0] === key && (match === undefined || item[1] === match));
  }

  delete(name: string, value?: string): void {
    const key = toUSVString(name);
    const match = value === undefined ? undefined : toUSVString(value);
    this.list = this.list.filter(
      (item) => item[0] !== key || (match !== undefined && item[1] !== match),
    );
  }

  set(name: string, value: string): void {
    const key = toUSVString(name);
    const val = toUSVString(value);
    let found = false;
    const result: SearchParamEntry[] = [];
    for (const item of this.list) {
      if (item[0] !== key) result.push(item);
      else if (!found) {
        result.push([key, val]);
        found = true;
      }
    }
    if (!found) result.push([key, val]);
    this.list = result;
  }

  sort(): void {
    this.list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  *entries(): Generator<SearchParamEntry, void, unknown> {
    for (let i = 0; i < this.list.length; ++i) {
      const entry = this.list[i];
      if (entry !== undefined) yield [entry[0], entry[1]];
    }
  }

  *keys(): Generator<string, void, unknown> {
    for (const entry of this.entries()) yield entry[0];
  }

  *values(): Generator<string, void, unknown> {
    for (const entry of this.entries()) yield entry[1];
  }

  forEach(
    callback: (this: unknown, value: string, name: string, parent: URLSearchParams) => void,
    thisArg?: unknown,
  ): void {
    for (const [name, value] of this.entries()) callback.call(thisArg, value, name, this);
  }

  toString(): string {
    return this.list.map((entry) => formEncode(entry[0]) + "=" + formEncode(entry[1])).join("&");
  }

  [Symbol.iterator](): Generator<SearchParamEntry, void, unknown> {
    return this.entries();
  }
}
