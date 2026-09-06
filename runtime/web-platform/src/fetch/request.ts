import { AbortSignal } from "../core/abort.ts";
import type { RandomSource, URLParser, URLRecord } from "../core/platform.ts";
import { Body, BodyState } from "./body.ts";
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
export function normalizeMethod(method: string): string {
  if (!isToken(method)) throw new TypeError("Invalid HTTP method");
  const upper = method.toUpperCase();
  if (upper === "CONNECT" || upper === "TRACE" || upper === "TRACK")
    throw new TypeError("Forbidden HTTP method");
  return ["DELETE", "GET", "HEAD", "OPTIONS", "POST", "PUT"].includes(upper) ? upper : method;
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
  constructor(input: string | Request, init: RequestInit, context: RequestContext) {
    const source = input instanceof Request ? input : null;
    const url = context.urls.parse(
      source === null ? inputString(input) : source.url,
      context.baseURL,
    );
    validateNetworkURL(url);
    const method = normalizeMethod(init.method ?? source?.method ?? "GET");
    const redirect = init.redirect ?? source?.redirect ?? "follow";
    if (redirect !== "follow" && redirect !== "manual" && redirect !== "error")
      throw new TypeError("Invalid redirect mode");
    const credentials = init.credentials ?? source?.credentials ?? "same-origin";
    if (credentials !== "include" && credentials !== "omit" && credentials !== "same-origin")
      throw new TypeError("Invalid credentials mode");
    if (init.duplex !== undefined && init.duplex !== "half")
      throw new TypeError("Invalid duplex mode");
    const hasNewBody = init.body !== undefined && init.body !== null;
    if (
      (method === "GET" || method === "HEAD") &&
      (hasNewBody || (source?.body !== null && source !== null))
    ) {
      throw new TypeError("GET and HEAD requests cannot have a body");
    }
    if (init.body instanceof ReadableStream && init.duplex !== "half")
      throw new TypeError("A streaming request body requires duplex: 'half'");
    const headers = new Headers(init.headers ?? source?.headers);
    const state = hasNewBody
      ? BodyState.extract(init.body, context.random, context.bodyPolicy)
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
    const inherited = init.signal === null ? undefined : (init.signal ?? source?.signal);
    this.signal = inherited === undefined ? new AbortSignal() : AbortSignal.any([inherited]);
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
function inputString(input: string | Request): string {
  return typeof input === "string" ? input : input.url;
}
