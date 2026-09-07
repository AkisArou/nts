import {
  coerceToByteString,
  coerceToUSVString,
  requireDictionary,
  toUnsignedShort,
} from "../core/webidl.ts";
import type { RandomSource, URLParser } from "../provider/primitives.ts";
import { currentWebPlatformRuntime } from "../provider/environment.ts";
import type { ReadableStream } from "../streams/readable.ts";
import { Blob } from "../file/blob.ts";
import { Body, BodyState, convertBodyInit } from "./body.ts";
import type { BodyInit, BodyPolicy } from "./body.ts";
import { Headers } from "./headers.ts";
import type { HeaderEntry, HeadersInit } from "./headers.ts";
import { headersGuardIsImmutable, headersMakeImmutable } from "./headers.ts";

export interface ResponseInit {
  status?: number;
  statusText?: string;
  headers?: HeadersInit;
}

export interface ResponseContext {
  random: RandomSource;
  bodyPolicy: BodyPolicy;
  urls: URLParser;
  baseURL?: string;
}

export type ResponseType = "basic" | "cors" | "default" | "error" | "opaque" | "opaqueredirect";

interface ConvertedResponseInit {
  readonly headers: Headers | undefined;
  readonly status: number;
  readonly statusText: string;
}

function convertResponseInit(init: ResponseInit | null | undefined): ConvertedResponseInit {
  if (init === undefined || init === null) {
    return { headers: undefined, status: 200, statusText: "" };
  }
  requireDictionary(init, "Response init");

  // Web IDL converts dictionary members in lexicographic order. Constructing
  // Headers here also consumes and converts an iterable before `status` is read.
  const headerInit = init.headers;
  const headers = headerInit === undefined ? undefined : new Headers(headerInit);
  const statusValue = init.status;
  const status = statusValue === undefined ? 200 : toUnsignedShort(statusValue);
  const statusTextValue = init.statusText;
  const statusText = statusTextValue === undefined ? "" : coerceToByteString(statusTextValue);
  return { headers, status, statusText };
}

export function nullBodyStatus(status: number): boolean {
  return status === 101 || status === 103 || status === 204 || status === 205 || status === 304;
}

export function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

const responseConstructorKey: unique symbol = Symbol("construct NTS Response");

export class Response extends Body {
  private readonly context: ResponseContext;
  private responseStatus: number;
  private readonly responseStatusText: string;
  private readonly responseHeaders: Headers;
  private responseURL = "";
  private wasRedirected = false;
  private responseType: ResponseType = "default";

  constructor(body?: BodyInit | null, init?: ResponseInit);
  /** @internal Reached only through {@link createInternalResponse}. */ constructor(
    body: BodyInit | null | undefined,
    init: ResponseInit | null | undefined,
    key: typeof responseConstructorKey,
    internalContext: ResponseContext,
  );
  constructor(
    body: BodyInit | null = null,
    init: ResponseInit | null = {},
    key: typeof responseConstructorKey | undefined = undefined,
    internalContext: ResponseContext | undefined = undefined,
  ) {
    // The public API is `(body, init)`. Surplus arguments are ignored because the
    // construction key is module-private and therefore unforgeable by script, so a
    // caller cannot substitute the body policy or randomness this response uses.
    const internal = key === responseConstructorKey && internalContext !== undefined;
    const context = internal ? internalContext : currentWebPlatformRuntime().requestContext;
    // Web IDL converts arguments left to right before the constructor algorithm.
    const convertedBody = convertBodyInit(body);
    const convertedInit = convertResponseInit(init);
    const status = convertedInit.status;
    if (status < 200 || status > 599) throw new RangeError("Response status must be 200..599");
    const statusText = convertedInit.statusText;
    for (let i = 0; i < statusText.length; ++i) {
      const c = statusText.charCodeAt(i);
      if ((c < 0x20 && c !== 9) || c > 255 || c === 0x7f) throw new TypeError("Invalid statusText");
    }
    if (convertedBody !== null && convertedBody !== undefined && nullBodyStatus(status))
      throw new TypeError("This response status cannot have a body");
    const state = BodyState.fromConvertedBody(convertedBody, context.random, context.bodyPolicy);
    const headers = convertedInit.headers ?? new Headers();
    if (!headers.has("content-type") && state.type !== null)
      headers.set("content-type", state.type);
    super(state);
    this.context = context;
    this.responseStatus = status;
    this.responseStatusText = statusText;
    this.responseHeaders = headers;
  }

