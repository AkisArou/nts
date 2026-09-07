import { AbortController, AbortSignal } from "../core/abort.ts";
import { DOMException, LimitError } from "../core/errors.ts";
import { ignoreRejection } from "../core/promise.ts";
import { Headers } from "../fetch/headers.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import { nullBodyStatus } from "../fetch/response.ts";
import type { FetchTransport, TransportRequest, TransportResponse } from "../fetch/transport.ts";
import { addressOf } from "../http/address.ts";
import { certificateCovers } from "../http/certificate.ts";
import { contentLength } from "../http/fields.ts";
import type {
  CancelHandle,
  ConnectAddress,
  Scheduler,
  SocketConnector,
} from "../provider/primitives.ts";
import { connectNegotiated } from "../provider/primitives.ts";
import { ReadableStream } from "../streams/readable.ts";
import type { ReadResult } from "../streams/readable.ts";
import { HTTP2_REFUSED_STREAM, Http2WireError } from "./frame.ts";
import { Http2ClientConnection } from "./connection.ts";
import type { Http2ClientResponse, Http2ConnectionOptions } from "./connection.ts";
import type { HpackHeaderField } from "./hpack.ts";

export interface Http2TransportOptions {
  connectTimeoutMs?: number;
  headersTimeoutMs?: number;
  bodyReadTimeoutMs?: number;
  maxConnections?: number;
  connection?: Http2ConnectionOptions;
  /**
   * Reuse one connection for a second origin the peer's certificate covers.
   *
   * Off by default. Coalescing changes where a request is routed, so it is a policy
   * decision rather than an optimisation the transport may take on its own, and it
   * only ever applies under the conditions in {@link Http2ConnectionRecord}.
   *
   * It also requires {@link Http2TransportOptions.knownEndpoint}. Deciding to reuse a
   * connection happens before connecting, while the endpoint an origin resolves to is
   * chosen by the DNS policy that sits *below* this transport in the connector chain.
   * Without a way to ask what is already known, this transport cannot tell whether a
   * second origin even reaches the same peer.
   */
  coalesceConnections?: boolean;

  /**
   * The endpoint this address is already known to reach, or undefined.
   *
   * Deliberately synchronous and deliberately allowed to answer "I do not know": it is
   * a probe of what the DNS policy has already resolved, not a resolution. Coalescing
   * must not perform network work in order to decide how to pool, and an unknown
   * endpoint simply means the connection is opened normally.
   */
  knownEndpoint?: (address: ConnectAddress) => string | undefined;
}

/**
 * What a live connection is allowed to be reused for.
 *
 * `certificateNames` is empty for cleartext, which therefore never coalesces --
 * there is nothing attesting that the peer speaks for another origin.
 * `resolvedAddress` is the endpoint the shared DNS policy selected; when it is
 * unknown the connection does not coalesce either, because certificate coverage
 * alone would let a name the certificate happens to include be routed to a server
 * that does not host it.
 */
interface Http2ConnectionRecord {
  readonly secure: boolean;
  readonly certificateNames: readonly string[];
  readonly resolvedAddress: string | undefined;
  /** The connection reaches one port; an origin on another port is a different peer. */
  readonly port: number;
}

function originKey(request: TransportRequest): string {
  return request.url.protocol + "//" + request.url.host;
}

function canReplayAfterRefusal(request: TransportRequest): boolean {
  return request.body === null;
}

function requestFields(request: TransportRequest): HpackHeaderField[] {
  const headers = new Headers(request.headers);
  for (const name of [
    "host",
    "connection",
    "transfer-encoding",
    "upgrade",
    "trailer",
    "keep-alive",
    "proxy-connection",
    "expect",
  ]) {
    if (headers.has(name)) throw new TypeError("Transport-managed request header: " + name);
  }
  const declared = contentLength(headers);
  if (declared !== null && (request.bodyLength === null || declared !== request.bodyLength)) {
    throw new TypeError("Content-Length does not match body length");
  }
  headers.delete("content-length");
  if (
    request.bodyLength !== null &&
    (request.body !== null ||
      request.method === "POST" ||
      request.method === "PUT" ||
      request.method === "PATCH")
  ) {
    headers.set("content-length", String(request.bodyLength));
  }

  const path = request.url.pathname + request.url.search;
  const fields: HpackHeaderField[] = [
    { name: ":method", value: request.method },
    { name: ":scheme", value: request.url.protocol.slice(0, -1) },
    { name: ":authority", value: request.url.host },
    { name: ":path", value: path === "" ? "/" : path },
  ];
  for (const [name, value] of headers.raw()) fields.push({ name, value });
  return fields;
}

