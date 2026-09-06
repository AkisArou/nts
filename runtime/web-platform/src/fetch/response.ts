import { Body, BodyState, standardBodyPolicy } from "./body.ts";
import type { BodyInit, BodyPolicy } from "./body.ts";
import { Headers } from "./headers.ts";
import type { HeadersInit, HeaderEntry } from "./headers.ts";
import type { RandomSource, URLParser } from "../core/platform.ts";
import type { ReadableStream } from "../streams/readable.ts";

export interface ResponseInit {
  status?: number;
  statusText?: string;
  headers?: HeadersInit;
}

export interface ResponseContext {
  random: RandomSource;
  bodyPolicy: BodyPolicy;
}

const noRandom: RandomSource = {

  fill() {
    throw new TypeError("FormData needs an environment-owned RandomSource");
  },
};

const defaultContext: ResponseContext = { random: noRandom, bodyPolicy: standardBodyPolicy };

export function nullBodyStatus(status: number): boolean {
  return status === 101 || status === 103 || status === 204 || status === 205 || status === 304;
}

export class Response extends Body {
  private readonly context: ResponseContext;
  private responseStatus: number;
  readonly statusText: string;
  readonly headers: Headers;
  private responseURL = "";
  private wasRedirected = false;
  private responseType: "default" | "basic" | "error" = "default";

  constructor(
    body: BodyInit | null = null,
    init: ResponseInit = {},
    context: ResponseContext = defaultContext,
  ) {
    const status = init.status ?? 200;
    if (!Number.isInteger(status) || status < 200 || status > 599)
      throw new RangeError("Response status must be 200..599");
    const statusText = init.statusText ?? "";
    for (let i = 0; i < statusText.length; ++i) {
      const c = statusText.charCodeAt(i);
      if ((c < 0x20 && c !== 9) || c > 255 || c === 0x7f) throw new TypeError("Invalid statusText");
    }
    if (body !== null && nullBodyStatus(status))
      throw new TypeError("This response status cannot have a body");
    const state = BodyState.extract(body, context.random, context.bodyPolicy);
    const headers = new Headers(init.headers);
    if (!headers.has("content-type") && state.type !== null)
      headers.set("content-type", state.type);
    super(state);
    this.context = context;
    this.responseStatus = status;
    this.statusText = statusText;
    this.headers = headers;
  }

  get status(): number {
    return this.responseStatus;
  }

  get ok(): boolean {
    return this.status >= 200 && this.status <= 299;
  }

  get url(): string {
    return this.responseURL;
  }

  get redirected(): boolean {
    return this.wasRedirected;
  }

  get type(): "default" | "basic" | "error" {
    return this.responseType;
  }
  protected override contentType(): string | null {
    return this.headers.get("content-type");
  }

  clone(): Response {
    const state = this.bodyState.clone();
    const copy = new Response(
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
    if (this.headers.isImmutable) copy.headers.makeImmutable();
    return copy;
  }
  static error(): Response {
    const result = new Response();
    result.responseStatus = 0;
    result.responseType = "error";
    result.headers.makeImmutable();
    return result;
  }
  static redirect(url: string, status: number, urls: URLParser): Response {
    if (![301, 302, 303, 307, 308].includes(status))
      throw new RangeError("Invalid redirect status");
    const absolute = urls.parse(url).href;
    const result = new Response(null, { status, headers: [["location", absolute]] });
    result.headers.makeImmutable();
    return result;
  }
  static json(data: unknown, init: ResponseInit = {}): Response {
    const text = JSON.stringify(data);
    if (text === undefined) throw new TypeError("Value is not JSON serializable");
    const headers = new Headers(init.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new Response(text, { status: init.status, statusText: init.statusText, headers });
  }
  /** @internal */ static fromTransport(
    status: number,
    statusText: string,
    headers: readonly HeaderEntry[],
    stream: ReadableStream<Uint8Array> | null,
    url: string,
    redirected: boolean,
    policy: BodyPolicy,
  ): Response {
    const result = new Response(null, { status, statusText, headers });
    result.bodyState = new BodyState(
      stream,
      result.headers.get("content-type"),
      null,
      null,
      policy,
    );
    result.responseURL = url;
    result.wasRedirected = redirected;
    result.responseType = "basic";
    result.headers.makeImmutable();
    return result;
  }
}
