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
  ERR_ARG_NOT_ITERABLE, ERR_INVALID_THIS, ERR_INVALID_TUPLE, ERR_MISSING_ARGS,
} from "../../internal/errors.ts";
import { validateFunction } from "../../internal/validators.ts";
import { inUrlencodedPercentEncodeSet, percentEncodeScalar } from "./parser.ts";
import { unescape } from "../../querystring/src/main.ts";
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
  if (input === "") return [];
  const sequences = input.split("&");
  let pairCount = 0;
  for (let index = 0; index < sequences.length; index++) {
    if (sequences[index] !== "") pairCount++;
  }

  const output = new Array<[string, string]>(pairCount);
  let outputIndex = 0;
  for (let index = 0; index < sequences.length; index++) {
    const sequence = sequences[index];
    if (sequence === undefined || sequence === "") continue;
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
    output[outputIndex++] = [
      decodeFormComponent(name),
      decodeFormComponent(value),
    ];
  }
  return output;
}

/**
 * Node only invokes its byte decoder after its fast scanner recognizes an
 * encoded component. This is deliberately the pinned scanner, including its
 * carry across `+`: `%b+0` reaches the encoded path even though the two hex
 * digits are not adjacent. That detail changes malformed-input output because
 * querystring's fallback decoder is byte-oriented.
 */
function decodeFormComponent(input: string): string {
  const text = input.replaceAll("+", " ");
  let encodeCheck = 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 0x2b) continue;
    if (code === 0x25) {
      encodeCheck = 1;
    } else if (encodeCheck > 0) {
      if (isAsciiHexCode(code)) {
        encodeCheck++;
        if (encodeCheck === 3) return unescape(text);
      } else {
        encodeCheck = 0;
      }
    }
  }
  return text;
}

function isAsciiHexCode(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66);
}

function serializeFormComponent(str: string): string {
  let out = "";
  for (const ch of str) {
    let c = ch.codePointAt(0) ?? 0;
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c === 0x20) {
      // A space is `+` here, again for HTML forms.
      out += "+";
    } else if (!inUrlencodedPercentEncodeSet(c)) {
      out += ch;
    } else {
      out += percentEncodeScalar(c);
    }
  }
  return out;
}

export function serializeUrlencoded(list: ReadonlyArray<readonly [string, string]>): string {
  let out = "";
  let first = true;
  for (let index = 0; index < list.length; index++) {
    const pair = list[index];
    if (pair === undefined) continue;
    if (!first) out += "&";
    first = false;
    out += `${serializeFormComponent(pair[0])}=${serializeFormComponent(pair[1])}`;
  }
  return out;
}

export type SearchParamsInit =
  | string
  | URLSearchParams
  | ReadonlyArray<readonly [string, string]>
  | Record<string, string>
  | Iterable<readonly [string, string]>;