function responseFields(response: Http2ClientResponse): HeaderEntry[] {
  const result: HeaderEntry[] = [];
  for (const field of response.headers) result.push([field.name, field.value]);
  return result;
}

async function consumeHiddenBody(body: ReadableStream<Uint8Array>): Promise<void> {
  const reader = body.getReader();
  try {
    while (!(await reader.read()).done) {
      // A HEAD or null-body status rejects before delivering nonempty DATA.
    }
  } finally {
    reader.releaseLock();
  }
}

function withReadTimeout(
  source: ReadableStream<Uint8Array>,
  scheduler: Scheduler,
  milliseconds: number,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    reader.releaseLock();
  };
  return new ReadableStream<Uint8Array>(
    {
      pull: async (controller) => {
        const result = Promise.withResolvers<ReadResult<Uint8Array>>();
        const timer = scheduler.delay(milliseconds, () => {
          const reason = new DOMException("HTTP/2 response body timed out", "TimeoutError");
          result.reject(reason);
          ignoreRejection(reader.cancel(reason));
        });
        reader.read().then(result.resolve, result.reject);
        try {
          const item = await result.promise;
          if (item.done) {
            release();
            controller.close();
          } else {
            controller.enqueue(item.value);
          }
        } finally {
          timer.cancel();
        }
      },
      cancel: async (reason) => {
        try {
          await reader.cancel(reason);
        } finally {
          release();
        }
      },
    },
    { highWaterMark: 0 },
  );
}

/**
 * HTTP/2-prior-knowledge Fetch transport.
 *
 * Protocol negotiation belongs to the dispatcher above this class. The supplied
 * connector must therefore return an h2 connection (ALPN-selected for TLS or an
 * explicitly configured h2c endpoint for cleartext).
 */
export class Http2Transport implements FetchTransport {
  private readonly connector: SocketConnector;
  private readonly scheduler: Scheduler;
  private readonly connectTimeoutMs: number;
  private readonly headersTimeoutMs: number;
  private readonly bodyReadTimeoutMs: number;
  private readonly maxConnections: number;
  private readonly connectionOptions: Http2ConnectionOptions;
  private readonly current = new Map<string, Http2ClientConnection>();
  private readonly all = new Set<Http2ClientConnection>();
  private readonly records = new Map<Http2ClientConnection, Http2ConnectionRecord>();
  private readonly coalescing: boolean;
  private readonly knownEndpoint: ((address: ConnectAddress) => string | undefined) | undefined;
  private readonly opening = new Map<string, Promise<Http2ClientConnection>>();
  private readonly openingCancellation = new Map<string, AbortController>();
  private readonly openingEstablished = new Set<string>();
  private accepting = true;
  private destroyed = false;
  private drainResult: Promise<void> | null = null;

  constructor(
    connector: SocketConnector,
    scheduler: Scheduler,
    options: Http2TransportOptions = {},
  ) {
    this.connector = connector;
    this.scheduler = scheduler;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 30000;
    this.headersTimeoutMs = options.headersTimeoutMs ?? 30000;
    this.bodyReadTimeoutMs = options.bodyReadTimeoutMs ?? 30000;
    this.maxConnections = options.maxConnections ?? 64;
    this.connectionOptions = options.connection ?? {};
    this.knownEndpoint = options.knownEndpoint;
    this.coalescing = options.coalesceConnections === true && this.knownEndpoint !== undefined;
    if (!Number.isFinite(this.connectTimeoutMs) || this.connectTimeoutMs <= 0) {
      throw new RangeError("Invalid HTTP/2 connect timeout");
    }
    for (const timeout of [this.headersTimeoutMs, this.bodyReadTimeoutMs]) {
      if (!Number.isFinite(timeout) || timeout < 0) {
        throw new RangeError("Invalid HTTP/2 I/O timeout");
      }
    }
    if (!Number.isSafeInteger(this.maxConnections) || this.maxConnections < 1) {
      throw new RangeError("Invalid HTTP/2 connection limit");
    }
  }

