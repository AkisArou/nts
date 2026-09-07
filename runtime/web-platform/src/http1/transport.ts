import { Headers } from "../fetch/headers.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import type { FetchTransport, TransportRequest, TransportResponse } from "../fetch/transport.ts";
import { nullBodyStatus } from "../fetch/response.ts";
import { ReadableStream } from "../streams/readable.ts";
import type { ReadableStreamDefaultReader } from "../streams/readable.ts";
import { encodeByteString } from "../core/encoding.ts";
import { ProtocolError, LimitError, DOMException } from "../core/errors.ts";
import { ignoreRejection } from "../core/promise.ts";
import type {
  ByteConnection,
  CancelHandle,
  ConnectAddress,
  Scheduler,
  SocketConnector,
} from "../provider/primitives.ts";
import { addressOf } from "../http/address.ts";
import { contentLength, hasToken } from "../http/fields.ts";
import { writeAll } from "./io.ts";
import {
  parseChunkSize,
  readHead,
  readHeaderFields,
  responseFraming,
  validateWireValue,
  defaultHeadLimits,
} from "./parser.ts";
import type { HeadLimits } from "./parser.ts";
import { ConnectionPool } from "./pool.ts";
import type { PoolOptions } from "./pool.ts";

export interface Http1Options extends PoolOptions {
  connectTimeoutMs?: number;
  headersTimeoutMs?: number;
  bodyReadTimeoutMs?: number;
  maxHeaderBytes?: number;
  maxHeaders?: number;
  maxInformational?: number;
}

/** A provider-neutral HTTP/1 route selected for one dispatch. */
export interface Http1DispatchRoute {
  /** Physical endpoint and TLS identity passed to the socket provider. */
  readonly address: ConnectAddress;
  /** Origin-form for direct/tunneled requests, absolute-form for a forward proxy. */
  readonly requestTarget: string;
  /** Transport-owned fields that cannot be supplied through Fetch request headers. */
  readonly headers?: readonly HeaderEntry[];
}

function isForbiddenTrailerName(name: string): boolean {
  return name === "content-length" || name === "host" || name === "transfer-encoding";
}

function isRouteManagedHeader(name: string): boolean {
  return (
    name === "host" ||
    name === "connection" ||
    name === "content-length" ||
    name === "transfer-encoding" ||
    name === "upgrade" ||
    name === "trailer" ||
    name === "te" ||
    name === "keep-alive" ||
    name === "proxy-connection" ||
    name === "expect"
  );
}

function requestHead(
  request: TransportRequest,
  route: Http1DispatchRoute,
): { bytes: Uint8Array; chunked: boolean } {
  const headers = new Headers(request.headers);

  for (const name of [
    "host",
    "connection",
    "transfer-encoding",
    "upgrade",
    "trailer",
    "te",
    "keep-alive",
    "proxy-connection",
    "proxy-authorization",
    "expect",
  ]) {
    if (headers.has(name)) throw new TypeError("Transport-managed request header: " + name);
  }
  const declared = contentLength(headers);

  if (declared !== null && (request.bodyLength === null || declared !== request.bodyLength))
    throw new TypeError("Content-Length does not match body length");

  headers.delete("content-length");

  headers.set("host", request.url.host);
  for (const [name, value] of route.headers ?? []) {
    if (isRouteManagedHeader(name.toLowerCase())) {
      throw new TypeError("HTTP route cannot replace framing header: " + name.toLowerCase());
    }
    headers.set(name, value);
  }
  const chunked = request.body !== null && request.bodyLength === null;

  if (chunked) headers.set("transfer-encoding", "chunked");
  else if (
    request.bodyLength !== null &&
    (request.body !== null ||
      request.method === "POST" ||
      request.method === "PUT" ||
      request.method === "PATCH")
  ) {
    headers.set("content-length", String(request.bodyLength));
  }
  const target = route.requestTarget;

  if (/[^\x21-\x7e]/.test(target))
    throw new TypeError("URL parser produced an invalid HTTP request target");
  let head = request.method + " " + (target || "/") + " HTTP/1.1\r\n";

  for (const [name, value] of headers.raw()) {
    validateWireValue(value);
    head += name + ": " + value + "\r\n";
  }
  return { bytes: encodeByteString(head + "\r\n"), chunked };
}
async function upload(
  connection: ByteConnection,
  reader: ReadableStreamDefaultReader<Uint8Array> | null,
  length: number | null,
  chunked: boolean,
): Promise<void> {
  if (reader === null) return;
  let sent = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (result.value.length === 0) continue;
      sent += result.value.length;
      if (length !== null && sent > length)
        throw new ProtocolError("Request body exceeds Content-Length");
      if (chunked)
        await writeAll(connection, encodeByteString(result.value.length.toString(16) + "\r\n"));
      await writeAll(connection, result.value);
      if (chunked) await writeAll(connection, encodeByteString("\r\n"));
    }
    if (length !== null && sent !== length)
      throw new ProtocolError("Request body is shorter than Content-Length");
    if (chunked) await writeAll(connection, encodeByteString("0\r\n\r\n"));
  } finally {
    reader.releaseLock();
  }
}