  get status(): number {
    return this.responseStatus;
  }

  get ok(): boolean {
    return this.status >= 200 && this.status <= 299;
  }

  get statusText(): string {
    return this.responseStatusText;
  }

  get headers(): Headers {
    return this.responseHeaders;
  }

  get url(): string {
    return this.responseURL;
  }

  get redirected(): boolean {
    return this.wasRedirected;
  }

  get type(): ResponseType {
    return this.responseType;
  }

  protected override contentType(): string | null {
    return this.headers.get("content-type");
  }

  clone(): Response {
    const state = this.bodyState.clone();
    const copy = createInternalResponse(
      null,
      {
        status: this.status === 0 ? 200 : this.status,
        statusText: this.statusText,
        headers: this.headers,
      },
      this.context,
    );
    copy.responseStatus = this.responseStatus;
    copy.responseURL = this.responseURL;
    copy.wasRedirected = this.wasRedirected;
    copy.responseType = this.responseType;
    copy.bodyState = state;
    if (this.headers[headersGuardIsImmutable]) copy.headers[headersMakeImmutable]();
    return copy;
  }

  static error(): Response {
    const result = new Response();
    result.responseStatus = 0;
    result.responseType = "error";
    result.headers[headersMakeImmutable]();
    return result;
  }

  static redirect(url: string, status = 302): Response {
    const convertedURL = coerceToUSVString(url);
    const convertedStatus = toUnsignedShort(status);
    const runtime = currentWebPlatformRuntime();
    const absolute = runtime.requestContext.urls.parse(
      convertedURL,
      runtime.requestContext.baseURL,
    ).href;
    if (!isRedirectStatus(convertedStatus)) throw new RangeError("Invalid redirect status");
    const result = new Response(null, {
      status: convertedStatus,
      headers: [["location", absolute]],
    });
    result.headers[headersMakeImmutable]();
    return result;
  }

  static json(data: unknown, init: ResponseInit = {}): Response {
    // Web IDL converts the complete init dictionary before the JSON algorithm.
    const convertedInit = convertResponseInit(init);
    const text = JSON.stringify(data);
    if (text === undefined) throw new TypeError("Value is not JSON serializable");
    const headers = convertedInit.headers ?? new Headers();
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new Response(text, {
      status: convertedInit.status,
      statusText: convertedInit.statusText,
      headers,
    });
  }

  /** @internal */ static fromTransport(
    status: number,
    statusText: string,
    headers: readonly HeaderEntry[],
    stream: ReadableStream<Uint8Array> | null,
    url: string,
    redirected: boolean,
    context: ResponseContext,
  ): Response {
    const result = createInternalResponse(null, { status, statusText, headers }, context);
    result.bodyState = new BodyState(
      stream,
      result.headers.get("content-type"),
      null,
      null,
      context.bodyPolicy,
    );
    result.responseURL = url;
    result.wasRedirected = redirected;
    result.responseType = "basic";
    result.headers[headersMakeImmutable]();
    return result;
  }

  /** @internal Recreate the independent immutable response object returned by Cache. */
  static fromCache(
    status: number,
    statusText: string,
    headers: readonly HeaderEntry[],
    body: Blob | null,
    url: string,
    redirected: boolean,
    type: ResponseType,
    context: ResponseContext,
  ): Response {
    const result = createInternalResponse(
      body,
      { status: status === 0 ? 200 : status, statusText, headers },
      context,
    );
    result.responseStatus = status;
    result.responseURL = url;
    result.wasRedirected = redirected;
    result.responseType = type;
    result.headers[headersMakeImmutable]();
    return result;
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "Response",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

/**
 * Construct a Response owned by an explicit context.
 *
 * The capability travels through this module-private factory rather than a public
 * constructor argument, so script cannot supply it as a surplus argument.
 */
function createInternalResponse(
  body: BodyInit | null | undefined,
  init: ResponseInit | null | undefined,
  context: ResponseContext,
): Response {
  return new Response(body, init, responseConstructorKey, context);
}
