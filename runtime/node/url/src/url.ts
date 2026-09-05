// `URL`, from https://url.spec.whatwg.org/#url-class.
//
// A thin object over a parsed record: every getter serialises a component and
// every setter re-enters the parser part-way through, at the state that
// component's syntax begins in. That is what makes `url.protocol = 'https'`
// behave the same as parsing the whole thing again with `https` in front of
// it, without either duplicating the rules or having to re-parse.
//
// A setter that cannot make sense of its input does nothing. That is the
// specification's choice and it surprises people, but the alternative -- a
// throw -- would mean `url.port = 'abc'` takes down a program that was only
// ever going to produce a slightly wrong URL.

import {
  basicUrlParse,
  hasOpaquePath,
  isSpecialScheme,
  parseUrl,
  percentEncodeUserinfo,
  serializeHost,
  serializeOrigin,
  serializePath,
  serializeUrl,
  type UrlRecord,
} from "./parser.ts";
import { URLSearchParams, type SearchParamsOwner } from "./searchparams.ts";
import { ERR_MISSING_ARGS } from "../../internal/errors.ts";
import {
  Blob,
  createObjectURL as createBlobObjectURL,
  revokeObjectURL as revokeBlobObjectURL,
} from "../../buffer/src/blob.ts";
import { customInspectSymbol, inspect, type InspectOptions } from "../../util/src/inspect.ts";

export class URL implements SearchParamsOwner {
  #record: UrlRecord;
  #searchParams: URLSearchParams;

  constructor(input: string, base?: string | URL) {
    if (arguments.length === 0) {
      throw new ERR_MISSING_ARGS("url");
    }
    const baseString = base === undefined ? undefined
      : base instanceof URL ? base.href
      : toUSVString(base);
    this.#record = parseUrl(toUSVString(input), baseString);
    this.#searchParams = new URLSearchParams();
    this.#searchParams.bindToOwner(this);
  }

  /** `URL.parse`: the constructor, without the throw. */
  static parse(input: string, base?: string | URL): URL | null {
    if (arguments.length === 0) {
      throw new ERR_MISSING_ARGS("url");
    }
    const text = toUSVString(input);
    const baseString = base === undefined ? undefined
      : base instanceof URL ? base.href
      : toUSVString(base);
    try {
      return new URL(text, baseString);
    } catch {
      return null;
    }
  }

  static canParse(input: string, base?: string | URL): boolean {
    if (arguments.length === 0) {
      throw new ERR_MISSING_ARGS("url");
    }
    const text = toUSVString(input);
    const baseString = base === undefined ? undefined
      : base instanceof URL ? base.href
      : toUSVString(base);
    return URL.parse(text, baseString) !== null;
  }

  static createObjectURL(blob: Blob): string {
    return createBlobObjectURL(blob);
  }

  static revokeObjectURL(url: string): void {
    if (url === undefined) throw new ERR_MISSING_ARGS("url");
    revokeBlobObjectURL(url);
  }

  // ---------------------------------------------- the SearchParamsOwner side

  currentQuery(): string | null {
    return this.#record.query;
  }

  onSearchParamsChanged(serialized: string | null): void {
    this.#record.query = serialized;
  }

  // --------------------------------------------------------------- the URL

