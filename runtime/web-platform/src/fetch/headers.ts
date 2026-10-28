import { trimHTTPWhitespace } from "../core/ascii.ts";
import { coerceToByteString, requireArguments } from "../core/webidl.ts";
import { idlIterator, idlIteratorPrototype } from "../core/idl-iterator.ts";

/** Transport entries retain wire order and duplicates. Public iteration is sorted. */
export type HeaderEntry = readonly [name: string, value: string];

export type HeaderSequenceEntry = Iterable<string> & object;

export type HeaderSequence = Iterable<HeaderSequenceEntry>;

export type HeaderRecord = Readonly<Record<string, string>>;

export type HeadersInit = Headers | HeaderSequence | HeaderRecord;

/** @internal Web IDL values, before Fetch validates tuple lengths or HTTP syntax. */
export type ConvertedHeadersInit = readonly (readonly string[])[];

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
  return normalizeConvertedName(coerceToByteString(name));
}

function normalizeConvertedName(name: string): string {
  if (!isToken(name)) {
    throw new TypeError("Invalid HTTP header name");
  }
  return name.toLowerCase();
}

function normalizeConvertedValue(value: string): string {
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

function isObject(value: unknown): value is object {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

// Abstract Call must not read an iterator function's user-controlled .call.
// https://tc39.es/ecma262/#sec-call
const callWithoutArguments: (callback: () => unknown, receiver: object) => unknown =
  Function.prototype.call.bind(Function.prototype.call);

type HeaderForEachCallback = (this: unknown, value: string, name: string, parent: Headers) => void;
const callForEachCallback: (
  callback: HeaderForEachCallback,
  receiver: unknown,
  value: string,
  name: string,
  parent: Headers,
) => void = Function.prototype.call.bind(Function.prototype.call);

function iteratorMethod(value: object): (() => unknown) | undefined {
  const method = (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator];
  if (method === undefined || method === null) return undefined;
  if (typeof method !== "function") throw new TypeError("Header iterator must be callable");
  return method as () => unknown;
}

function convertSequence<T>(
  value: object,
  method: () => unknown,
  convert: (value: unknown) => T,
): T[] {
  const iterator = callWithoutArguments(method, value);
  if (!isObject(iterator)) throw new TypeError("Header iterator must return an object");
  const next = (iterator as Iterator<unknown>).next;
  const result: T[] = [];
  // Web IDL conversion uses IteratorStepValue, without IteratorClose when an
  // element conversion throws. Cache next as GetIteratorFromMethod requires.
  // https://webidl.spec.whatwg.org/#create-sequence-from-iterable
  while (true) {
    const step = callWithoutArguments(next, iterator);
    if (!isObject(step)) throw new TypeError("Header iterator result must be an object");
    const item = step as IteratorResult<unknown>;
    if (item.done) return result;
    result.push(convert(item.value));
  }
}

function convertHeaderSequenceEntry(entry: unknown): string[] {
  if (!isObject(entry)) {
    throw new TypeError("Each header must be an iterable [name, value] tuple");
  }
  const method = iteratorMethod(entry);
  if (method === undefined) throw new TypeError("Header tuple must be iterable");
  return convertSequence(entry, method, coerceToByteString);
}

/** @internal Convert HeadersInit at the Web IDL argument or dictionary boundary. */
export function convertHeadersInit(init: HeadersInit): ConvertedHeadersInit {
  if (!isObject(init)) throw new TypeError("Headers init must be an object");
  // Union selection uses GetMethod, not the presence of Symbol.iterator.
  // https://webidl.spec.whatwg.org/#es-union
  const method = iteratorMethod(init);
  if (method !== undefined) return convertSequence(init, method, convertHeaderSequenceEntry);

  const result: HeaderEntry[] = [];
  const record = init as Readonly<Record<PropertyKey, unknown>>;
  // Snapshot all own keys, then inspect each descriptor immediately before its
  // key and value conversion. Earlier getters can delete later properties, and
  // enumerable symbol keys must fail ByteString conversion before a value read.
  // https://webidl.spec.whatwg.org/#es-to-record
  for (const key of Reflect.ownKeys(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !descriptor.enumerable) continue;
    const name = coerceToByteString(key);
    const value = coerceToByteString(record[key]);
    result.push([name, value]);
  }
  return result;
}

let fillConvertedHeaders: (init: ConvertedHeadersInit) => Headers;
let copyHeaderList: (headers: Headers) => Headers;
let readHeaderList: (headers: Headers, name: string) => string | null;

/** @internal Run Fetch's fill steps after all surrounding Web IDL conversion. */
export function createHeadersFromConvertedInit(init: ConvertedHeadersInit): Headers {
  return fillConvertedHeaders(init);
}

/** @internal Copy the list and its wire order; the new guard remains "none". */
export function copyHeaders(headers: Headers): Headers {
  return copyHeaderList(headers);
}

/** @internal Read header state without calling a script-overridden public get(). */
export function getHeaderValue(headers: Headers, name: string): string | null {
  return readHeaderList(headers, name);
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
  readonly #list: HeaderEntry[] = [];
  #guard: HeaderGuard = "none";
  #sortedCache: HeaderEntry[] | null = null;

  static {
    fillConvertedHeaders = (init) => {
      const headers = new Headers();
      headers.#fill(init);
      return headers;
    };
    copyHeaderList = (source) => {
      const headers = new Headers();
      for (const entry of source.#list) headers.#list.push([entry[0], entry[1]]);
      return headers;
    };
    readHeaderList = (headers, name) => headers.#get(normalizeName(name));
  }

  constructor(init?: HeadersInit) {
    if (init !== undefined) this.#fill(convertHeadersInit(init));
  }

  #fill(init: ConvertedHeadersInit): void {
    // Fetch's fill algorithm follows conversion of the entire HeadersInit.
    // https://fetch.spec.whatwg.org/#concept-headers-fill
    for (let i = 0; i < init.length; i++) {
      const entry = init[i];
      if (entry === undefined || entry.length !== 2) {
        throw new TypeError("Each header must be an iterable [name, value] tuple");
      }
      const name = entry[0];
      const value = entry[1];
      if (name === undefined || value === undefined) {
        throw new TypeError("Each header must be an iterable [name, value] tuple");
      }
      this.#appendConverted(name, value);
    }
  }

  #writable(): void {
    if (this.#guard === "immutable") {
      throw new TypeError("Headers are immutable");
    }
  }

  append(name: string, value: string): void {
    requireArguments(arguments, 2, "Headers.append");
    // All Web IDL arguments are converted before Fetch validates HTTP syntax.
    // https://webidl.spec.whatwg.org/#es-operations
    const convertedName = coerceToByteString(name);
    const convertedValue = coerceToByteString(value);
    this.#appendConverted(convertedName, convertedValue);
  }

  #appendConverted(name: string, value: string): void {
    const key = normalizeConvertedName(name);
    const normalized = normalizeConvertedValue(value);
    this.#writable();
    this.#sortedCache = null;
    this.#list.push([key, normalized]);
  }

  set(name: string, value: string): void {
    requireArguments(arguments, 2, "Headers.set");
    const convertedName = coerceToByteString(name);
    const convertedValue = coerceToByteString(value);
    const key = normalizeConvertedName(convertedName);
    const normalized = normalizeConvertedValue(convertedValue);
    this.#writable();
    this.#sortedCache = null;
    let found = false;
    let write = 0;
    for (const entry of this.#list) {
      if (entry[0] !== key) {
        this.#list[write++] = entry;
      } else if (!found) {
        this.#list[write++] = [key, normalized];
        found = true;
      }
    }
    if (!found) {
      this.#list[write++] = [key, normalized];
    }
    this.#list.length = write;
  }

  delete(name: string): void {
    requireArguments(arguments, 1, "Headers.delete");
    const key = normalizeName(name);
    this.#writable();
    this.#sortedCache = null;
    let write = 0;
    for (const entry of this.#list) {
      if (entry[0] !== key) {
        this.#list[write++] = entry;
      }
    }
    this.#list.length = write;
  }

  get(name: string): string | null {
    requireArguments(arguments, 1, "Headers.get");
    return this.#get(normalizeName(name));
  }

  #get(key: string): string | null {
    let first: string | null = null;
    let values: string[] | null = null;

    for (const entry of this.#list) {
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
    requireArguments(arguments, 1, "Headers.has");
    const key = normalizeName(name);
    for (const entry of this.#list) {
      if (entry[0] === key) {
        return true;
      }
    }
    return false;
  }

  getSetCookie(): string[] {
    const values: string[] = [];

    for (const entry of this.#list) {
      if (entry[0] === "set-cookie") {
        values.push(entry[1]);
      }
    }
    return values;
  }

  /** @internal Returns independent tuples; callers cannot mutate the header list. */
  [headersRawEntries](): HeaderEntry[] {
    const result: HeaderEntry[] = [];

    for (const entry of this.#list) {
      result.push([entry[0], entry[1]]);
    }
    return result;
  }

  get [headersGuardIsImmutable](): boolean {
    return this.#guard === "immutable";
  }

  [headersMakeImmutable](): this {
    this.#guard = "immutable";
    return this;
  }

  #sorted(): HeaderEntry[] {
    if (this.#sortedCache !== null) {
      return this.#sortedCache;
    }
    const grouped = new Map<string, HeaderGroup>();

    for (const entry of this.#list) {
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
    this.#sortedCache = result;
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
    callback: HeaderForEachCallback,
    thisArg: unknown = undefined,
  ): void {
    // Iterable forEach validates even when the list is empty, then invokes the
    // callback with abstract Call rather than looking up a public .call method.
    // https://webidl.spec.whatwg.org/#es-forEach
    requireArguments(arguments, 1, "Headers.forEach");
    if (typeof callback !== "function") throw new TypeError("Headers callback must be callable");
    for (const entry of this.#entrySteps()) {
      callForEachCallback(callback, thisArg, entry[1], entry[0], this);
    }
  }

  [Symbol.iterator](): IterableIterator<HeaderEntry> {
    return this.entries();
  }

}
// Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
// written inline rather than through a helper.
// Web IDL gives operations `{ writable: true, enumerable: true, configurable: true }`
// and attribute accessors `{ enumerable: true, configurable: true }`. Safe here now that
// Headers prototype carries no non-standard names: the internals other modules need are
// symbol-keyed, and `getOwnPropertyNames` does not report symbols, so this loop cannot
// reach them.
for (const key of Object.getOwnPropertyNames(Headers.prototype)) {
  if (key === "constructor") continue;
  const descriptor = Object.getOwnPropertyDescriptor(Headers.prototype, key);
  if (descriptor === undefined || descriptor.enumerable) continue;
  descriptor.enumerable = true;
  Object.defineProperty(Headers.prototype, key, descriptor);
}
Object.defineProperty(Headers.prototype, Symbol.toStringTag, {
  value: "Headers",
  writable: false,
  enumerable: false,
  configurable: true,
});
Object.defineProperty(Headers, "length", {
  value: 0,
  writable: false,
  enumerable: false,
  configurable: true,
});

