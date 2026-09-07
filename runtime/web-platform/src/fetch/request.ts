import { AbortSignal, createAbortSignal } from "../core/abort.ts";
import {
  coerceToBoolean,
  coerceToByteString,
  coerceToDOMString,
  coerceToUSVString,
  requireDictionary,
} from "../core/webidl.ts";
import type { RandomSource, URLParser, URLRecord } from "../provider/primitives.ts";
import { currentWebPlatformRuntime } from "../provider/environment.ts";
import type { Blob } from "../file/blob.ts";
import type { BlobURLStore } from "../file/object-url.ts";
import { Body, BodyState, convertBodyInit } from "./body.ts";
import type { BodyInit, BodyPolicy } from "./body.ts";
import { Headers, isToken } from "./headers.ts";
import type { HeadersInit } from "./headers.ts";
import type { FileURLProvider } from "./file-url.ts";
import type { DigestProvider } from "./integrity.ts";
import { ReadableStream } from "../streams/readable.ts";
import { bodyContentType } from "./body.ts";

export type RequestRedirect = "follow" | "error" | "manual";

export type RequestCredentials = "omit" | "same-origin" | "include";

export type RequestCache =
  | "default"
  | "no-store"
  | "reload"
  | "no-cache"
  | "force-cache"
  | "only-if-cached";

export type RequestMode = "navigate" | "same-origin" | "no-cors" | "cors";

export type RequestDestination =
  | ""
  | "audio"
  | "audioworklet"
  | "document"
  | "embed"
  | "font"
  | "frame"
  | "iframe"
  | "image"
  | "json"
  | "manifest"
  | "object"
  | "paintworklet"
  | "report"
  | "script"
  | "sharedworker"
  | "style"
  | "text"
  | "track"
  | "video"
  | "worker"
  | "xslt";

export type ReferrerPolicy =
  | ""
  | "no-referrer"
  | "no-referrer-when-downgrade"
  | "origin"
  | "origin-when-cross-origin"
  | "same-origin"
  | "strict-origin"
  | "strict-origin-when-cross-origin"
  | "unsafe-url";

export type RequestPriority = "high" | "low" | "auto";

export type RequestInfo = string | Request;

export interface RequestInit {
  body?: BodyInit | null;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  duplex?: "half";
  headers?: HeadersInit;
  integrity?: string;
  keepalive?: boolean;
  method?: string;
  mode?: RequestMode;
  priority?: RequestPriority;
  redirect?: RequestRedirect;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  signal?: AbortSignal | null;
  window?: null;
}

export interface RequestContext {
  urls: URLParser;
  random: RandomSource;
  bodyPolicy: BodyPolicy;
  baseURL?: string;
  origin?: string;
  blobURLs: BlobURLStore;
  /** Absent unless the environment was given one; `file:` is otherwise unsupported. */
  fileURLs?: FileURLProvider;
  /**
   * Absent unless the environment was given one. Its absence does not make integrity
   * metadata optional: a request that asks for a check it cannot get is refused.
   */
  digest?: DigestProvider;
}

/** @internal Metadata set by Fetch rather than by the public RequestInit dictionary. */
export interface RequestInternalMetadata {
  readonly destination: RequestDestination;
  readonly isReloadNavigation: boolean;
  readonly isHistoryNavigation: boolean;
}

interface ConvertedRequestInit {
  readonly body: BodyInit | null | undefined;
  readonly cache: RequestCache | undefined;
  readonly credentials: RequestCredentials | undefined;
  readonly duplex: "half" | undefined;
  readonly headers: Headers | undefined;
  readonly integrity: string | undefined;
  readonly keepalive: boolean | undefined;
  readonly method: string | undefined;
  readonly mode: RequestMode | undefined;
  readonly priority: RequestPriority | undefined;
  readonly redirect: RequestRedirect | undefined;
  readonly referrer: string | undefined;
  readonly referrerPolicy: ReferrerPolicy | undefined;
  readonly signal: AbortSignal | null | undefined;
  readonly window: unknown;
  readonly hasMembers: boolean;
}