export class Http1Transport implements FetchTransport {
  readonly pool: ConnectionPool;
  private readonly scheduler: Scheduler;
  private readonly connectTimeout: number;
  private readonly headersTimeout: number;
  private readonly readTimeout: number;
  private readonly limits: HeadLimits;

  constructor(connector: SocketConnector, scheduler: Scheduler, options: Http1Options = {}) {
    this.pool = new ConnectionPool(connector, scheduler, options);
    this.scheduler = scheduler;
    this.connectTimeout = options.connectTimeoutMs ?? 30000;
    this.headersTimeout = options.headersTimeoutMs ?? 30000;
    this.readTimeout = options.bodyReadTimeoutMs ?? 30000;
    this.limits = {
      maxHeaderBytes: options.maxHeaderBytes ?? defaultHeadLimits.maxHeaderBytes,
      maxHeaders: options.maxHeaders ?? defaultHeadLimits.maxHeaders,
      maxInformational: options.maxInformational ?? defaultHeadLimits.maxInformational,
    };
    for (const value of [this.headersTimeout, this.readTimeout])
      if (!Number.isFinite(value) || value < 0) throw new RangeError("Invalid HTTP timeout");
    if (!Number.isFinite(this.connectTimeout) || this.connectTimeout <= 0)
      throw new RangeError("Invalid connect timeout");
    for (const value of [
      this.limits.maxHeaderBytes,
      this.limits.maxHeaders,
      this.limits.maxInformational,
    ]) {
      if (!Number.isSafeInteger(value) || value < 1)
        throw new RangeError("Invalid HTTP parser limit");
    }
  }
  async dispatch(request: TransportRequest): Promise<TransportResponse> {
    return this.dispatchRouted(request, {
      address: addressOf(request.url, this.connectTimeout, ["http/1.1"]),
      requestTarget: request.url.pathname + request.url.search || "/",
    });
  }

