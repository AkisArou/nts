import { AbortSignal } from "../core/abort.ts";
import type { HttpCache, HttpCacheDispatchResult } from "../cache/http-cache.ts";
import type { CookieAccessContext, CookieJar } from "../cookies/jar.ts";
import { trimHTTPTabOrSpace } from "../core/ascii.ts";
import { networkError } from "../core/errors.ts";
import { checkNetworkPort } from "../core/network-port.ts";
import type { URLRecord } from "../provider/primitives.ts";
import type { WebPlatformRuntime } from "../provider/web-platform-runtime.ts";
import { bytesStream, ReadableStream } from "../streams/readable.ts";
import { BodyState } from "./body.ts";
import { Headers } from "./headers.ts";
import { Request, validateRequestURL } from "./request.ts";
import type { RequestContext, RequestInit } from "./request.ts";
import { isRedirectStatus, nullBodyStatus, Response } from "./response.ts";
import type {
  ContentDecoder,
  FetchTransport,
  TransportRequest,
  TransportResponse,
} from "./transport.ts";
import { processDataURL } from "./data-url.ts";
import { fetchBlob } from "./blob-url.ts";

declare function nts_environment_platform(): WebPlatformRuntime;

/** Automatic cookie state is opt-in and its site context is supplied per redirect hop. */
export interface FetchCookiePolicy {
  readonly jar: CookieJar;

  contextFor(url: URLRecord, initialURL: URLRecord, method: string): CookieAccessContext;
}

/** Server/mobile policy with no browser principal: every eligible request is same-site. */
export class ServerCookiePolicy implements FetchCookiePolicy {
  readonly jar: CookieJar;

  constructor(jar: CookieJar) {
    this.jar = jar;
  }

  contextFor(_url: URLRecord, _initialURL: URLRecord, method: string): CookieAccessContext {
    return { type: "http", sameSite: "same-site", topLevelNavigation: false, method };
  }
}

/** Canonical environment-scoped Fetch entry point. */
export function fetch(
  input: string | Request,
  init: RequestInit | undefined = undefined,
): Promise<Response> {
  return nts_environment_platform().fetch(input, init);
}

function checkURL(url: URLRecord): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Unsupported URL scheme");
  }
  validateRequestURL(url);

  checkNetworkPort(url.port);
}

function cancelBody(body: ReadableStream<Uint8Array> | null, reason?: unknown): void {
  if (body !== null) body.cancel(reason).catch(() => {});
}

function abortableDispatch(
  transport: FetchTransport,
  request: TransportRequest,
): Promise<TransportResponse> {
  return new Promise<TransportResponse>((resolve, reject) => {
    let complete = false;
    const unsubscribe = request.signal.subscribe(() => {
      if (!complete) {
        complete = true;
        reject(request.signal.reason);
      }
    });
    if (request.signal.aborted) {
      unsubscribe();
      return;
    }
    Promise.resolve()
      .then(() => transport.dispatch(request))
      .then(
        (response) => {
          unsubscribe();
          if (complete || request.signal.aborted) {
            cancelBody(response.body, request.signal.reason);
            reject(request.signal.reason);
            return;
          }
          complete = true;
          resolve(response);
        },
        (error) => {
          unsubscribe();
          if (complete) return;
          complete = true;
          reject(error);
        },
      );
  });
}

/** Keep abort attached after fetch resolves, until the returned body terminates. */
function abortableBody(
  source: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let dispose = (): void => {};
  let finished = false;
  const cleanup = (): void => {
    if (!finished) {
      finished = true;
      dispose();
    }
  };
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        dispose = signal.subscribe(() => {
          controller.error(signal.reason);
          cleanup();
          reader.cancel(signal.reason).catch(() => {});
        });
      },
      async pull(controller) {
        try {
          signal.throwIfAborted();
          const result = await reader.read();
          signal.throwIfAborted();
          if (result.done) {
            cleanup();
            reader.releaseLock();
            controller.close();
          } else controller.enqueue(result.value);
        } catch (error) {
          cleanup();
          reader.releaseLock();
          controller.error(error);
        }
      },
      async cancel(reason) {
        cleanup();
        try {
          await reader.cancel(reason);
        } finally {
          reader.releaseLock();
        }
      },
    },
    { highWaterMark: 0, size: (value) => value.length },
  );
}

