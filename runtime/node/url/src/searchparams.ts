// `URLSearchParams`, from https://url.spec.whatwg.org/#interface-urlsearchparams.
//
// A list of name/value pairs, kept in insertion order, serialised as
// `application/x-www-form-urlencoded`. It is a list rather than a map because
// a query may repeat a name -- `?a=1&a=2` is two entries, and collapsing them
// would lose the second.
//
// The part that is easy to get wrong is the link back to the `URL` that owns
// it. `url.searchParams.set('a', '1')` has to change `url.href`, and
// `url.search = 'b=2'` has to change what the params contain. That is one
// object with two views of it, and both directions have to work.

import {
  ERR_INVALID_THIS, ERR_INVALID_TUPLE, ERR_MISSING_ARGS,
} from "../../internal/errors.ts";
import { inUrlencodedPercentEncodeSet, percentDecodeString } from "./parser.ts";
import { customInspectSymbol, inspect, type InspectOptions } from "../../util/src/inspect.ts";

/** The owner to tell when the list changes, if there is one. */
export interface SearchParamsOwner {
  /** Called after a mutation, with the serialised query or `null` if empty. */
  onSearchParamsChanged(serialized: string | null): void;
  /** The query to read at construction and after the owner's own writes. */
  currentQuery(): string | null;
}

/**
 * `application/x-www-form-urlencoded` parsing.
 *
 * Not the same as URL query parsing: `+` means a space here and nowhere else,
 * which is a legacy of HTML form submission and the reason this cannot simply
 * reuse the percent-decoder.
 */
export function parseUrlencoded(input: string): Array<[string, string]> {
  const output: Array<[string, string]> = [];
  if (input === "") return output;
  for (const sequence of input.split("&")) {
    if (sequence === "") continue;
    let name: string;
    let value: string;
    const at = sequence.indexOf("=");
    if (at === -1) {
      name = sequence;
      value = "";
    } else {
      name = sequence.slice(0, at);
      value = sequence.slice(at + 1);
    }
    output.push([
      percentDecodeString(name.replaceAll("+", " ")),
      percentDecodeString(value.replaceAll("+", " ")),
    ]);
  }
  return output;
}

function serializeUrlencodedByte(str: string): string {
  let out = "";
  for (const ch of str) {
    const c = ch.codePointAt(0)!;
    if (c === 0x20) {
      // A space is `+` here, again for HTML forms.
      out += "+";
    } else if (!inUrlencodedPercentEncodeSet(c)) {
      out += ch;
    } else {
      for (const byte of utf8(ch)) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
    }
  }
  return out;
}

/**
 * UTF-8 bytes, with a lone surrogate replaced.
 *
 * These values are USVStrings: a surrogate that is not part of a pair does not
 * name a character, and the standard says to substitute U+FFFD rather than
 * encode it. Encoding it produces bytes no decoder will accept.
 */
