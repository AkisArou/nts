import { AbortSignal } from "../core/abort.ts";
import type { HttpCache, HttpCacheDispatchResult } from "../cache/http-cache.ts";
import type { CookieAccessContext, CookieJar } from "../cookies/jar.ts";
import { trimHTTPTabOrSpace } from "../core/ascii.ts";
import { concatBytes } from "../core/encoding.ts";
import { networkError } from "../core/errors.ts";
import { checkNetworkPort } from "../core/network-port.ts";
import type { URLRecord } from "../provider/primitives.ts";
import { currentWebPlatformRuntime } from "../provider/environment.ts";
import { bytesStream, ReadableStream } from "../streams/readable.ts";
import { BodyState } from "./body.ts";
import { Headers, isToken } from "./headers.ts";
import { createInternalRequest, Request, validateRequestURL } from "./request.ts";
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
import { fileURLMethodAllowed, validateFileURL } from "./file-url.ts";
import { digestMatches, integrityAlgorithm, parseIntegrity } from "./integrity.ts";
import type { IntegrityEntry } from "./integrity.ts";
import { _createBlobFromExternalSource as createBlobFromExternalSource } from "../file/blob.ts";
import {
  decodeContentCodings,
  standardContentCodingPolicy,
  type ContentCodingPolicy,
} from "./content-coding.ts";
import { headersRawEntries } from "./headers.ts";
import { abortSignalSubscribe } from "../core/abort-brand.ts";

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
  return currentWebPlatformRuntime().fetch(input, init);
}

function checkURL(url: URLRecord): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Unsupported URL scheme");
  }
  validateRequestURL(url);

  checkNetworkPort(url.port);
}

/**
 * Reads a body into memory under the environment's consumption bound.
 *
 * Integrity forces materialization: a digest cannot be computed from a stream nobody
 * has read. The bound is the same one the body policy applies everywhere else, so
 * asking for integrity cannot quietly raise a memory limit the environment set.
 */
