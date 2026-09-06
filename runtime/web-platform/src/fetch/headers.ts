import { trimHTTPWhitespace } from "../core/ascii.ts";

/** Transport entries retain wire order and duplicates. Public iteration is sorted. */
export type HeaderEntry = readonly [name: string, value: string];

export type HeaderSequence = Iterable<HeaderEntry>;

export type HeaderRecord = Readonly<Record<string, string>>;

export type HeadersInit = Headers | HeaderSequence | HeaderRecord;

export type HeaderGuard = "none" | "immutable";

interface HeaderGroup {
  readonly name: string;
  readonly values: string[];
}

function compareHeaderGroups(left: HeaderGroup, right: HeaderGroup): number {
  if (left.name < right.name) {
    return -1;
  }
  return left.name > right.name ? 1 : 0;
}

export function isToken(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  for (let i = 0; i < value.length; ++i) {
    const c = value.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
      continue;
    }
    if (!"!#$%&'*+-.^_`|~".includes(value.charAt(i))) {
      return false;
    }
  }
  return true;
}

export function normalizeName(name: string): string {
  if (!isToken(name)) {
    throw new TypeError("Invalid HTTP header name");
  }
  return name.toLowerCase();
}

export function normalizeValue(value: string): string {
  // Fetch trims HTTP whitespace (HTAB, LF, CR, SP) before validating embedded
  // newline bytes. String.trim() is wrong: it would also strip NBSP and FF.
  const normalized = trimHTTPWhitespace(value);

  for (let i = 0; i < normalized.length; ++i) {
    const c = normalized.charCodeAt(i);
    if (c > 255 || c === 0 || c === 10 || c === 13) {
      throw new TypeError("Invalid HTTP header value");
    }
  }
  return normalized;
}

function isHeaderSequence(init: HeadersInit): init is Headers | HeaderSequence {
  return Symbol.iterator in init;
}

export class Headers {
  private readonly list: HeaderEntry[] = [];
  private guard: HeaderGuard = "none";
  private sortedCache: HeaderEntry[] | null = null;

  constructor(init?: HeadersInit) {
    if (init === undefined) {
      return;
    }
    if (isHeaderSequence(init)) {
      for (const [name, value] of init) {
        this.append(name, value);
      }
      return;
    }

    for (const [name, value] of Object.entries(init)) {
      this.append(name, value);
    }
  }

  private writable(): void {
    if (this.guard === "immutable") {
      throw new TypeError("Headers are immutable");
    }
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
    let write = 0;
    for (const entry of this.list) {
      if (entry[0] !== key) {
        this.list[write++] = entry;
      } else if (!found) {
        this.list[write++] = [key, normalized];
        found = true;
      }
    }
    if (!found) {
      this.list[write++] = [key, normalized];
    }
    this.list.length = write;
  }

  delete(name: string): void {
    const key = normalizeName(name);
    this.writable();
    this.sortedCache = null;
    let write = 0;
    for (const entry of this.list) {
      if (entry[0] !== key) {
        this.list[write++] = entry;
      }
    }
    this.list.length = write;
  }

  get(name: string): string | null {
    const key = normalizeName(name);
    let first: string | null = null;
    let values: string[] | null = null;

    for (const entry of this.list) {
      if (entry[0] !== key) {
        continue;
      }
      if (first === null) first = entry[1];
      else {
        if (values === null) values = [first];
        values.push(entry[1]);
      }
    }
    return values === null ? first : values.join(", ");
  }

  has(name: string): boolean {
    const key = normalizeName(name);
    for (const entry of this.list) {
      if (entry[0] === key) {
        return true;
      }
    }
    return false;
  }

  getSetCookie(): string[] {
    const values: string[] = [];

    for (const entry of this.list) {
      if (entry[0] === "set-cookie") {
        values.push(entry[1]);
      }
    }
    return values;
  }

  /** @internal Returns independent tuples; callers cannot mutate the header list. */
  raw(): HeaderEntry[] {
    const result: HeaderEntry[] = [];

    for (const entry of this.list) {
      result.push([entry[0], entry[1]]);
    }
    return result;
  }

  /** @internal */ get isImmutable(): boolean {
    return this.guard === "immutable";
  }

  /** @internal */ makeImmutable(): this {
    this.guard = "immutable";
    return this;
  }

  private sorted(): HeaderEntry[] {
    if (this.sortedCache !== null) {
      return this.sortedCache;
    }
    const grouped = new Map<string, HeaderGroup>();

    for (const entry of this.list) {
      let group = grouped.get(entry[0]);

      if (group === undefined) {
        group = { name: entry[0], values: [] };
        grouped.set(entry[0], group);
      }
      group.values.push(entry[1]);
    }

    const groups = Array.from(grouped.values()).sort(compareHeaderGroups);
    const result: HeaderEntry[] = [];

    for (const group of groups) {
      if (group.name === "set-cookie") {
        for (const value of group.values) {
          result.push([group.name, value]);
        }
      } else {
        result.push([group.name, group.values.join(", ")]);
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
      if (entry === undefined) {
        return;
      }
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
    callback: (this: unknown, value: string, name: string, parent: Headers) => void,
    thisArg?: unknown,
  ): void {
    for (const entry of this.entries()) {
      callback.call(thisArg, entry[1], entry[0], this);
    }
  }

  [Symbol.iterator](): Generator<HeaderEntry, void, unknown> {
    return this.entries();
  }
}