  /** @internal Dispatch using a route selected by a shared proxy/connection policy. */
  async dispatchRouted(
    request: TransportRequest,
    route: Http1DispatchRoute,
  ): Promise<TransportResponse> {
    request.signal.throwIfAborted();
    const serialized = requestHead(request, route);
    if (serialized.bytes.length > this.limits.maxHeaderBytes)
      throw new LimitError("Request headers exceed configured limit");
    const lease = await this.pool.acquire(route.address, request.signal);
    let uploadReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let uploadDone = request.body === null;
    let failure: unknown;
    let hasFailure = false;
    let finalized = false;
    const timer: { current: CancelHandle | null } = { current: null };
    let dispose = (): void => {};
    const fail = (reason: unknown): void => {
      if (hasFailure) return;
      hasFailure = true;
      failure = reason;
      lease.connection.close();
      uploadReader?.cancel(reason).catch(() => {});
    };
    const finish = (reuse: boolean): void => {
      if (finalized) return;
      finalized = true;
      timer.current?.cancel();
      dispose();
      if (!uploadDone)
        uploadReader
          ?.cancel(new TypeError("HTTP response completed before upload"))
          .catch(() => {});
      lease.release(reuse && uploadDone && !hasFailure);
    };
    const startTimeout = (milliseconds: number): void => {
      timer.current?.cancel();
      timer.current =
        milliseconds > 0
          ? this.scheduler.delay(milliseconds, () =>
              fail(new DOMException("HTTP I/O timed out", "TimeoutError")),
            )
          : null;
    };
    try {
      dispose = request.signal.subscribe(() => fail(request.signal.reason));
      request.signal.throwIfAborted();
      startTimeout(this.headersTimeout);
      await writeAll(lease.connection, serialized.bytes);
      uploadReader = request.body?.getReader() ?? null;
      upload(lease.connection, uploadReader, request.bodyLength, serialized.chunked).then(() => {
        uploadDone = true;
      }, fail);
      let head = await readHead(lease.reader, this.limits);
      let informational = 0;
      while (head.status < 200 && head.status !== 101) {
        if (++informational > this.limits.maxInformational)
          throw new LimitError("Too many informational HTTP responses");
        this.publishInformational(request, head.status, head.headers);
        head = await readHead(lease.reader, this.limits);
      }
      timer.current?.cancel();
      timer.current = null;
      if (hasFailure) throw failure;
      if (head.status === 101) throw new ProtocolError("Unexpected HTTP upgrade in Fetch");
      const headers = new Headers(head.headers);
      const reusable =
        !hasToken(headers, "connection", "close") &&
        (head.version === "1.1" || hasToken(headers, "connection", "keep-alive"));
      if (request.method === "HEAD" || nullBodyStatus(head.status)) {
        finish(reusable);
        return {
          status: head.status,
          statusText: head.statusText,
          headers: head.headers,
          body: null,
          trailers: Promise.resolve([]),
        };
      }
      const framing = responseFraming(headers);
      let remaining = framing.length;
      let needsChunkEnd = false;
      // Trailers were parsed, validated and discarded. Every consumer of
      // `TransportResponse.trailers` handled a field no real transport produced, so
      // only the mock ever exercised them. This settles it on every ending: the parsed
      // fields for a chunked body, nothing for a framing that cannot carry them, and
      // the body's own failure when the body fails.
      const trailerResult = Promise.withResolvers<readonly HeaderEntry[]>();
      // Nobody is obliged to await trailers, and a rejection nobody observes must not
      // escape as an unhandled one.
      ignoreRejection(trailerResult.promise);
      const source = new ReadableStream<Uint8Array>(
        {
          pull: async (controller) => {
            try {
              if (hasFailure) throw failure;
              startTimeout(this.readTimeout);
              if (framing.kind === "chunked" && remaining === 0) {
                if (needsChunkEnd && (await lease.reader.line(2)) !== "")
                  throw new ProtocolError("Missing chunk terminator");
                const line = await lease.reader.line(this.limits.maxHeaderBytes);
                remaining = parseChunkSize(line);
                if (remaining === 0) {
                  const trailers = await readHeaderFields(lease.reader, this.limits);
                  for (const [name] of trailers)
                    if (isForbiddenTrailerName(name))
                      throw new ProtocolError("Forbidden framing trailer");
                  finish(reusable);
                  trailerResult.resolve(trailers);
                  controller.close();
                  return;
                }
                needsChunkEnd = true;
              }
              if (framing.kind === "fixed" && remaining === 0) {
                finish(reusable);
                controller.close();
                return;
              }
              const data = await lease.reader.some(
                framing.kind === "eof" ? 65536 : Math.min(65536, remaining),
              );
              timer.current?.cancel();
              timer.current = null;
              if (hasFailure) throw failure;
              if (data === null) {
                if (framing.kind !== "eof") throw new ProtocolError("Truncated HTTP response body");
                finish(false);
                // An EOF-framed body carries no trailer section by construction.
                trailerResult.resolve([]);
                controller.close();
                return;
              }
              if (framing.kind !== "eof") remaining -= data.length;
              controller.enqueue(data);
              if (framing.kind === "fixed" && remaining === 0) {
                finish(reusable);
                trailerResult.resolve([]);
                controller.close();
              }
            } catch (error) {
              finish(false);
              const reason = hasFailure ? failure : error;
              // A caller awaiting trailers learns the body failed rather than waiting
              // for a section that is never going to arrive.
              trailerResult.reject(reason);
              controller.error(reason);
            }
          },
          cancel: (reason) => {
            finish(false);
            trailerResult.reject(
              reason ?? new DOMException("The response body was cancelled", "AbortError"),
            );
          },
        },
        { highWaterMark: 0, size: (data) => data.length },
      );
      return {
        status: head.status,
        statusText: head.statusText,
        headers: head.headers,
        body: source,
        trailers: trailerResult.promise,
      };
    } catch (error) {
      finish(false);
      throw hasFailure ? failure : error;
    }
  }

  /**
   * Hands an interim response to the caller without letting it affect the request.
   *
   * The fields are copied. That is defensive rather than demonstrable: an interim head
   * is discarded the moment it has been published, so handing over the live array
   * passes every test here — the copy exists so that a later change which does retain
   * one cannot quietly hand a caller something it can edit. An exception goes to the
   * scheduler for the same reason a diagnostics failure does: observing a request is
   * not permission to fail it.
   */
  private publishInformational(
    request: TransportRequest,
    status: number,
    headers: readonly HeaderEntry[],
  ): void {
    const observer = request.onInformational;
    if (observer === undefined) return;
    const copied: HeaderEntry[] = [];
    for (const [name, value] of headers) copied.push([name, value]);
    try {
      observer({ status, headers: copied });
    } catch (error) {
      this.scheduler.reportError(error);
    }
  }

  close(): void {
    this.pool.close();
  }

  drain(): Promise<void> {
    return this.pool.drain();
  }
}
