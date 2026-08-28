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
      : String(base);
    this.#record = parseUrl(String(input), baseString);
    this.#searchParams = new URLSearchParams();
    this.#searchParams.bindToOwner(this);
  }

  /** `URL.parse`: the constructor, without the throw. */
  static parse(input: string, base?: string | URL): URL | null {
    try {
      return new URL(input, base);
    } catch {
      return null;
    }
  }

  static canParse(input: string, base?: string | URL): boolean {
    return URL.parse(input, base) !== null;
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
    return serializeUrl(this.#record);
  }

  set href(value: string) {
    // A whole new URL, so the parse is unconditional and a failure throws --
    // unlike every other setter, because there is nothing left to keep.
    this.#record = parseUrl(String(value));
    this.#searchParams.refreshFromOwner();
  }

  // Both read the record rather than `this.href`, so that a call on a wrong
  // receiver fails on the private field -- `Receiver must be an instance of
  // class URL` -- rather than quietly returning `undefined`.
  toString(): string {
    return serializeUrl(this.#record);
  }

  toJSON(): string {
    return serializeUrl(this.#record);
  }

  get origin(): string {
    return serializeOrigin(this.#record);
  }

  get protocol(): string {
    return `${this.#record.scheme}:`;
  }

  set protocol(value: string) {
    basicUrlParse(`${String(value)}:`, null, this.#record, "scheme");
  }

  get username(): string {
    return this.#record.username;
  }

  set username(value: string) {
    // A URL with no host has nowhere to put credentials.
    if (cannotHaveCredentialsOrPort(this.#record)) return;
    this.#record.username = percentEncodeUserinfo(String(value));
  }

  get password(): string {
    return this.#record.password;
  }

  set password(value: string) {
    if (cannotHaveCredentialsOrPort(this.#record)) return;
    this.#record.password = percentEncodeUserinfo(String(value));
  }

  get host(): string {
    return serializeHost(this.#record);
  }

  set host(value: string) {
    if (hasOpaquePath(this.#record)) return;
    basicUrlParse(String(value), null, this.#record, "host");
  }

  get hostname(): string {
    return this.#record.host ?? "";
  }

  set hostname(value: string) {
    if (hasOpaquePath(this.#record)) return;
    basicUrlParse(String(value), null, this.#record, "hostname");
  }

  get port(): string {
    return this.#record.port === null ? "" : String(this.#record.port);
  }

  set port(value: string) {
    if (cannotHaveCredentialsOrPort(this.#record)) return;
    const text = String(value);
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
    basicUrlParse(String(value), null, this.#record, "pathname");
  }

  get search(): string {
    const query = this.#record.query;
    return query === null || query === "" ? "" : `?${query}`;
  }

  set search(value: string) {
    let text = String(value);
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
    let text = String(value);
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
  [customInspectSymbol](depth: number, options: InspectOptions): string {
    if (depth < 0) {
      return this.constructor.name;
    }
    const constructor = Object.getPrototypeOf(this).constructor as { name: string };
    const object: Record<string, unknown> = {
      href: this.href,
      origin: this.origin,
      protocol: this.protocol,
      username: this.username,
      password: this.password,
      host: this.host,
      hostname: this.hostname,
      port: this.port,
      pathname: this.pathname,
      search: this.search,
      searchParams: this.searchParams,
      hash: this.hash,
    };
    return `${constructor.name} ${inspect(object, { ...options, depth: (options.depth ?? 2) - 1 })}`;
  }
}

/**
 * A URL with no host, or with an opaque path, has nowhere to put a user, a
 * password or a port -- `mailto:` and `data:` are the everyday cases.
 */
function cannotHaveCredentialsOrPort(url: UrlRecord): boolean {
  return url.host === null || url.host === "" || url.scheme === "file";
}

Object.defineProperty(URL.prototype, Symbol.toStringTag, {
  __proto__: null,
  value: "URL",
  writable: false,
  enumerable: false,
  configurable: true,
} as PropertyDescriptor);

export { isSpecialScheme };
