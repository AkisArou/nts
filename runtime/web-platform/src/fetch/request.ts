import { AbortSignal, createAbortSignal } from "../core/abort.ts";
import {
  coerceToByteString,
  coerceToDOMString,
  coerceToUSVString,
  requireDictionary,
} from "../core/webidl.ts";
import type { RandomSource, URLParser, URLRecord } from "../provider/primitives.ts";
import { Body, BodyState, convertBodyInit } from "./body.ts";
import type { BodyInit, BodyPolicy } from "./body.ts";
import { Headers, isToken } from "./headers.ts";
import type { HeadersInit } from "./headers.ts";
import { ReadableStream } from "../streams/readable.ts";

export type RequestRedirect = "follow" | "error" | "manual";

export type RequestCredentials = "omit" | "same-origin" | "include";

export interface RequestInit {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  signal?: AbortSignal | null;
  redirect?: RequestRedirect;
  credentials?: RequestCredentials;
  duplex?: "half";
}

export interface RequestContext {
  urls: URLParser;
  random: RandomSource;
  bodyPolicy: BodyPolicy;
  baseURL?: string;
}

interface ConvertedRequestInit {
  readonly body: BodyInit | null | undefined;
  readonly credentials: RequestCredentials | undefined;
  readonly duplex: "half" | undefined;
  readonly headers: Headers | undefined;
  readonly method: string | undefined;
  readonly redirect: RequestRedirect | undefined;
  readonly signal: AbortSignal | null | undefined;
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

function convertRequestInit(init: RequestInit | null | undefined): ConvertedRequestInit {
  if (init === undefined || init === null) {
    return {
      body: undefined,
      credentials: undefined,
      duplex: undefined,
      headers: undefined,
      method: undefined,
      redirect: undefined,
      signal: undefined,
    };
  }
  requireDictionary(init, "Request init");

  // Web IDL dictionary conversion is observably lexicographic. Keep these reads
  // in member-name order and perform each member's type conversion immediately.
  const bodyValue = init.body;
  const body = bodyValue === undefined ? undefined : convertBodyInit(bodyValue);
  const credentials = convertCredentials(init.credentials);
  const duplex = convertDuplex(init.duplex);
  const headerInit = init.headers;
  const headers = headerInit === undefined ? undefined : new Headers(headerInit);
  const methodValue = init.method;
  const method = methodValue === undefined ? undefined : coerceToByteString(methodValue);
  const redirect = convertRedirect(init.redirect);
  const signal = init.signal;
  if (signal !== undefined && signal !== null && !(signal instanceof AbortSignal)) {
    throw new TypeError("Request signal must be an AbortSignal");
  }
  return { body, credentials, duplex, headers, method, redirect, signal };
}

export function normalizeMethod(method: string): string {
  return normalizeConvertedMethod(coerceToByteString(method));
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

export function validateNetworkURL(url: URLRecord): void {
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new TypeError("Only HTTP(S) URLs are supported");

  if (url.username !== "" || url.password !== "")
    throw new TypeError("Credentials in URLs are not permitted");
}

export class Request extends Body {
  readonly method: string;
  readonly headers: Headers;
  readonly signal: AbortSignal;
  readonly redirect: RequestRedirect;
  readonly credentials: RequestCredentials;
  readonly duplex = "half";
  readonly parsedURL: URLRecord;
  private readonly context: RequestContext;

  constructor(input: string | Request, init: RequestInit | null, context: RequestContext) {
    const source = input instanceof Request ? input : null;
    const inputURL = source === null ? coerceToUSVString(input) : source.url;
    const convertedInit = convertRequestInit(init);
    const url = context.urls.parse(inputURL, context.baseURL);
    validateNetworkURL(url);
    const method = normalizeConvertedMethod(convertedInit.method ?? source?.method ?? "GET");
    const redirect = convertedInit.redirect ?? source?.redirect ?? "follow";
    const credentials = convertedInit.credentials ?? source?.credentials ?? "same-origin";
    const hasNewBody = convertedInit.body !== undefined && convertedInit.body !== null;
    if (
      (method === "GET" || method === "HEAD") &&
      (hasNewBody || (source?.body !== null && source !== null))
    ) {
      throw new TypeError("GET and HEAD requests cannot have a body");
    }
    if (convertedInit.body instanceof ReadableStream && convertedInit.duplex !== "half")
      throw new TypeError("A streaming request body requires duplex: 'half'");
    const headers = new Headers(convertedInit.headers ?? source?.headers);
    const state = hasNewBody
      ? BodyState.fromConvertedBody(convertedInit.body, context.random, context.bodyPolicy)
      : source === null
        ? BodyState.empty(context.bodyPolicy)
        : source.getState().transfer();
    if (!headers.has("content-type") && state.type !== null)
      headers.set("content-type", state.type);
    super(state);
    this.method = method;
    this.headers = headers;
    this.parsedURL = url;
    this.context = context;
    const inherited =
      convertedInit.signal === null ? undefined : (convertedInit.signal ?? source?.signal);
    this.signal = inherited === undefined ? createAbortSignal() : AbortSignal.any([inherited]);
    this.redirect = redirect;
    this.credentials = credentials;
  }

  get url(): string {
    return this.parsedURL.href;
  }
  protected override contentType(): string | null {
    return this.headers.get("content-type");
  }

  clone(): Request {
    const state = this.bodyState.clone();
    const result = new Request(
      this.url,
      {
        method: this.method,
        headers: this.headers,
        signal: this.signal,
        redirect: this.redirect,
        credentials: this.credentials,
      },
      this.context,
    );
    result.bodyState = state;
    return result;
  }
}