  async dispatch(request: TransportRequest): Promise<TransportResponse> {
    if (!this.accepting) throw new TypeError("HTTP/2 transport is closed");
    request.signal.throwIfAborted();
    const fields = requestFields(request);
    let retried = false;
    while (true) {
      const key = originKey(request);
      const connection = await this.acquire(key, request);
      let timer: CancelHandle | null = null;
      let signal = request.signal;
      if (this.headersTimeoutMs > 0) {
        const timeout = new AbortController();
        timer = this.scheduler.delay(this.headersTimeoutMs, () => {
          timeout.abort(new DOMException("HTTP/2 response headers timed out", "TimeoutError"));
        });
        signal = AbortSignal.any([request.signal, timeout.signal]);
      }
      try {
        const response = await connection.request({
          headers: fields,
          body: request.body,
          signal,
        });
        timer?.cancel();
        const bodyForbidden = request.method === "HEAD" || nullBodyStatus(response.status);
        const body =
          this.bodyReadTimeoutMs === 0
            ? response.body
            : withReadTimeout(response.body, this.scheduler, this.bodyReadTimeoutMs);
        if (bodyForbidden) ignoreRejection(consumeHiddenBody(body));
        return {
          status: response.status,
          statusText: "",
          headers: responseFields(response),
          body: bodyForbidden ? null : body,
        };
      } catch (error) {
        timer?.cancel();
        if (request.signal.aborted) throw request.signal.reason;
        if (
          !retried &&
          canReplayAfterRefusal(request) &&
          error instanceof Http2WireError &&
          error.errorCode === HTTP2_REFUSED_STREAM
        ) {
          retried = true;
          if (connection.isDraining && this.current.get(key) === connection) {
            this.current.delete(key);
          }
          continue;
        }
        throw error;
      }
    }
  }

  close(): void {
    if (this.destroyed) return;
    this.accepting = false;
    this.destroyed = true;
    const reason = new TypeError("HTTP/2 transport is closed");
    for (const cancellation of this.openingCancellation.values()) cancellation.abort(reason);
    this.openingCancellation.clear();
    this.opening.clear();
    this.openingEstablished.clear();
    this.current.clear();
    for (const connection of this.all) connection.close(reason);
    this.all.clear();
  }

  async drain(): Promise<void> {
    if (this.drainResult !== null) return this.drainResult;
    if (this.destroyed) return;
    this.accepting = false;
    this.drainResult = this.finishDrain();
    return this.drainResult;
  }

  private async finishDrain(): Promise<void> {
    const reason = new TypeError("HTTP/2 transport is draining");
    // Capture the in-flight opens before dropping them. Cancelling an open does not
    // end the provider work it started: a connector may observe the abort and keep a
    // socket attempt outstanding well afterwards. A drain that forgot these would
    // report completion while that work was still running.
    const outstanding = [...this.opening.values()];
    for (const cancellation of this.openingCancellation.values()) cancellation.abort(reason);
    this.openingCancellation.clear();
    this.opening.clear();
    this.openingEstablished.clear();
    this.current.clear();
    // Settlement, not success: a cancelled open ends as a rejection, and that is the
    // normal ending here rather than a failure of the drain.
    await Promise.all(
      outstanding.map((open) =>
        open.then(
          () => {},
          () => {},
        ),
      ),
    );
    const draining: Promise<void>[] = [];
    for (const connection of this.all) draining.push(connection.drain());
    await Promise.all(draining);
    this.all.clear();
  }

  get stats(): { connections: number; connecting: number; origins: number; streams: number } {
    let streams = 0;
    for (const connection of this.all) streams += connection.activeStreamCount;
    return {
      connections: this.all.size,
      connecting: this.opening.size,
      origins: this.current.size,
      streams,
    };
  }

  private async acquire(key: string, request: TransportRequest): Promise<Http2ClientConnection> {
    if (!this.accepting) throw new TypeError("HTTP/2 transport is closed");
    const current = this.current.get(key);
    if (current !== undefined && !current.isDraining) return current;
    if (current !== undefined) this.current.delete(key);

    const existing = this.opening.get(key);
    if (existing !== undefined) return this.awaitWithAbort(existing, request.signal);
    const coalesced = this.coalesce(key, request);
    if (coalesced !== null) return coalesced;
    this.reserveConnectionCapacity();
    const cancellation = new AbortController();
    this.openingCancellation.set(key, cancellation);
    const opening = this.open(key, request, cancellation);
    this.opening.set(key, opening);
    ignoreRejection(opening);
    return this.awaitWithAbort(opening, request.signal);
  }