function convertCache(value: RequestCache | undefined): RequestCache | undefined {
  if (value === undefined) return undefined;
  const converted = coerceToDOMString(value);
  if (
    converted !== "default" &&
    converted !== "no-store" &&
    converted !== "reload" &&
    converted !== "no-cache" &&
    converted !== "force-cache" &&
    converted !== "only-if-cached"
  ) {
    throw new TypeError("Invalid cache mode");
  }
  return converted;
}

function convertCredentials(value: string | undefined): RequestCredentials | undefined {
  if (value === undefined) {
    return undefined;
  }
  const converted = coerceToDOMString(value);
  if (converted !== "include" && converted !== "omit" && converted !== "same-origin") {
    throw new TypeError("Invalid credentials mode");
  }
  return converted;
}

function convertDuplex(value: "half" | undefined): "half" | undefined {
  if (value === undefined) {
    return undefined;
  }
  const converted = coerceToDOMString(value);
  if (converted !== "half") {
    throw new TypeError("Invalid duplex mode");
  }
  return converted;
}

function convertRedirect(value: RequestRedirect | undefined): RequestRedirect | undefined {
  if (value === undefined) {
    return undefined;
  }
  const converted = coerceToDOMString(value);
  if (converted !== "follow" && converted !== "manual" && converted !== "error") {
    throw new TypeError("Invalid redirect mode");
  }
  return converted;
}

function convertMode(value: RequestMode | undefined): RequestMode | undefined {
  if (value === undefined) return undefined;
  const converted = coerceToDOMString(value);
  if (
    converted !== "navigate" &&
    converted !== "same-origin" &&
    converted !== "no-cors" &&
    converted !== "cors"
  ) {
    throw new TypeError("Invalid request mode");
  }
  return converted;
}

function convertPriority(value: RequestPriority | undefined): RequestPriority | undefined {
  if (value === undefined) return undefined;
  const converted = coerceToDOMString(value);
  if (converted !== "high" && converted !== "low" && converted !== "auto") {
    throw new TypeError("Invalid request priority");
  }
  return converted;
}

function convertReferrerPolicy(value: ReferrerPolicy | undefined): ReferrerPolicy | undefined {
  if (value === undefined) return undefined;
  const converted = coerceToDOMString(value);
  if (
    converted !== "" &&
    converted !== "no-referrer" &&
    converted !== "no-referrer-when-downgrade" &&
    converted !== "origin" &&
    converted !== "origin-when-cross-origin" &&
    converted !== "same-origin" &&
    converted !== "strict-origin" &&
    converted !== "strict-origin-when-cross-origin" &&
    converted !== "unsafe-url"
  ) {
    throw new TypeError("Invalid referrer policy");
  }
  return converted;
}

