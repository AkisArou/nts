import { adoptServerWebSocketSession } from "./raw-transport.ts";
import type { RawWebSocketOptions } from "./raw-transport.ts";
import { acceptWebSocketUpgrade, serializeUpgradeResponse } from "./server-handshake.ts";
import type { WebSocketUpgradeOptions } from "./server-handshake.ts";
import type { WebSocketDeflateProvider } from "./transport.ts";
import type { WebSocketSession } from "./transport.ts";
import { encodeByteString } from "../core/encoding.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import { BufferedReader, writeAll } from "../http1/io.ts";
import type { ByteConnection, RandomSource, Scheduler } from "../provider/primitives.ts";

/** RFC 6455 close code for a server shutting down. */
const GOING_AWAY = 1001;

export interface WebSocketServerOptions extends WebSocketUpgradeOptions {
  readonly random: RandomSource;
  readonly scheduler: Scheduler;
  /** Required only when {@link WebSocketUpgradeOptions.perMessageDeflate} is enabled. */
  readonly deflate?: WebSocketDeflateProvider;
  readonly transport?: RawWebSocketOptions;
  /**
   * Live sessions this server will hold at once.
   *
   * A refusal above this bound is an HTTP response rather than a dropped connection,
   * so a client learns it was turned away rather than timing out. Unbounded is not an
   * option: a server that accepts every upgrade has no way to shed load.
   */
  readonly maxConnections?: number;
}

/** What an upgrade attempt produced. */
export type WebSocketUpgradeResult =
  | {
      readonly accepted: true;
      readonly session: WebSocketSession;
      readonly protocol: string | null;
    }
  | { readonly accepted: false; readonly status: number; readonly reason: string };

/**
 * Owns the lifetime of server-side WebSocket sessions.
 *
 * It is deliberately not an accept loop. Listening, TLS, and HTTP request parsing
 * belong to the server this is embedded in, which already has them; what does not
 * exist anywhere else is something that knows how many sessions are open, refuses when
 * that is too many, and can close all of them once. That is what this is.
 */
export class WebSocketServer {
  readonly #options: WebSocketServerOptions;
  readonly #sessions = new Set<WebSocketSession>();
  readonly #maxConnections: number;
  #accepting = true;
  #closeResult: Promise<void> | null = null;

  constructor(options: WebSocketServerOptions) {
    this.#options = options;
    this.#maxConnections = options.maxConnections ?? 1024;
    if (!Number.isSafeInteger(this.#maxConnections) || this.#maxConnections < 1) {
      throw new RangeError("maxConnections must be a positive safe integer");
    }
  }

  /** Sessions currently open. */
  get connections(): number {
    return this.#sessions.size;
  }

  get accepting(): boolean {
    return this.#accepting;
  }

  /**
   * Completes an upgrade on an already-read request and adopts the session.
   *
   * The response is written here rather than returned, because the handshake and the
   * first frame share one connection and one reader: handing the response back would
   * let a caller write it late, or not at all, while this object already believed the
   * session was live.
   */
  async upgrade(
    method: string,
    requestHeaders: readonly HeaderEntry[],
    connection: ByteConnection,
    reader: BufferedReader,
  ): Promise<WebSocketUpgradeResult> {
    if (!this.#accepting) {
      return this.#refuse(connection, 503, "Service Unavailable", "The server is closing");
    }
    if (this.#sessions.size >= this.#maxConnections) {
      return this.#refuse(connection, 503, "Service Unavailable", "Too many open connections");
    }
    const outcome = acceptWebSocketUpgrade(method, requestHeaders, this.#options);
    await writeAll(connection, encodeByteString(serializeUpgradeResponse(outcome)));
    if (!outcome.accepted) {
      connection.close();
      return { accepted: false, status: outcome.status, reason: outcome.reason };
    }
    // Registration happens before the session is handed out, so a caller that starts
    // reading immediately cannot retire a session this server has not counted.
    const session: WebSocketSession = adoptServerWebSocketSession({
      connection,
      reader,
      protocol: outcome.protocol ?? "",
      extensions: outcome.perMessageDeflate?.response ?? "",
      perMessageDeflate: outcome.perMessageDeflate,
      deflate: this.#options.deflate,
      random: this.#options.random,
      scheduler: this.#options.scheduler,
      transport: this.#options.transport,
      onEnd: () => {
        this.#sessions.delete(session);
      },
    });
    this.#sessions.add(session);
    return { accepted: true, session, protocol: outcome.protocol };
  }

  /**
   * Stops accepting and closes every open session with the going-away code.
   *
   * Waits for each close to settle, so completion means no session is still writing.
   * Repeated calls share one result rather than starting a second shutdown.
   */
  close(): Promise<void> {
    if (this.#closeResult !== null) return this.#closeResult;
    this.#accepting = false;
    this.#closeResult = this.#finishClose();
    return this.#closeResult;
  }

  /** Stops accepting and abandons every session without a close handshake. */
  destroy(): void {
    this.#accepting = false;
    for (const session of this.#sessions) session.abort();
    this.#sessions.clear();
  }

  async #finishClose(): Promise<void> {
    // A snapshot, because closes are started together and a `Set` cannot be mapped.
    // Concurrency here is a preference rather than a requirement: shutting down
    // sequentially passes these tests too, and the comment says so rather than
    // claiming a property nothing checks.
    const open = [...this.#sessions];
    await Promise.all(
      open.map((session) =>
        session.close(GOING_AWAY, "").then(
          () => {},
          () => {},
        ),
      ),
    );
    this.#sessions.clear();
  }

  async #refuse(
    connection: ByteConnection,
    status: number,
    statusText: string,
    reason: string,
  ): Promise<WebSocketUpgradeResult> {
    const head = "HTTP/1.1 " + String(status) + " " + statusText + "\r\nconnection: close\r\n\r\n";
    try {
      await writeAll(connection, encodeByteString(head));
    } catch {
      // The refusal stands whether or not the peer was still there to read it.
    }
    connection.close();
    return { accepted: false, status, reason };
  }
}