  /**
   * A live connection this request may be sent over, or null.
   *
   * Every condition here is necessary. The connection must be TLS, because cleartext
   * presents nothing attesting to a second origin. The certificate must actually cover
   * the requested host. Both endpoints must be known and identical, because a
   * certificate that happens to include a name says nothing about which server hosts
   * it. And the connection must still be usable.
   */
  private coalesce(key: string, request: TransportRequest): Http2ClientConnection | null {
    if (!this.coalescing) return null;
    if (request.url.protocol !== "https:") return null;
    const probe = this.knownEndpoint;
    if (probe === undefined) return null;
    const address = addressOf(request.url, this.connectTimeoutMs, ["h2"]);
    const endpoint = probe(address);
    if (endpoint === undefined) return null;
    for (const connection of this.all) {
      if (connection.isDraining) continue;
      const record = this.records.get(connection);
      if (record === undefined || !record.secure) continue;
      if (record.resolvedAddress === undefined) continue;
      if (record.resolvedAddress !== endpoint) continue;
      if (record.port !== address.port) continue;
      if (!certificateCovers(record.certificateNames, address.hostname)) continue;
      this.current.set(key, connection);
      const coalesced = connection;
      coalesced.closed.then(() => this.removeConnection(key, coalesced));
      return connection;
    }
    return null;
  }

  private async open(
    key: string,
    request: TransportRequest,
    cancellation: AbortController,
  ): Promise<Http2ClientConnection> {
    let connection: Http2ClientConnection | null = null;
    try {
      const address = addressOf(request.url, this.connectTimeoutMs, ["h2"]);
      const negotiated = await connectNegotiated(this.connector, address, cancellation.signal);
      const bytes = negotiated.connection;
      if (!this.accepting) {
        bytes.close();
        throw new TypeError("HTTP/2 transport is closed");
      }
      connection = new Http2ClientConnection(bytes, this.connectionOptions);
      this.all.add(connection);
      this.records.set(connection, {
        secure: address.secure,
        certificateNames: negotiated.certificateNames,
        // The connector chain below chooses the endpoint, so what this transport knows
        // is what the same probe reports for the address it asked for.
        resolvedAddress: address.resolvedAddress ?? this.knownEndpoint?.(address),
        port: address.port,
      });
      this.openingEstablished.add(key);
      await connection.start();
      await connection.ready;
      if (!this.accepting) {
        connection.close(new TypeError("HTTP/2 transport is closed"));
        throw new TypeError("HTTP/2 transport is closed");
      }
      this.current.set(key, connection);
      const opened = connection;
      opened.closed.then(() => this.removeConnection(key, opened));
      return connection;
    } catch (error) {
      if (connection !== null) {
        connection.close(error);
        this.all.delete(connection);
      }
      throw error;
    } finally {
      this.openingEstablished.delete(key);
      if (this.openingCancellation.get(key) === cancellation) {
        this.openingCancellation.delete(key);
        this.opening.delete(key);
      }
    }
  }

  private removeConnection(key: string, connection: Http2ClientConnection): void {
    this.all.delete(connection);
    this.records.delete(connection);
    if (this.current.get(key) === connection) this.current.delete(key);
  }

  private reserveConnectionCapacity(): void {
    if (this.connectionCount() < this.maxConnections) return;
    for (const connection of this.all) {
      if (connection.activeStreamCount !== 0) continue;
      for (const [key, current] of this.current) {
        if (current === connection) this.current.delete(key);
      }
      this.all.delete(connection);
      connection.close(new TypeError("Idle HTTP/2 connection evicted"));
      break;
    }
    if (this.connectionCount() >= this.maxConnections) {
      throw new LimitError("HTTP/2 connection pool is full");
    }
  }

  private connectionCount(): number {
    return this.all.size + this.opening.size - this.openingEstablished.size;
  }

  private async awaitWithAbort(
    promise: Promise<Http2ClientConnection>,
    signal: AbortSignal,
  ): Promise<Http2ClientConnection> {
    signal.throwIfAborted();
    const result = Promise.withResolvers<Http2ClientConnection>();
    const dispose = signal.subscribe(() => result.reject(signal.reason));
    promise.then(result.resolve, result.reject);
    try {
      return await result.promise;
    } finally {
      dispose();
    }
  }
}