function convertRequestInit(init: RequestInit | null | undefined): ConvertedRequestInit {
  if (init === undefined || init === null) {
    return {
      body: undefined,
      cache: undefined,
      credentials: undefined,
      duplex: undefined,
      headers: undefined,
      integrity: undefined,
      keepalive: undefined,
      method: undefined,
      mode: undefined,
      priority: undefined,
      redirect: undefined,
      referrer: undefined,
      referrerPolicy: undefined,
      signal: undefined,
      window: undefined,
      hasMembers: false,
    };
  }
  requireDictionary(init, "Request init");

  // Web IDL dictionary conversion is observably lexicographic. Keep these reads
  // in member-name order and perform each member's type conversion immediately.
  const bodyValue = init.body;
  const body = bodyValue === undefined ? undefined : convertBodyInit(bodyValue);
  const cache = convertCache(init.cache);
  const credentials = convertCredentials(init.credentials);
  const duplex = convertDuplex(init.duplex);
  const headerInit = init.headers;
  const headers = headerInit === undefined ? undefined : new Headers(headerInit);
  const integrityValue = init.integrity;
  const integrity = integrityValue === undefined ? undefined : coerceToDOMString(integrityValue);
  const keepaliveValue = init.keepalive;
  const keepalive = keepaliveValue === undefined ? undefined : coerceToBoolean(keepaliveValue);
  const methodValue = init.method;
  const method = methodValue === undefined ? undefined : coerceToByteString(methodValue);
  const mode = convertMode(init.mode);
  const priority = convertPriority(init.priority);
  const redirect = convertRedirect(init.redirect);
  const referrerValue = init.referrer;
  const referrer = referrerValue === undefined ? undefined : coerceToUSVString(referrerValue);
  const referrerPolicy = convertReferrerPolicy(init.referrerPolicy);
  const signal = init.signal;
  if (signal !== undefined && signal !== null && !(signal instanceof AbortSignal)) {
    throw new TypeError("Request signal must be an AbortSignal");
  }
  const window = init.window;
  return {
    body,
    cache,
    credentials,
    duplex,
    headers,
    integrity,
    keepalive,
    method,
    mode,
    priority,
    redirect,
    referrer,
    referrerPolicy,
    signal,
    window,
    hasMembers:
      body !== undefined ||
      cache !== undefined ||
      credentials !== undefined ||
      duplex !== undefined ||
      headers !== undefined ||
      integrity !== undefined ||
      keepalive !== undefined ||
      method !== undefined ||
      mode !== undefined ||
      priority !== undefined ||
      redirect !== undefined ||
      referrer !== undefined ||
      referrerPolicy !== undefined ||
      signal !== undefined ||
      window !== undefined,
  };
}

function normalizeConvertedMethod(method: string): string {
  if (!isToken(method)) throw new TypeError("Invalid HTTP method");
  const upper = method.toUpperCase();

  if (upper === "CONNECT" || upper === "TRACE" || upper === "TRACK")
    throw new TypeError("Forbidden HTTP method");
  return isNormalizedMethod(upper) ? upper : method;
}

function isNormalizedMethod(method: string): boolean {
  return (
    method === "DELETE" ||
    method === "GET" ||
    method === "HEAD" ||
    method === "OPTIONS" ||
    method === "POST" ||
    method === "PUT"
  );
}

function isCORSSafelistedMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "POST";
}

function normalizeReferrer(referrer: string, context: RequestContext): string {
  if (referrer === "") return "";
  const parsed = context.urls.parse(referrer, context.baseURL);
  if (parsed.protocol === "about:" && parsed.pathname === "client") return "about:client";
  if (context.origin !== undefined && parsed.origin !== context.origin) return "about:client";
  return parsed.href;
}

export function validateRequestURL(url: URLRecord): void {
  if (url.username !== "" || url.password !== "")
    throw new TypeError("Credentials in URLs are not permitted");
}

const requestConstructorKey: unique symbol = Symbol("construct NTS Request");

export class Request extends Body {
  private readonly requestMethod: string;
  private readonly requestHeaders: Headers;
  private readonly requestSignal: AbortSignal;
  private readonly requestRedirect: RequestRedirect;
  private readonly requestCredentials: RequestCredentials;
  private readonly requestDestination: RequestDestination;
  private readonly requestReferrer: string;
  private readonly requestReferrerPolicy: ReferrerPolicy;
  private readonly requestMode: RequestMode;
  private readonly requestCache: RequestCache;
  private readonly requestIntegrity: string;
  private readonly requestKeepalive: boolean;
  private readonly reloadNavigation: boolean;
  private readonly historyNavigation: boolean;
  /** @internal Fetch scheduling metadata; `priority` is not a public Request attribute. */
  readonly requestPriority: RequestPriority;
  /** @internal */ readonly parsedURL: URLRecord;
  /** @internal The Blob URL entry captured when this request's URL was parsed. */
  readonly blobURLObject: Blob | null;
  private readonly context: RequestContext;

