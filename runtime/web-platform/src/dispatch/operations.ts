import { ignoreRejection } from "../core/promise.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import type { ByteConnection } from "../provider/primitives.ts";
import type {
  FetchTransport,
  TransportRequest,
  TransportResponse,
} from "../fetch/transport.ts";
import { ReadableStream } from "../streams/readable.ts";
import type { WritableStream } from "../streams/writable.ts";
import { collectResponseBody, settleResponseTrailers } from "./response-body.ts";

/**
 * What every operation reports before the body is dealt with.
 *
 * A status that a caller would treat as a failure is still a result here. Deciding what
 * a 404 means belongs to the caller; a dispatcher that threw on it would make the body
 * unreachable for the callers who want to read it.
 */
export interface DispatchInfo {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly HeaderEntry[];
}

export interface BufferedResult extends DispatchInfo {
  readonly body: Uint8Array;
  /** Absent when the provider cannot expose trailers, which is not the same as none. */
  readonly trailers: readonly HeaderEntry[] | undefined;
}

export interface StreamedResult extends DispatchInfo {
  readonly trailers: readonly HeaderEntry[] | undefined;
}

export interface TunnelEstablished extends DispatchInfo {
  readonly tunnelled: true;
  /** The caller owns it: it has left its pool and nothing else will close it. */
  readonly connection: ByteConnection;
}

export interface TunnelDeclined {
  readonly tunnelled: false;
  /** An ordinary response, body included -- usually the explanation. */
  readonly response: TransportResponse;
}

export type TunnelOutcome = TunnelEstablished | TunnelDeclined;

export interface BufferedOptions {
  /** Required, and validated. A default here would be a size limit nobody chose. */
  readonly maxBytes: number;
}

/** Receives the response head and returns where the body should go. */
export type StreamFactory = (info: DispatchInfo) => WritableStream<Uint8Array>;

/** Receives the response and returns the stream the caller will read. */
export type PipelineHandler = (
  info: DispatchInfo,
  body: ReadableStream<Uint8Array> | null,
) => ReadableStream<Uint8Array>;

function infoOf(response: TransportResponse): DispatchInfo {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  };
}

async function discard(response: TransportResponse, reason: unknown): Promise<void> {
  if (response.body !== null) {
    try {
      await response.body.cancel(reason);
    } catch {
      // The original failure stays the observable one.
    }
  }
  if (response.trailers !== undefined) ignoreRejection(response.trailers);
}

/**
 * The Undici-shaped operations, over any transport that can dispatch.
 *
 * These are methods rather than exported functions because `request`, `stream` and
 * `pipeline` are the names the shape is known by, and three exports with those names in
 * a shared module namespace would be indefensible — quite apart from what a backend that
 * resolves collisions by qualifying both would make of them.
 *
 * **This is not a claim of Undici parity.** The plan separates the architecture and
 * behaviour, which are required, from package-level `import "undici"` compatibility,
 * which is a facade decision; and no Undici revision is pinned in this repository, so
 * an API ledger with evidence per export cannot honestly be written. What is written
 * down here is what these operations do, tested — not what somebody else's do.
 *
 * `connect` and `upgrade` need a transport that can surrender its connection, which is
 * what `TransportRequest.acceptTunnel` and `TransportResponse.connection` are for. A
 * transport that cannot do it answers normally, so both operations report a response
 * that was not a switch rather than pretending; they never invent a connection.
 */
export class DispatcherOperations {
  readonly #transport: FetchTransport;

  constructor(transport: FetchTransport) {
    this.#transport = transport;
  }

  /** Dispatches and reads the whole body, bounded. */
  async request(
    request: TransportRequest,
    options: BufferedOptions,
  ): Promise<BufferedResult> {
    const response = await this.#transport.dispatch(request);
    const body = await collectResponseBody(response, request.signal, options.maxBytes);
    const trailers = await settleResponseTrailers(response, request.signal);
    return { ...infoOf(response), body, trailers };
  }