export class FetchClient {
  private readonly transport: FetchTransport;
  private readonly cacheTransport: FetchTransport;
  private readonly context: RequestContext;
  private readonly decoder: ContentDecoder | undefined;
  private readonly maxRedirects: number;
  private readonly cookies: FetchCookiePolicy | undefined;
  private readonly cache: HttpCache | undefined;

  constructor(
    transport: FetchTransport,
    context: RequestContext,
    decoder?: ContentDecoder,
    maxRedirects = 20,
    cookies?: FetchCookiePolicy,
    cache?: HttpCache,
  ) {
    this.transport = transport;
    this.cacheTransport = { dispatch: (request) => abortableDispatch(transport, request) };
    this.context = context;
    this.decoder = decoder;
    this.maxRedirects = maxRedirects;
    this.cookies = cookies;
    this.cache = cache;
  }

  readonly fetch = async (input: string | Request, init: RequestInit = {}): Promise<Response> => {
    // Construction errors reject this async API; the constructor still throws synchronously.
    const request = new Request(input, init, this.context);
    request.signal.throwIfAborted();
    let url = request.parsedURL;
    const initialURL = url;
    const credentialsOrigin =
      this.context.origin === undefined
        ? initialURL.origin
        : this.context.urls.parse(this.context.origin).origin;
    let method = request.method;
    let body = request.getState();
    const headers = new Headers(request.headers);
    if (!headers.has("accept")) headers.set("accept", "*/*");
    // Identity is a deliberate baseline, not a silent dependency on host decompression.
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity");
    let count = 0;
    try {
      while (true) {
        if (url.protocol === "data:") {
          await Promise.resolve();
          request.signal.throwIfAborted();
          const data = processDataURL(url);
          if (data === null) throw new TypeError("Invalid data URL");
          const bodyStream =
            method === "HEAD" ? null : abortableBody(bytesStream(data.body), request.signal);
          const fragment = url.href.indexOf("#");
          return Response.fromTransport(
            200,
            "OK",
            [["content-type", data.mimeType]],
            bodyStream,
            fragment < 0 ? url.href : url.href.slice(0, fragment),
            false,
            this.context,
          );
        }
        if (url.protocol === "blob:") {
          await Promise.resolve();
          request.signal.throwIfAborted();
          if (method !== "GET" || request.blobURLObject === null) {
            throw new TypeError("Blob URL cannot be fetched");
          }
          const blobResponse = fetchBlob(request.blobURLObject, headers.get("range"));
          if (blobResponse === null) {
            throw new TypeError("Invalid Blob URL range");
          }
          const fragment = url.href.indexOf("#");
          return Response.fromTransport(
            blobResponse.status,
            blobResponse.statusText,
            blobResponse.headers,
            abortableBody(blobResponse.body.stream(), request.signal),
            fragment < 0 ? url.href : url.href.slice(0, fragment),
            false,
            this.context,
          );
        }
        checkURL(url);
        request.signal.throwIfAborted();
        const dispatchHeaders = new Headers(headers);
        const cookiePolicy = this.cookies;
        const cookiesAllowed =
          cookiePolicy !== undefined &&
          request.credentials !== "omit" &&
          (request.credentials === "include" || url.origin === credentialsOrigin);
        const cookieContext = cookiesAllowed
          ? cookiePolicy.contextFor(url, initialURL, method)
          : undefined;
        if (
          cookiePolicy !== undefined &&
          cookieContext !== undefined &&
          !dispatchHeaders.has("cookie")
        ) {
          const cookie = await cookiePolicy.jar.getCookieHeader(url, cookieContext);
          if (cookie.length > 0) dispatchHeaders.set("cookie", cookie);
        }
        const transportRequest: TransportRequest = {
          url,
          method,
          headers: dispatchHeaders.raw(),
          body: body.stream,
          bodyLength: body.length,
          signal: request.signal,
        };
        let cached: HttpCacheDispatchResult;
        if (this.cache === undefined) {
          const response = await abortableDispatch(this.transport, transportRequest);
          cached = { response, receivedHeaders: response.headers, cacheState: "network" };
        } else {
          cached = await this.cache.dispatch(this.cacheTransport, transportRequest, request.cache);
        }
        const raw = cached.response;
        let retained = false;
        try {
          request.signal.throwIfAborted();
          if (raw.status < 200 || raw.status > 599)
            throw new TypeError("Invalid final HTTP response status");
          const responseHeaders = new Headers(raw.headers);
          if (
            cookiePolicy !== undefined &&
            cookieContext !== undefined &&
            cached.receivedHeaders !== null
          ) {
            for (const value of new Headers(cached.receivedHeaders).getSetCookie()) {
              await cookiePolicy.jar.setCookie(value, url, cookieContext);
            }
          }
          const location = responseHeaders.get("location");
          if (isRedirectStatus(raw.status) && location !== null && request.redirect !== "manual") {
            if (request.redirect === "error")
              throw new TypeError("Redirect disallowed by request policy");
            if (count >= this.maxRedirects) throw new TypeError("Too many redirects");
            const next = this.context.urls.parse(location, url.href);
            checkURL(next);
            if (url.origin !== next.origin) {
              for (const name of ["authorization", "proxy-authorization", "cookie", "cookie2"])
                headers.delete(name);
            }
            const dropBody =
              ((raw.status === 301 || raw.status === 302) && method === "POST") ||
              (raw.status === 303 && method !== "GET" && method !== "HEAD");
            if (dropBody) {
              method = "GET";
              // Construct a null body without pulling or replaying a discarded stream.
              body = emptyBody(this.context);
              for (const name of [
                "content-encoding",
                "content-language",
                "content-location",
                "content-type",
                "content-length",
              ])
                headers.delete(name);
            } else body = body.replay();
            url = next;
            count++;
            continue;
          }
          let responseBody = raw.body;
          if (method === "HEAD" || nullBodyStatus(raw.status)) {
            cancelBody(responseBody);
            responseBody = null;
          }
          if (responseBody !== null) {
            const codingHeader = responseHeaders.get("content-encoding");
            if (codingHeader !== null) {
              const codings = codingHeader
                .split(",")
                .map((value) => trimHTTPTabOrSpace(value).toLowerCase())
                .filter((value) => value !== "identity");
              for (const coding of codings)
                if (this.decoder === undefined || !this.decoder.supports(coding))
                  throw new TypeError("Unsupported content coding: " + coding);
              for (let i = codings.length - 1; i >= 0; --i) {
                const coding = codings[i];
                if (coding !== undefined && this.decoder !== undefined)
                  responseBody = this.decoder.decode(coding, responseBody);
              }
            }
            responseBody = abortableBody(responseBody, request.signal);
          }
          const fragment = url.href.indexOf("#");
          const result = Response.fromTransport(
            raw.status,
            raw.statusText,
            raw.headers,
            responseBody,
            fragment < 0 ? url.href : url.href.slice(0, fragment),
            count > 0,
            this.context,
          );
          retained = true;
          return result;
        } finally {
          if (!retained) cancelBody(raw.body);
        }
      }
    } catch (error) {
      if (request.signal.aborted) throw request.signal.reason;
      throw networkError(error);
    }
  };
}

function emptyBody(context: RequestContext): BodyState {
  return BodyState.empty(context.bodyPolicy);
}