  get href(): string {
    URL.#brandCheck(this);
    return serializeUrl(this.#record);
  }

  set href(value: string) {
    // A whole new URL, so the parse is unconditional and a failure throws --
    // unlike every other setter, because there is nothing left to keep.
    URL.#mutationBrandCheck(this);
    this.#record = parseUrl(toUSVString(value));
    this.#searchParams.refreshFromOwner();
  }

  // Both read the record rather than `this.href`, so that a call on a wrong
  // receiver fails on the private field -- `Receiver must be an instance of
  // class URL` -- rather than quietly returning `undefined`.
  toString(): string {
    URL.#brandCheck(this);
    return serializeUrl(this.#record);
  }

  toJSON(): string {
    URL.#brandCheck(this);
    return serializeUrl(this.#record);
  }

  get origin(): string {
    return serializeOrigin(this.#record);
  }

  get protocol(): string {
    return `${this.#record.scheme}:`;
  }

  set protocol(value: string) {
    basicUrlParse(`${toUSVString(value)}:`, null, this.#record, "scheme");
  }

  get username(): string {
    return this.#record.username;
  }

  set username(value: string) {
    // A URL with no host has nowhere to put credentials.
    if (cannotHaveCredentialsOrPort(this.#record)) return;
    this.#record.username = percentEncodeUserinfo(toUSVString(value));
  }

  get password(): string {
    return this.#record.password;
  }

  set password(value: string) {
    if (cannotHaveCredentialsOrPort(this.#record)) return;
    this.#record.password = percentEncodeUserinfo(toUSVString(value));
  }

  get host(): string {
    return serializeHost(this.#record);
  }

  set host(value: string) {
    if (hasOpaquePath(this.#record)) return;
    basicUrlParse(toUSVString(value), null, this.#record, "host");
  }

  get hostname(): string {
    return this.#record.host ?? "";
  }

  set hostname(value: string) {
    if (hasOpaquePath(this.#record)) return;
    basicUrlParse(toUSVString(value), null, this.#record, "hostname");
  }

  get port(): string {
    return this.#record.port === null ? "" : String(this.#record.port);
  }

  set port(value: string) {
    if (cannotHaveCredentialsOrPort(this.#record)) return;
    const text = toUSVString(value);
    if (text === "") {
      this.#record.port = null;
      return;
    }
    basicUrlParse(text, null, this.#record, "port");
  }

  get pathname(): string {
    return serializePath(this.#record);
  }

  set pathname(value: string) {
    if (hasOpaquePath(this.#record)) return;
    this.#record.path = [];
    basicUrlParse(toUSVString(value), null, this.#record, "pathname");
  }

  get search(): string {
    URL.#brandCheck(this);
    const query = this.#record.query;
    return query === null || query === "" ? "" : `?${query}`;
  }

  set search(value: string) {
    let text = toUSVString(value);
    if (text === "") {
      this.#record.query = null;
    } else {
      if (text.startsWith("?")) text = text.slice(1);
      this.#record.query = "";
      basicUrlParse(text, null, this.#record, "search");
    }
    // The params object is a view of the query; changing one has to move the
    // other, or the next `searchParams.get` answers from a stale list.
    this.#searchParams.refreshFromOwner();
  }

  get searchParams(): URLSearchParams {
    return this.#searchParams;
  }

  get hash(): string {
    const fragment = this.#record.fragment;
    return fragment === null || fragment === "" ? "" : `#${fragment}`;
  }

  set hash(value: string) {
    let text = toUSVString(value);
    if (text === "") {
      this.#record.fragment = null;
      return;
    }
    if (text.startsWith("#")) text = text.slice(1);
    this.#record.fragment = "";
    basicUrlParse(text, null, this.#record, "hash");
  }

  /** The parsed form, for `node:url`'s own helpers. Not part of the interface. */
  record(): UrlRecord {
    return this.#record;
  }

  /**
   * Node prints a `URL` as its components rather than as its href, because a
   * reader looking at a URL in a log is usually trying to see which part of it
   * is wrong.
   */
  [customInspectSymbol](depth: number, options: InspectOptions): string | URL {
    if (depth < 0) {
      return this;
    }
    const params = this.#searchParams[customInspectSymbol](depth - 1, options);
    return `URL {\n` +
      `  href: ${inspect(this.href, options)},\n` +
      `  origin: ${inspect(this.origin, options)},\n` +
      `  protocol: ${inspect(this.protocol, options)},\n` +
      `  username: ${inspect(this.username, options)},\n` +
      `  password: ${inspect(this.password, options)},\n` +
      `  host: ${inspect(this.host, options)},\n` +
      `  hostname: ${inspect(this.hostname, options)},\n` +
      `  port: ${inspect(this.port, options)},\n` +
      `  pathname: ${inspect(this.pathname, options)},\n` +
      `  search: ${inspect(this.search, options)},\n` +
      `  searchParams: ${params},\n` +
      `  hash: ${inspect(this.hash, options)}\n` +
      `}`;
  }

  static #brandCheck(value: unknown): asserts value is URL {
    if (value === null || typeof value !== "object" || !(#record in value)) {
      throw new TypeError("Receiver must be an instance of class URL");
    }
  }

  static #mutationBrandCheck(value: unknown): asserts value is URL {
    if (value === null || typeof value !== "object" || !(#record in value)) {
      throw new TypeError(
        "Cannot read private member #record from an object whose class did not declare it",
      );
    }
  }
}

/** Web IDL's `USVString`: stringify, then replace every lone surrogate. */
function toUSVString(value: unknown): string {
  return `${value}`.toWellFormed();
}

/**
 * A URL with no host, or with an opaque path, has nowhere to put a user, a
 * password or a port -- `mailto:` and `data:` are the everyday cases.
 */
function cannotHaveCredentialsOrPort(url: UrlRecord): boolean {
  return url.host === null || url.host === "" || url.scheme === "file";
}

/** Node's internal URL brand predicate for statically typed URL objects. */
export function isURL(value: unknown): value is URL {
  return value instanceof URL;
}

export { isSpecialScheme };
