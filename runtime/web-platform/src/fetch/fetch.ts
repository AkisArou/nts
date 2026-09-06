import { checkNetworkPort } from "../core/ports.ts";
import { AbortSignal } from "../core/abort.ts";
import { networkError } from "../core/errors.ts";
import { trimHTTPTabOrSpace } from "../core/ascii.ts";
import type { URLRecord } from "../provider/ports.ts";
import { ReadableStream } from "../streams/readable.ts";
import { Request, validateNetworkURL } from "./request.ts";
import type { RequestInit, RequestContext } from "./request.ts";
import { Response, nullBodyStatus } from "./response.ts";
import { Headers } from "./headers.ts";
import type {
  ContentDecoder,
  FetchTransport,
  TransportRequest,
  TransportResponse,
} from "./transport.ts";

const redirects = new Set([301, 302, 303, 307, 308]);

function checkURL(url: URLRecord): void {
  validateNetworkURL(url);

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
  private readonly context: RequestContext;
  private readonly decoder: ContentDecoder | undefined;
  private readonly maxRedirects: number;

  constructor(
    transport: FetchTransport,
    context: RequestContext,
    decoder?: ContentDecoder,
    maxRedirects = 20,
  ) {
    this.transport = transport;
    this.context = context;
    this.decoder = decoder;
    this.maxRedirects = maxRedirects;
  }
  readonly fetch = async (input: string | Request, init: RequestInit = {}): Promise<Response> => {
    // Construction errors reject this async API; the constructor still throws synchronously.
    const request = new Request(input, init, this.context);
    request.signal.throwIfAborted();
    let url = request.parsedURL;
    let method = request.method;
    let body = request.getState();
    const headers = new Headers(request.headers);
    if (!headers.has("accept")) headers.set("accept", "*/*");
    // Identity is a deliberate baseline, not a silent dependency on host decompression.
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity");
    let count = 0;
    try {
      while (true) {
        checkURL(url);
        request.signal.throwIfAborted();
        const raw = await abortableDispatch(this.transport, {
          url,
          method,
          headers: headers.raw(),
          body: body.stream,
          bodyLength: body.length,
          signal: request.signal,
        });
        let retained = false;
        try {
          request.signal.throwIfAborted();
          if (raw.status < 200 || raw.status > 599)
            throw new TypeError("Invalid final HTTP response status");
          const responseHeaders = new Headers(raw.headers);
          const location = responseHeaders.get("location");
          if (redirects.has(raw.status) && location !== null && request.redirect !== "manual") {
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
            this.context.bodyPolicy,
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
import { BodyState } from "./body.ts";

function emptyBody(context: RequestContext): BodyState {
  return BodyState.empty(context.bodyPolicy);
}
