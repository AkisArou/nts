import { trimHTTPWhitespace } from "../core/ascii.ts";
import { coerceToByteString } from "../core/webidl.ts";
import { idlIterator, idlIteratorPrototype } from "../core/idl-iterator.ts";

/** Transport entries retain wire order and duplicates. Public iteration is sorted. */
export type HeaderEntry = readonly [name: string, value: string];

export type HeaderSequenceEntry = Iterable<string> & object;

export type HeaderSequence = Iterable<HeaderSequenceEntry>;

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
  const converted = coerceToByteString(name);
  if (!isToken(converted)) {
    throw new TypeError("Invalid HTTP header name");
  }
  return converted.toLowerCase();
}

export function normalizeValue(value: string): string {
  // Fetch trims HTTP whitespace (HTAB, LF, CR, SP) before validating embedded
  // newline bytes. String.trim() is wrong: it would also strip NBSP and FF.
  const normalized = trimHTTPWhitespace(coerceToByteString(value));

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

function convertHeaderSequenceEntry(entry: HeaderSequenceEntry): HeaderEntry {
  if ((typeof entry !== "object" || entry === null) && typeof entry !== "function") {
    throw new TypeError("Each header must be an iterable [name, value] tuple");
  }

  let name = "";
  let value = "";
  let length = 0;
  for (const item of entry) {
    if (length === 0) name = coerceToByteString(item);
    else if (length === 1) value = coerceToByteString(item);
    else throw new TypeError("Each header must be an iterable [name, value] tuple");
    length++;
  }
  if (length !== 2) {
    throw new TypeError("Each header must be an iterable [name, value] tuple");
  }
  return [name, value];
}

/**
 * Keys for the members other modules in this runtime need and Web IDL does not define.
 *
 * Symbols rather than names, so they do not appear on the interface prototype: Web IDL says
 * a prototype carries the interface's members and nothing else, and `getOwnPropertyNames`
 * does not report symbol keys. Deliberately **not** re-exported from the public barrel --
 * reachable from this runtime, invisible to a consumer.
 */
export const headersRawEntries: unique symbol = Symbol("Headers raw entries");
export const headersGuardIsImmutable: unique symbol = Symbol("Headers guard is immutable");
export const headersMakeImmutable: unique symbol = Symbol("Headers make immutable");

/** Shared by every iterator `Headers` hands out; see `idl-iterator.ts`. */
const HEADERS_ITERATOR_PROTOTYPE = idlIteratorPrototype("Headers Iterator");

export class Headers {
  private readonly list: HeaderEntry[] = [];
  private guard: HeaderGuard = "none";
  private sortedCache: HeaderEntry[] | null = null;

  constructor(init?: HeadersInit) {
    if (init === undefined) {
      return;
    }
    if (isHeaderSequence(init)) {
      for (const entry of init) {
        const [name, value] = convertHeaderSequenceEntry(entry);
        this.append(name, value);
      }
      return;
    }

    for (const [name, value] of Object.entries(init)) {
      this.append(name, value);
    }
  }

  #writable(): void {
    if (this.guard === "immutable") {
      throw new TypeError("Headers are immutable");
    }
  }

  append(name: string, value: string): void {
    const key = normalizeName(name);
    const normalized = normalizeValue(value);
    this.#writable();
    this.sortedCache = null;
    this.list.push([key, normalized]);
  }

  set(name: string, value: string): void {
    const key = normalizeName(name);
    const normalized = normalizeValue(value);
    this.#writable();
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
    this.#writable();
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
  [headersRawEntries](): HeaderEntry[] {
    const result: HeaderEntry[] = [];

    for (const entry of this.list) {
      result.push([entry[0], entry[1]]);
    }
    return result;
  }

  get [headersGuardIsImmutable](): boolean {
    return this.guard === "immutable";
  }

  [headersMakeImmutable](): this {
    this.guard = "immutable";
    return this;
  }

  #sorted(): HeaderEntry[] {
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

  // The three public iterators return WebIDL iterator objects rather than the generators
  // themselves: an interface's iterators must share one prototype whose own prototype is
  // %IteratorPrototype%, and a generator's chain is a level deeper. See `idl-iterator.ts`. The
  // traversals below are unchanged, so order and liveness are too.
  entries(): IterableIterator<HeaderEntry> {
    return idlIterator(HEADERS_ITERATOR_PROTOTYPE, this.#entrySteps());
  }

  keys(): IterableIterator<string> {
    return idlIterator(HEADERS_ITERATOR_PROTOTYPE, this.#keySteps());
  }

  values(): IterableIterator<string> {
    return idlIterator(HEADERS_ITERATOR_PROTOTYPE, this.#valueSteps());
  }

  *#entrySteps(): Generator<HeaderEntry, void, unknown> {
    // Mutations invalidate the cache; ordinary traversal does not sort repeatedly.
    let index = 0;
    while (true) {
      const entry = this.#sorted()[index++];
      if (entry === undefined) {
        return;
      }
      yield [entry[0], entry[1]];
    }
  }

  *#keySteps(): Generator<string, void, unknown> {
    for (const entry of this.#entrySteps()) {
      yield entry[0];
    }
  }

  *#valueSteps(): Generator<string, void, unknown> {
    for (const entry of this.#entrySteps()) {
      yield entry[1];
    }
  }

  forEach(
    callback: (this: unknown, value: string, name: string, parent: Headers) => void,
    thisArg?: unknown,
  ): void {
    for (const entry of this.#entrySteps()) {
      callback.call(thisArg, entry[1], entry[0], this);
    }
  }

  [Symbol.iterator](): IterableIterator<HeaderEntry> {
    return this.entries();
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    // Web IDL gives operations `{ writable: true, enumerable: true, configurable: true }`
    // and attribute accessors `{ enumerable: true, configurable: true }`. Safe here now that
    // this prototype carries no non-standard names: the internals other modules need are
    // symbol-keyed, and `getOwnPropertyNames` does not report symbols, so this loop cannot
    // reach them.
    for (const key of Object.getOwnPropertyNames(this.prototype)) {
      if (key === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(this.prototype, key);
      if (descriptor === undefined || descriptor.enumerable) continue;
      descriptor.enumerable = true;
      Object.defineProperty(this.prototype, key, descriptor);
    }
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "Headers",
      writable: false,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(this, "length", {
      value: 0,
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}