  constructor(input: string | Request, init?: RequestInit);
  /** @internal Reached only through {@link createInternalRequest}. */ constructor(
    input: string | Request,
    init: RequestInit | null | undefined,
    key: typeof requestConstructorKey,
    internalContext: RequestContext,
    internalBlobURLObject?: Blob | null,
    internalMetadata?: RequestInternalMetadata,
  );
  constructor(
    input: string | Request,
    init: RequestInit | null | undefined = undefined,
    key: typeof requestConstructorKey | undefined = undefined,
    internalContext: RequestContext | undefined = undefined,
    internalBlobURLObject: Blob | null | undefined = undefined,
    internalMetadata: RequestInternalMetadata | undefined = undefined,
  ) {
    // The public API is `(input, init)`. Surplus arguments are ignored because the
    // construction key is module-private and therefore unforgeable by script, so a
    // caller cannot substitute the URL parser, body policy or randomness this
    // request uses. Only this module's internal factory supplies another context.
    const internal = key === requestConstructorKey && internalContext !== undefined;
    const context = internal ? internalContext : currentWebPlatformRuntime().requestContext;
    const blobURLObject = internal ? internalBlobURLObject : undefined;
    const metadata = internal ? internalMetadata : undefined;
    const source = input instanceof Request ? input : null;
    const inputURL = source === null ? coerceToUSVString(input) : source.url;
    const convertedInit = convertRequestInit(init);
    const url = context.urls.parse(inputURL, context.baseURL);
    validateRequestURL(url);
    if (convertedInit.window !== undefined && convertedInit.window !== null) {
      throw new TypeError("Request window must be null");
    }
    const method = normalizeConvertedMethod(convertedInit.method ?? source?.method ?? "GET");
    const mode = convertedInit.mode ?? source?.mode ?? "cors";
    if (mode === "navigate") throw new TypeError("Request mode cannot be navigate");
    if (mode === "no-cors" && !isCORSSafelistedMethod(method)) {
      throw new TypeError("Method is not permitted in no-cors mode");
    }
    const cache = convertedInit.cache ?? source?.cache ?? "default";
    if (cache === "only-if-cached" && mode !== "same-origin") {
      throw new TypeError("only-if-cached requires same-origin mode");
    }
    const redirect = convertedInit.redirect ?? source?.redirect ?? "follow";
    const credentials = convertedInit.credentials ?? source?.credentials ?? "same-origin";
    const resetMetadata = source !== null && convertedInit.hasMembers;
    const referrer =
      convertedInit.referrer === undefined
        ? resetMetadata
          ? "about:client"
          : (source?.referrer ?? "about:client")
        : normalizeReferrer(convertedInit.referrer, context);
    const referrerPolicy =
      convertedInit.referrerPolicy ?? (resetMetadata ? "" : (source?.referrerPolicy ?? ""));
    const integrity = convertedInit.integrity ?? source?.integrity ?? "";
    const keepalive = convertedInit.keepalive ?? source?.keepalive ?? false;
    const priority = convertedInit.priority ?? source?.requestPriority ?? "auto";
    const hasNewBody = convertedInit.body !== undefined && convertedInit.body !== null;
    if (
      (method === "GET" || method === "HEAD") &&
      (hasNewBody || (source?.body !== null && source !== null))
    ) {
      throw new TypeError("GET and HEAD requests cannot have a body");
    }
    if (convertedInit.body instanceof ReadableStream && convertedInit.duplex !== "half")
      throw new TypeError("A streaming request body requires duplex: 'half'");
    if (keepalive && convertedInit.body instanceof ReadableStream) {
      throw new TypeError("A streaming request body cannot use keepalive");
    }
    const headers = new Headers(convertedInit.headers ?? source?.headers);
    const state = hasNewBody
      ? BodyState.fromConvertedBody(convertedInit.body, context.random, context.bodyPolicy)
      : source === null
        ? BodyState.empty(context.bodyPolicy)
        : source.getState().transfer();
    if (!headers.has("content-type") && state.type !== null)
      headers.set("content-type", state.type);
    super(state);
    this.requestMethod = method;
    this.requestHeaders = headers;
    this.parsedURL = url;
    this.blobURLObject =
      blobURLObject !== undefined
        ? blobURLObject
        : source === null
          ? context.blobURLs.resolve(url)
          : source.blobURLObject;
    this.context = context;
    const inherited =
      convertedInit.signal === null ? undefined : (convertedInit.signal ?? source?.signal);
    this.requestSignal =
      inherited === undefined ? createAbortSignal() : AbortSignal.any([inherited]);
    this.requestRedirect = redirect;
    this.requestCredentials = credentials;
    this.requestDestination = metadata?.destination ?? source?.destination ?? "";
    this.requestReferrer = referrer;
    this.requestReferrerPolicy = referrerPolicy;
    this.requestMode = mode;
    this.requestCache = cache;
    this.requestIntegrity = integrity;
    this.requestKeepalive = keepalive;
    this.reloadNavigation =
      metadata?.isReloadNavigation ??
      (resetMetadata ? false : (source?.isReloadNavigation ?? false));
    this.historyNavigation =
      metadata?.isHistoryNavigation ??
      (resetMetadata ? false : (source?.isHistoryNavigation ?? false));
    this.requestPriority = priority;
  }