/** Web IDL's `USVString`: stringify, then replace every lone surrogate. */
function toUSVString(value: unknown): string {
  return `${value}`.toWellFormed();
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    Symbol.iterator in value &&
    typeof value[Symbol.iterator] === "function";
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isPropertyRecord(value: unknown): value is Record<string, unknown> {
  return value !== null &&
    (typeof value === "object" || typeof value === "function");
}

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
      const text = init.toWellFormed();
      this.#list = parseUrlencoded(text.startsWith("?") ? text.slice(1) : text);
      return;
    }
    if (init instanceof URLSearchParams) {
      const source = init.#list;
      const copy = new Array<[string, string]>(source.length);
      for (let index = 0; index < source.length; index++) {
        const pair = source[index];
        if (pair !== undefined) copy[index] = [pair[0], pair[1]];
      }
      this.#list = copy;
      return;
    }
    // A function counts as an object here: an iterable may be one, and node's
    // tests construct exactly that.
    if ((typeof init !== "object" && typeof init !== "function") || init === null) {
      // Per WebIDL union resolution the argument is coerced to a string, so
      // `new URLSearchParams(null)` is the query `null=` rather than empty.
      this.#list = parseUrlencoded(toUSVString(init));
      return;
    }
    if (Symbol.iterator in init) {
      if (!isIterable(init)) {
        throw new ERR_ARG_NOT_ITERABLE("Query pairs");
      }
      for (const pair of init) {
        if (isUnknownArray(pair)) {
          if (pair.length !== 2) {
            throw new ERR_INVALID_TUPLE("query pair", "an iterable [name, value] tuple");
          }
          this.#list.push([toUSVString(pair[0]), toUSVString(pair[1])]);
          continue;
        }
        if (!isIterable(pair)) {
          throw new ERR_INVALID_TUPLE("query pair", "an iterable [name, value] tuple");
        }
        let length = 0;
        let name = "";
        let value = "";
        for (const element of pair) {
          const converted = toUSVString(element);
          if (length === 0) name = converted;
          if (length === 1) value = converted;
          length++;
        }
        if (length !== 2) {
          throw new ERR_INVALID_TUPLE("query pair", "an iterable [name, value] tuple");
        }
        this.#list.push([name, value]);
      }
      return;
    }
    if (isPropertyRecord(init)) {
      const visited = new Map<string, number>();
      for (const key of Object.keys(init)) {
        const name = key.toWellFormed();
        const value = toUSVString(init[key]);
        const index = visited.get(name);
        if (index === undefined) {
          visited.set(name, this.#list.length);
          this.#list.push([name, value]);
        } else {
          const prior = this.#list[index];
          if (prior !== undefined) prior[1] = value;
        }
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
    const owner = this.#owner;
    if (owner === null) return;
    const query = owner.currentQuery();
    replaceListContents(
      this.#list,
      query === null ? [] : parseUrlencoded(query),
    );
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
    this.#list.push([toUSVString(name), toUSVString(value)]);
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
    const wanted = toUSVString(name);
    const list = this.#list;
    const length = list.length;
    let write = 0;
    if (value !== undefined) {
      const wantedValue = toUSVString(value);
      for (let index = 0; index < length; index++) {
        const pair = list[index];
        if (pair === undefined) continue;
        if (pair[0] === wanted && pair[1] === wantedValue) continue;
        if (write !== index) list[write] = pair;
        write++;
      }
    } else {
      for (let index = 0; index < length; index++) {
        const pair = list[index];
        if (pair === undefined) continue;
        if (pair[0] === wanted) continue;
        if (write !== index) list[write] = pair;
        write++;
      }
    }
    if (write !== length) list.length = write;
    this.#update();
  }

  get(name: string): string | null {
    URLSearchParams.#brandCheck(this);
    if (arguments.length < 1) {
      throw new ERR_MISSING_ARGS("name");
    }
    const wanted = toUSVString(name);
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
    const wanted = toUSVString(name);
    let count = 0;
    for (let index = 0; index < this.#list.length; index++) {
      const pair = this.#list[index];
      if (pair !== undefined && pair[0] === wanted) count++;
    }
    const values = new Array<string>(count);
    let output = 0;
    for (let index = 0; index < this.#list.length; index++) {
      const pair = this.#list[index];
      if (pair !== undefined && pair[0] === wanted) values[output++] = pair[1];
    }
    return values;
  }

  has(name: string, value?: string): boolean {
    URLSearchParams.#brandCheck(this);
    if (arguments.length < 1) {
      throw new ERR_MISSING_ARGS("name");
    }
    const wanted = toUSVString(name);
    if (value !== undefined) {
      const wantedValue = toUSVString(value);
      for (let index = 0; index < this.#list.length; index++) {
        const pair = this.#list[index];
        if (pair !== undefined && pair[0] === wanted && pair[1] === wantedValue) {
          return true;
        }
      }
      return false;
    }
    for (let index = 0; index < this.#list.length; index++) {
      const pair = this.#list[index];
      if (pair !== undefined && pair[0] === wanted) return true;
    }
    return false;
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
    const wanted = toUSVString(name);
    const wantedValue = toUSVString(value);
    const list = this.#list;
    const length = list.length;
    let found = false;
    let write = 0;
    for (let index = 0; index < length; index++) {
      const pair = list[index];
      if (pair === undefined) continue;
      let keep = true;
      if (pair[0] !== wanted) {
        if (write !== index) list[write] = pair;
      } else if (!found) {
        pair[1] = wantedValue;
        if (write !== index) list[write] = pair;
        found = true;
      } else {
        keep = false;
      }
      if (keep) {
        write++;
      }
    }
    if (found) {
      if (write !== length) list.length = write;
    } else {
      list.push([wanted, wantedValue]);
    }
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
    stableSort(this.#list);
    this.#update();
  }

  forEach(
    callback: (this: void, value: string, name: string, searchParams: URLSearchParams) => void,
    thisArg?: undefined,
  ): void;
  forEach<T>(
    callback: (this: T, value: string, name: string, searchParams: URLSearchParams) => void,
    thisArg: T,
  ): void;
  forEach(
    callback: (this: unknown, value: string, name: string, searchParams: URLSearchParams) => void,
    thisArg?: unknown,
  ): void {
    URLSearchParams.#brandCheck(this);
    validateFunction(callback, "callback");
    // Indexed rather than iterated, because a callback may append: the
    // specification says those entries are visited too.
    for (let i = 0; i < this.#list.length; i++) {
      const pair = this.#list[i];
      if (pair === undefined) continue;
      callback.call(thisArg, pair[1], pair[0], this);
    }
  }

  entries(): URLSearchParamsIterator<[string, string]> {
    URLSearchParams.#brandCheck(this);
    return createIterator(this.#list, "entry");
  }

  keys(): URLSearchParamsIterator<string> {
    URLSearchParams.#brandCheck(this);
    return createIterator(this.#list, "key");
  }

  values(): URLSearchParamsIterator<string> {
    URLSearchParams.#brandCheck(this);
    return createIterator(this.#list, "value");
  }

  [Symbol.iterator](): URLSearchParamsIterator<[string, string]> {
    return this.entries();
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
    const entries = new Array<string>(this.#list.length);
    for (let i = 0; i < this.#list.length; i++) {
      const pair = this.#list[i];
      entries[i] = pair === undefined
        ? ""
        : `${inspect(pair[0], options)} => ${inspect(pair[1], options)}`;
    }
    if (entries.length === 0) return "URLSearchParams {}";
    const inline = entries.join(", ");
    if (inline.length > (options.breakLength ?? 80)) {
      return `URLSearchParams {\n  ${entries.join(",\n  ")} }`;
    }
    return `URLSearchParams { ${inline} }`;
  }
}

function replaceListContents(
  target: Array<[string, string]>,
  source: Array<[string, string]>,
): void {
  target.length = source.length;
  for (let index = 0; index < source.length; index++) {
    const pair = source[index];
    if (pair !== undefined) target[index] = pair;
  }
}

/** Stable code-unit ordering, following pinned Node's callback-free sort. */
function stableSort(list: Array<[string, string]>): void {
  const length = list.length;
  if (length < 2) return;

  // Node uses insertion sort below fifty pairs: setup is cheaper than a merge
  // buffer and URL query strings are normally far smaller than this.
  if (length < 50) {
    for (let index = 1; index < length; index++) {
      const current = list[index];
      if (current === undefined) continue;
      let priorIndex = index - 1;
      while (priorIndex >= 0) {
        const prior = list[priorIndex];
        if (prior === undefined || prior[0] <= current[0]) break;
        list[priorIndex + 1] = prior;
        priorIndex--;
      }
      list[priorIndex + 1] = current;
    }
    return;
  }

  let source = list;
  let target = new Array<[string, string]>(length);
  for (let width = 1; width < length; width *= 2) {
    for (let start = 0; start < length; start += width * 2) {
      const middle = Math.min(start + width, length);
      const end = Math.min(start + width * 2, length);
      let left = start;
      let right = middle;
      let output = start;
      while (left < middle && right < end) {
        const leftPair = source[left];
        const rightPair = source[right];
        if (leftPair === undefined || rightPair === undefined) break;
        // Equal names come from the left run first, which preserves insertion
        // order across every merge level.
        if (leftPair[0] <= rightPair[0]) {
          target[output++] = leftPair;
          left++;
        } else {
          target[output++] = rightPair;
          right++;
        }
      }
      while (left < middle) {
        const pair = source[left++];
        if (pair !== undefined) target[output++] = pair;
      }
      while (right < end) {
        const pair = source[right++];
        if (pair !== undefined) target[output++] = pair;
      }
    }
    const previousSource = source;
    source = target;
    target = previousSource;
  }

  if (source !== list) {
    for (let index = 0; index < length; index++) {
      const pair = source[index];
      if (pair !== undefined) list[index] = pair;
    }
  }
}

type IteratorKind = "key" | "value" | "entry";
type IteratorValue = string | [string, string];

export interface URLSearchParamsIterator<T> extends IterableIterator<T> {}

function createIterator(
  list: ReadonlyArray<readonly [string, string]>,
  kind: "entry",
): URLSearchParamsIterator<[string, string]>;
function createIterator(
  list: ReadonlyArray<readonly [string, string]>,
  kind: "key" | "value",
): URLSearchParamsIterator<string>;
function createIterator(
  list: ReadonlyArray<readonly [string, string]>,
  kind: IteratorKind,
): URLSearchParamsIterator<IteratorValue> {
  return new URLSearchParamsIteratorImpl(list, kind);
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
class URLSearchParamsIteratorImpl implements URLSearchParamsIterator<IteratorValue> {
  #list: ReadonlyArray<readonly [string, string]>;
  #kind: IteratorKind;
  #index = 0;

  constructor(list: ReadonlyArray<readonly [string, string]>, kind: IteratorKind) {
    this.#list = list;
    this.#kind = kind;
  }

  next(): IteratorResult<IteratorValue> {
    if (this === null || typeof this !== "object" || !(#list in this)) {
      throw new ERR_INVALID_THIS("URLSearchParamsIterator");
    }
    if (this.#index >= this.#list.length) {
      return { value: undefined, done: true };
    }
    const pair = this.#list[this.#index];
    if (pair === undefined) {
      return { value: undefined, done: true };
    }
    this.#index++;
    const value: IteratorValue = this.#kind === "key"
      ? pair[0]
      : this.#kind === "value"
      ? pair[1]
      : [pair[0], pair[1]];
    return { value, done: false };
  }

  [Symbol.iterator](): URLSearchParamsIterator<IteratorValue> {
    return this;
  }

  [customInspectSymbol](depth: number, options: InspectOptions): string {
    if (this === null || typeof this !== "object" || !(#list in this)) {
      throw new ERR_INVALID_THIS("URLSearchParamsIterator");
    }
    if (depth < 0) return "[Object]";

    return inspectIterator(this.#list, this.#index, this.#kind, options);
  }
}

function inspectIterator(
  list: ReadonlyArray<readonly [string, string]>,
  start: number,
  kind: IteratorKind,
  options: InspectOptions,
): string {
  const entries = new Array<string>(Math.max(0, list.length - start));
  for (let i = start; i < list.length; i++) {
    const pair = list[i];
    if (pair === undefined) continue;
    const value: string | [string, string] = kind === "key"
      ? pair[0]
      : kind === "value"
      ? pair[1]
      : [pair[0], pair[1]];
    entries[i - start] = inspect(value, options);
  }
  const inline = entries.join(", ");
  const body = inline.length > (options.breakLength ?? 80)
    ? `\n  ${entries.join(",\n  ")}`
    : ` ${inline}`;
  return `URLSearchParams Iterator {${body} }`;
}