  /**
   * Dispatches and writes the body into the stream `factory` returns.
   *
   * The factory is called once, after the head arrives and before any byte is read, so
   * it can choose a destination from the status. A factory that throws cancels the
   * response with that error rather than leaving the body unread.
   */
  async stream(request: TransportRequest, factory: StreamFactory): Promise<StreamedResult> {
    const response = await this.#transport.dispatch(request);
    const info = infoOf(response);

    let destination: WritableStream<Uint8Array>;
    try {
      request.signal.throwIfAborted();
      destination = factory(info);
    } catch (error) {
      await discard(response, error);
      throw error;
    }

    const writer = destination.getWriter();
    const reader = response.body?.getReader() ?? null;
    try {
      while (reader !== null) {
        const item = await reader.read();
        if (item.done) break;
        if (item.value !== undefined) await writer.write(item.value);
      }
      await writer.close();
    } catch (error) {
      // Both ends, because either may be the one that failed and the other is then
      // still holding resources that nothing else will release.
      if (reader !== null) {
        await reader.cancel(error).then(
          () => {},
          () => {},
        );
      }
      await writer.abort(error).then(
        () => {},
        () => {},
      );
      if (response.trailers !== undefined) ignoreRejection(response.trailers);
      throw error;
    } finally {
      reader?.releaseLock();
      writer.releaseLock();
    }

    return { ...info, trailers: await settleResponseTrailers(response, request.signal) };
  }

  /**
   * Opens a tunnel with `CONNECT` and hands back the connection.
   *
   * The request is dispatched through the whole stack, so proxies, DNS and pooling
   * apply to the tunnel exactly as they do to a request — which is the reason for
   * routing it through `dispatch` rather than reaching for a connector.
   */
  async connect(request: TransportRequest): Promise<TunnelOutcome> {
    return this.#tunnel({ ...request, method: "CONNECT", acceptTunnel: true });
  }

  /**
   * Asks the server to switch to `protocol` and hands back the connection if it does.
   *
   * The protocol is named here rather than through `Connection` and `Upgrade` headers,
   * which the transport manages; omitting it sends no upgrade request at all, which is
   * still useful for a server that switches on its own terms.
   */
  async upgrade(request: TransportRequest, protocol?: string): Promise<TunnelOutcome> {
    return this.#tunnel({
      ...request,
      acceptTunnel: true,
      ...(protocol === undefined ? {} : { upgradeProtocol: protocol }),
    });
  }

  async #tunnel(request: TransportRequest): Promise<TunnelOutcome> {
    const response = await this.#transport.dispatch(request);
    const connection = response.connection;
    if (connection === undefined) {
      // Declined, or a transport that cannot surrender its socket. Either way the
      // response is the answer, body and all, and the caller can tell the difference
      // by reading it.
      return { tunnelled: false, response };
    }
    return { tunnelled: true, ...infoOf(response), connection };
  }

  /**
   * Dispatches and hands the response to `handler`, returning what it produces.
   *
   * Synchronous in the sense that matters: the stream is returned before the dispatch
   * completes, so a caller can wire it up and read. A dispatch that fails surfaces as
   * an error on that stream rather than as a rejected promise nobody is awaiting, and
   * cancelling it cancels the response body underneath.
   */
  pipeline(request: TransportRequest, handler: PipelineHandler): ReadableStream<Uint8Array> {
    const transport = this.#transport;
    let inner: ReadableStreamDefaultReaderLike | null = null;
    let cancelled: { reason: unknown } | null = null;

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        let response: TransportResponse;
        try {
          response = await transport.dispatch(request);
        } catch (error) {
          controller.error(error);
          return;
        }
        let produced: ReadableStream<Uint8Array>;
        try {
          produced = handler(infoOf(response), response.body);
        } catch (error) {
          await discard(response, error);
          controller.error(error);
          return;
        }
        const reader = produced.getReader();
        inner = reader;
        // A cancel that arrived while the dispatch was still in flight has nothing to
        // act on yet; it is applied here instead of being lost.
        if (cancelled !== null) {
          await reader.cancel(cancelled.reason).then(
            () => {},
            () => {},
          );
          return;
        }
        try {
          for (;;) {
            const item = await reader.read();
            if (item.done) break;
            if (item.value !== undefined) controller.enqueue(item.value);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },
      async cancel(reason) {
        cancelled = { reason };
        if (inner !== null) {
          await inner.cancel(reason).then(
            () => {},
            () => {},
          );
        }
      },
    });
  }
}

/** The part of a reader this module uses; named so `inner` needs no cast. */
interface ReadableStreamDefaultReaderLike {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(reason?: unknown): Promise<void>;
  releaseLock(): void;
}