  get method(): string {
    return this.requestMethod;
  }

  get url(): string {
    return this.parsedURL.href;
  }

  get headers(): Headers {
    return this.requestHeaders;
  }

  get destination(): RequestDestination {
    return this.requestDestination;
  }

  get referrer(): string {
    return this.requestReferrer;
  }

  get referrerPolicy(): ReferrerPolicy {
    return this.requestReferrerPolicy;
  }

  get mode(): RequestMode {
    return this.requestMode;
  }

  get credentials(): RequestCredentials {
    return this.requestCredentials;
  }

  get cache(): RequestCache {
    return this.requestCache;
  }

  get redirect(): RequestRedirect {
    return this.requestRedirect;
  }

  get integrity(): string {
    return this.requestIntegrity;
  }

  get keepalive(): boolean {
    return this.requestKeepalive;
  }

  get isReloadNavigation(): boolean {
    return this.reloadNavigation;
  }

  get isHistoryNavigation(): boolean {
    return this.historyNavigation;
  }

  get signal(): AbortSignal {
    return this.requestSignal;
  }

  get duplex(): "half" {
    return "half";
  }

  protected override [bodyContentType](): string | null {
    return this.headers.get("content-type");
  }

  clone(): Request {
    const state = this.bodyState.clone();
    const result = createInternalRequest(
      this.url,
      {
        method: this.method,
        headers: this.headers,
        signal: this.signal,
        redirect: this.redirect,
        credentials: this.credentials,
        cache: this.cache,
        integrity: this.integrity,
        keepalive: this.keepalive,
        mode: this.mode,
        priority: this.requestPriority,
        referrer: this.referrer,
        referrerPolicy: this.referrerPolicy,
      },
      this.context,
      this.blobURLObject,
      {
        destination: this.destination,
        isReloadNavigation: this.isReloadNavigation,
        isHistoryNavigation: this.isHistoryNavigation,
      },
    );
    result.bodyState = state;
    return result;
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    // Web IDL member attributes; safe here because this prototype now carries no
    // non-standard names -- the body's MIME hook is symbol-keyed and invisible to
    // `getOwnPropertyNames`.
    for (const key of Object.getOwnPropertyNames(this.prototype)) {
      if (key === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(this.prototype, key);
      if (descriptor === undefined || descriptor.enumerable) continue;
      descriptor.enumerable = true;
      Object.defineProperty(this.prototype, key, descriptor);
    }
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "Request",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

/**
 * @internal Construct a Request owned by an explicit context.
 *
 * The capability travels through this module-private factory rather than a public
 * constructor argument, so script cannot supply it as a surplus argument.
 */
export function createInternalRequest(
  input: string | Request,
  init: RequestInit | null | undefined,
  context: RequestContext,
  blobURLObject?: Blob | null,
  metadata?: RequestInternalMetadata,
): Request {
  return new Request(input, init, requestConstructorKey, context, blobURLObject, metadata);
}
