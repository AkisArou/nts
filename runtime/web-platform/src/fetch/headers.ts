/** Transport entries retain wire order and duplicates. Public iteration is sorted. */
export type HeaderEntry = readonly [name: string, value: string];

export type HeadersInit = Headers | readonly HeaderEntry[];

export type HeaderGuard = "none" | "immutable";

export function isToken(value: string): boolean {

  if (value.length === 0) return false;

  for (let i = 0; i < value.length; ++i) {
    const c = value.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) continue;
    if (!"!#$%&'*+-.^_`|~".includes(value.charAt(i))) return false;
  }
  return true;
}

export function normalizeName(name: string): string {

  if (!isToken(name)) throw new TypeError("Invalid HTTP header name");
  return name.toLowerCase();
}

export function normalizeValue(value: string): string {
  // Fetch trims HTTP whitespace (HTAB, LF, CR, SP) before validating embedded
  // newline bytes. String.trim() is wrong: it would also strip NBSP and FF.
  let start = 0;
  let end = value.length;

  while (start < end && isHTTPWhitespace(value.charCodeAt(start))) start++;

  while (end > start && isHTTPWhitespace(value.charCodeAt(end - 1))) end--;

  for (let i = start; i < end; ++i) {
    const c = value.charCodeAt(i);
    if (c > 255 || c === 0 || c === 10 || c === 13)
      throw new TypeError("Invalid HTTP header value");
  }
  return value.slice(start, end);
}

function isHTTPWhitespace(code: number): boolean {
  return code === 9 || code === 10 || code === 13 || code === 32;
}

export class Headers {
  private list: HeaderEntry[] = [];
  private guard: HeaderGuard = "none";
  private sortedCache: HeaderEntry[] | null = null;

  constructor(init: HeadersInit = []) {
    const entries = init instanceof Headers ? init.raw() : init;
    for (const entry of entries) this.append(entry[0], entry[1]);
  }
  private writable(): void {
    if (this.guard === "immutable") throw new TypeError("Headers are immutable");
  }

  append(name: string, value: string): void {
    const key = normalizeName(name);
    const normalized = normalizeValue(value);
    this.writable();
    this.sortedCache = null;
    this.list.push([key, normalized]);
  }

  set(name: string, value: string): void {
    const key = normalizeName(name);
    const normalized = normalizeValue(value);
    this.writable();
    this.sortedCache = null;
    let found = false;
    const next: HeaderEntry[] = [];
    for (const entry of this.list) {
      if (entry[0] !== key) next.push(entry);
      else if (!found) {
        next.push([key, normalized]);
        found = true;
      }
    }
    if (!found) next.push([key, normalized]);
    this.list = next;
  }

  delete(name: string): void {
    const key = normalizeName(name);
    this.writable();
    this.sortedCache = null;
    this.list = this.list.filter((entry) => entry[0] !== key);
  }

  get(name: string): string | null {
    const key = normalizeName(name);
    const values = this.list.filter((entry) => entry[0] === key).map((entry) => entry[1]);
    return values.length === 0 ? null : values.join(", ");
  }

  has(name: string): boolean {
    const key = normalizeName(name);
    return this.list.some((entry) => entry[0] === key);
  }

  getSetCookie(): string[] {
    return this.list.filter((entry) => entry[0] === "set-cookie").map((entry) => entry[1]);
  }
  /** @internal Returns independent tuples; callers cannot mutate the header list. */
  raw(): HeaderEntry[] {
    return this.list.map((entry) => [entry[0], entry[1]]);
  }
  /** @internal */ get isImmutable(): boolean {
    return this.guard === "immutable";
  }
  /** @internal */ makeImmutable(): this {
    this.guard = "immutable";
    return this;
  }
  private sorted(): HeaderEntry[] {
    if (this.sortedCache !== null) return this.sortedCache;
    const names = Array.from(new Set(this.list.map((entry) => entry[0]))).sort();
    const result: HeaderEntry[] = [];
    for (const name of names) {
      if (name === "set-cookie") {
        for (const value of this.getSetCookie()) result.push([name, value]);
      } else {
        const value = this.get(name);
        if (value !== null) result.push([name, value]);
      }
    }
    this.sortedCache = result;
    return result;
  }

  *entries(): Generator<HeaderEntry, void, unknown> {
    // Mutations invalidate the cache; ordinary traversal does not sort repeatedly.
    let index = 0;
    while (true) {
      const entry = this.sorted()[index++];
      if (entry === undefined) return;
      yield [entry[0], entry[1]];
    }
  }

  *keys(): Generator<string, void, unknown> {
    for (const entry of this.entries()) yield entry[0];
  }

  *values(): Generator<string, void, unknown> {
    for (const entry of this.entries()) yield entry[1];
  }

  forEach(callback: (value: string, name: string, parent: Headers) => void): void {
    for (const entry of this.entries()) callback(entry[1], entry[0], this);
  }

  [Symbol.iterator](): Generator<HeaderEntry, void, unknown> {
    return this.entries();
  }
}