function utf8(str: string): number[] {
  const out: number[] = [];
  for (const ch of str) {
    let c = ch.codePointAt(0)!;
    if (c >= 0xd800 && c <= 0xdfff) {
      c = 0xfffd;
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

export function serializeUrlencoded(list: ReadonlyArray<readonly [string, string]>): string {
  return list
    .map(([name, value]) => `${serializeUrlencodedByte(name)}=${serializeUrlencodedByte(value)}`)
    .join("&");
}

export type SearchParamsInit =
  | string
  | URLSearchParams
  | ReadonlyArray<readonly [string, string]>
  | Record<string, string>
  | Iterable<readonly [string, string]>;

export class URLSearchParams {
  #list: Array<[string, string]> = [];
  #owner: SearchParamsOwner | null = null;

  constructor(init?: SearchParamsInit) {
    if (init === undefined) {
      return;
    }
    if (typeof init === "string") {
      // A leading `?` is dropped, so that `new URLSearchParams(url.search)`
      // does what it obviously means.
      this.#list = parseUrlencoded(init.startsWith("?") ? init.slice(1) : init);
      return;
    }
    if (init instanceof URLSearchParams) {
      this.#list = init.#list.map((pair) => [pair[0], pair[1]] as [string, string]);
      return;
    }
    // A function counts as an object here: an iterable may be one, and node's
    // tests construct exactly that.
    if ((typeof init !== "object" && typeof init !== "function") || init === null) {
      // Per WebIDL union resolution the argument is coerced to a string, so
      // `new URLSearchParams(null)` is the query `null=` rather than empty.
      this.#list = parseUrlencoded(`${init}`);
      return;
    }
    const iterator = (init as Iterable<readonly [string, string]>)[Symbol.iterator];
    if (typeof iterator === "function") {
      for (const pair of init as Iterable<readonly [string, string]>) {
        const asList = [...(pair as Iterable<string>)];
        if (asList.length !== 2) {
          throw new ERR_INVALID_TUPLE("query pair", "an iterable [name, value] tuple");
        }
        this.#list.push([`${asList[0]}`, `${asList[1]}`]);
      }
      return;
    }
    for (const key of Reflect.ownKeys(init as object)) {
      if (typeof key !== "string") continue;
      const descriptor = Object.getOwnPropertyDescriptor(init as object, key);
      if (descriptor?.enumerable) {
        this.#list.push([key, `${(init as Record<string, string>)[key]}`]);
      }
    }
  }

  /**
   * Attach to a `URL`.
   *
   * Called by `URL` rather than by a caller, and not part of the interface:
   * the two objects have to agree, and the agreement is theirs.
   */
  bindToOwner(owner: SearchParamsOwner): void {
    this.#owner = owner;
    this.#readFromOwner();
  }

  #readFromOwner(): void {
    const query = this.#owner!.currentQuery();
    this.#list = query === null ? [] : parseUrlencoded(query);
  }

  #update(): void {
    if (this.#owner === null) return;
    const serialized = this.#list.length === 0 ? null : serializeUrlencoded(this.#list);
    this.#owner.onSearchParamsChanged(serialized);
  }

  /** Called by the owner when its query changed underneath us. */
  refreshFromOwner(): void {
    if (this.#owner !== null) this.#readFromOwner();
  }

  /**
   * A brand check, and it has to come before the argument check.
   *
   * These methods are routinely detached -- `[...params].map(params.get)` --
   * and reading a private field off the wrong receiver throws a plain
   * `TypeError` with no code. Node reports which receiver was expected, and
   * its tests check that it does so even when the arguments are also wrong.
   */
  static #brandCheck(value: unknown): asserts value is URLSearchParams {
    if (value === null || typeof value !== "object" || !(#list in value)) {
      throw new ERR_INVALID_THIS("URLSearchParams");
    }
  }

  get size(): number {
    URLSearchParams.#brandCheck(this);
    return this.#list.length;
  }

  append(name: string, value: string): void {
    URLSearchParams.#brandCheck(this);
    if (arguments.length < 2) {
      throw new ERR_MISSING_ARGS("name", "value");
    }
    this.#list.push([`${name}`, `${value}`]);
    this.#update();
  }

  /**
   * Remove every pair with this name, or -- when a value is given -- only the
   * pairs that also have that value.
   */
  delete(name: string, value?: string): void {
    URLSearchParams.#brandCheck(this);
    if (arguments.length < 1) {
      throw new ERR_MISSING_ARGS("name");
    }
    const wanted = `${name}`;
    if (value !== undefined) {
      const wantedValue = `${value}`;
      this.#list = this.#list.filter((p) => !(p[0] === wanted && p[1] === wantedValue));
    } else {
      this.#list = this.#list.filter((p) => p[0] !== wanted);
    }
    this.#update();
  }

  get(name: string): string | null {
    URLSearchParams.#brandCheck(this);
    if (arguments.length < 1) {
      throw new ERR_MISSING_ARGS("name");
    }
    const wanted = `${name}`;
    for (const pair of this.#list) {
      if (pair[0] === wanted) return pair[1];
    }
    return null;
  }

  getAll(name: string): string[] {
    URLSearchParams.#brandCheck(this);
    if (arguments.length < 1) {
      throw new ERR_MISSING_ARGS("name");
    }
    const wanted = `${name}`;
    return this.#list.filter((p) => p[0] === wanted).map((p) => p[1]);
  }

  has(name: string, value?: string): boolean {
    URLSearchParams.#brandCheck(this);
    if (arguments.length < 1) {
      throw new ERR_MISSING_ARGS("name");
    }
    const wanted = `${name}`;
    if (value !== undefined) {
      const wantedValue = `${value}`;
      return this.#list.some((p) => p[0] === wanted && p[1] === wantedValue);
    }
    return this.#list.some((p) => p[0] === wanted);
  }

  /**
   * Replace the first pair with this name and drop the rest.
   *
   * In place rather than remove-then-append, so that the position in the query
   * is kept: a caller changing one parameter does not expect the others to
   * move.
   */
  set(name: string, value: string): void {
    URLSearchParams.#brandCheck(this);
    if (arguments.length < 2) {
      throw new ERR_MISSING_ARGS("name", "value");
    }
    const wanted = `${name}`;
    const wantedValue = `${value}`;
    let found = false;
    const next: Array<[string, string]> = [];
    for (const pair of this.#list) {
      if (pair[0] !== wanted) {
        next.push(pair);
        continue;
      }
      if (!found) {
        found = true;
        next.push([wanted, wantedValue]);
      }
    }
    if (!found) {
      next.push([wanted, wantedValue]);
    }
    this.#list = next;
    this.#update();
  }

  /**
   * Sort by name, keeping the relative order of equal names.
   *
   * Stable on purpose, and by code unit rather than by locale: two programs
   * sorting the same query must produce the same string, which a
   * locale-sensitive comparison does not promise.
   */
  sort(): void {
    URLSearchParams.#brandCheck(this);
    this.#list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    this.#update();
  }

  forEach<T>(
    callback: (this: T, value: string, name: string, searchParams: URLSearchParams) => void,
    thisArg?: T,
  ): void {
    URLSearchParams.#brandCheck(this);
    // Indexed rather than iterated, because a callback may append: the
    // specification says those entries are visited too.
    for (let i = 0; i < this.#list.length; i++) {
      const pair = this.#list[i]!;
      callback.call(thisArg as T, pair[1], pair[0], this);
    }
  }

  entries(): URLSearchParamsIterator<[string, string]> {
    URLSearchParams.#brandCheck(this);
    return new URLSearchParamsIterator(this.#list, "key+value");
  }

  keys(): URLSearchParamsIterator<string> {
    URLSearchParams.#brandCheck(this);
    return new URLSearchParamsIterator(this.#list, "key");
  }

  values(): URLSearchParamsIterator<string> {
    URLSearchParams.#brandCheck(this);
    return new URLSearchParamsIterator(this.#list, "value");
  }

  toString(): string {
    URLSearchParams.#brandCheck(this);
    return serializeUrlencoded(this.#list);
  }

  /** The pairs, for the `URL` that owns them. */
  pairs(): ReadonlyArray<readonly [string, string]> {
    return this.#list;
  }

  /**
   * Printed as the pairs, in the `Map` notation, because that is what it is.
   * A default inspection would show a private field and say nothing.
   */
  [customInspectSymbol](depth: number, options: InspectOptions): string {
    if (this === null || typeof this !== "object" || !(#list in this)) {
      throw new ERR_INVALID_THIS("URLSearchParams");
    }
    if (depth < 0) {
      return "[Object]";
    }
    const inner = this.#list
      .map(([name, value]) => `${inspect(name, options)} => ${inspect(value, options)}`)
      .join(", ");
    return inner === "" ? "URLSearchParams {}" : `URLSearchParams { ${inner} }`;
  }
}

/**
 * The object `entries`, `keys` and `values` return.
 *
 * A class rather than a generator, for two reasons node's tests check. Its
 * tag is `URLSearchParams Iterator` where a generator's would be `Generator`;
 * and a detached `next` reports which receiver it wanted, where a generator
 * reports its own internals -- a message that tells the reader nothing about
 * the code they wrote.
 *
 * It reads the live list, so a pair appended during iteration is visited.
 */
export class URLSearchParamsIterator<T> {
  #list: ReadonlyArray<readonly [string, string]>;
  #kind: "key" | "value" | "key+value";
  #index = 0;

  constructor(list: ReadonlyArray<readonly [string, string]>, kind: "key" | "value" | "key+value") {
    this.#list = list;
    this.#kind = kind;
  }

  next(): IteratorResult<T> {
    if (this === null || typeof this !== "object" || !(#list in this)) {
      throw new ERR_INVALID_THIS("URLSearchParamsIterator");
    }
    if (this.#index >= this.#list.length) {
      return { value: undefined, done: true };
    }
    const pair = this.#list[this.#index]!;
    this.#index++;
    const value = this.#kind === "key" ? pair[0]
      : this.#kind === "value" ? pair[1]
      : [pair[0], pair[1]];
    return { value: value as T, done: false };
  }

  [Symbol.iterator](): URLSearchParamsIterator<T> {
    return this;
  }
}

Object.defineProperty(URLSearchParamsIterator.prototype, Symbol.toStringTag, {
  __proto__: null,
  value: "URLSearchParams Iterator",
  writable: false,
  enumerable: false,
  configurable: true,
} as PropertyDescriptor);

// The same function object, not a wrapper: the interface says
// `URLSearchParams.prototype[Symbol.iterator] === URLSearchParams.prototype.entries`,
// and code that compares them is checking it has the real one.
Object.defineProperty(URLSearchParams.prototype, Symbol.iterator, {
  __proto__: null,
  value: URLSearchParams.prototype.entries,
  writable: true,
  enumerable: false,
  configurable: true,
} as PropertyDescriptor);

Object.defineProperty(URLSearchParams.prototype, Symbol.toStringTag, {
  __proto__: null,
  value: "URLSearchParams",
  writable: false,
  enumerable: false,
  configurable: true,
} as PropertyDescriptor);