async function collectBody(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (body === null) return new Uint8Array(new ArrayBuffer(0));
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const item = await reader.read();
      if (item.done) return concatBytes(chunks, received);
      const value = item.value;
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("Response body chunks must be Uint8Array values");
      }
      received += value.length;
      if (received > maximumBytes) {
        throw new TypeError("The response exceeded this environment's consumption limit");
      }
      chunks.push(value);
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // The original failure stays observable.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
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
    const unsubscribe = request.signal[abortSignalSubscribe](() => {
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
        dispose = signal[abortSignalSubscribe](() => {
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
  private readonly contentCodingPolicy: ContentCodingPolicy;
  private readonly acceptEncoding: string;

  constructor(
    transport: FetchTransport,
    context: RequestContext,
    decoder?: ContentDecoder,
    maxRedirects = 20,
    cookies?: FetchCookiePolicy,
    cache?: HttpCache,
    contentCodingPolicy: ContentCodingPolicy = standardContentCodingPolicy,
  ) {
    this.transport = transport;
    this.cacheTransport = { dispatch: (request) => abortableDispatch(transport, request) };
    this.context = context;
    this.decoder = decoder;
    this.maxRedirects = maxRedirects;
    this.cookies = cookies;
    this.cache = cache;
    this.contentCodingPolicy = contentCodingPolicy;
    this.acceptEncoding = readAcceptEncoding(decoder);
  }

  /**
   * The integrity entries this request must satisfy, or null when it requires nothing.
   *
   * Metadata naming only algorithms this profile does not know places no requirement,
   * which the standard specifies and which is not the same as an unmet one. Anything
   * that does place a requirement and cannot be checked throws here, before a request
   * is sent: silently returning a body that was never verified is the one outcome a
   * caller who wrote integrity metadata cannot detect.
   */
  private resolveIntegrity(metadata: string): readonly IntegrityEntry[] | null {
    if (metadata === "") return null;
    const entries = parseIntegrity(metadata);
    if (entries.length === 0) return null;
    const provider = this.context.digest;
    if (provider === undefined) {
      throw new TypeError("Integrity was requested and this environment cannot verify it");
    }
    const algorithm = integrityAlgorithm(entries);
    if (!provider.algorithms.includes(algorithm)) {
      throw new TypeError("Integrity algorithm is not available: " + algorithm);
    }
    return entries;
  }

  /** Materializes the body, verifies it, and republishes the exact bytes checked. */
  private async verifyIntegrity(
    body: ReadableStream<Uint8Array> | null,
    entries: readonly IntegrityEntry[],
    request: Request,
  ): Promise<ReadableStream<Uint8Array>> {
    const provider = this.context.digest;
    if (provider === undefined) {
      throw new TypeError("Integrity was requested and this environment cannot verify it");
    }
    const bytes = await collectBody(body, this.context.bodyPolicy.maxConsumeBytes, request.signal);
    const digest = await provider.digest(integrityAlgorithm(entries), bytes);
    if (!digestMatches(digest, entries)) {
      throw new TypeError("The response did not match the requested integrity");
    }
    // The verified bytes are what the caller receives, not a second read of a source
    // that could answer differently.
    return bytesStream(bytes);
  }

  readonly fetch = async (input: string | Request, init: RequestInit = {}): Promise<Response> => {
    // Construction errors reject this async API; the constructor still throws synchronously.
    const request = createInternalRequest(input, init, this.context);
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
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", this.acceptEncoding);
    let count = 0;
    // Resolved before any request is made: a check that cannot be performed must stop
    // the request rather than let it complete unverified.
    const integrityEntries = this.resolveIntegrity(request.integrity);
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
        if (url.protocol === "file:") {
          await Promise.resolve();
          request.signal.throwIfAborted();
          const files = this.context.fileURLs;
          // Without a provider this is exactly an unsupported scheme, and says so in
          // the same words, so enabling local reads is never accidental.
          if (files === undefined) throw new TypeError("Unsupported URL scheme");
          if (!fileURLMethodAllowed(method)) {
            throw new TypeError("A file URL answers only GET and HEAD");
          }
          validateFileURL(url);
          const entry = await files.open(url, request.signal);
          const fileBlob = createBlobFromExternalSource(entry.source, entry.type);
          const fileResponse = fetchBlob(fileBlob, headers.get("range"));
          if (fileResponse === null) throw new TypeError("Invalid file URL range");
          const fragment = url.href.indexOf("#");
          return Response.fromTransport(
            fileResponse.status,
            fileResponse.statusText,
            fileResponse.headers,
            method === "HEAD" ? null : abortableBody(fileResponse.body.stream(), request.signal),
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
          headers: dispatchHeaders[headersRawEntries](),
          body: body.stream,
          bodyLength: body.length,
          replayBody: body.transportBodySource(),
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
              if (codings.length > 0 && this.decoder !== undefined) {
                responseBody = decodeContentCodings(
                  responseBody,
                  codings,
                  this.decoder,
                  this.contentCodingPolicy,
                );
              }
            }
            responseBody = abortableBody(responseBody, request.signal);
          }
          if (integrityEntries !== null) {
            // The standard checks integrity against the decoded body, so this runs
            // after content codings and forces the response to be materialized: a
            // digest cannot be computed from a stream nobody has read.
            responseBody = await this.verifyIntegrity(responseBody, integrityEntries, request);
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

function readAcceptEncoding(decoder: ContentDecoder | undefined): string {
  if (decoder === undefined || decoder.codings.length === 0) return "identity";
  const seen: string[] = [];
  for (const coding of decoder.codings) {
    if (!isToken(coding) || coding !== coding.toLowerCase() || coding === "identity") {
      throw new TypeError("Invalid advertised content coding: " + coding);
    }
    if (!decoder.supports(coding)) {
      throw new TypeError("Content decoder advertises an unsupported coding: " + coding);
    }
    if (!seen.includes(coding)) seen.push(coding);
  }
  return seen.join(", ");
}
