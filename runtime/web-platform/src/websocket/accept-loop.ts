import type { AbortSignal } from "../core/abort.ts";
import { BufferedReader } from "../http1/io.ts";
import { defaultHeadLimits, readRequestHead } from "../http1/parser.ts";
import type { HeadLimits, RequestHead } from "../http1/parser.ts";
import type { ByteConnection, SocketListener } from "../provider/primitives.ts";
import type { WebSocketServer, WebSocketUpgradeResult } from "./server.ts";

export interface WebSocketAcceptOptions {
  /** Limits for reading the request head. Defaults to the shared HTTP/1 limits. */
  readonly limits?: HeadLimits;
  /**
   * Called for each accepted connection before the upgrade is attempted.
   *
   * The request head is the only thing a server has to route on, and this is where an
   * embedder decides that `/socket` is a WebSocket and `/health` is not. Returning
   * `false` closes the connection without upgrading.
   */
  readonly accept?: (head: RequestHead) => boolean | Promise<boolean>;
  /**
   * Receives each session as it is adopted, with the request head that produced it.
   *
   * Without this the loop would upgrade connections and hand them to nobody, which is
   * the shape of thing this ledger keeps recording: a mechanism that runs and produces
   * nothing a caller can reach. The head comes with it because a server that routed on
   * the target needs to know which route this session is.
   *
   * Awaited, so an embedder that wants to serve one session at a time can simply not
   * return until it is done -- which is also how the loop's backpressure reaches the
   * application rather than stopping at the framing layer.
   */
  readonly onSession?: (
    result: WebSocketUpgradeResult,
    head: RequestHead,
  ) => void | Promise<void>;
  /** Reports a connection that failed before it became a session. */
  readonly onError?: (error: unknown) => void;
}

/**
 * Accepts connections from `listener` and upgrades each one through `server`.
 *
 * `WebSocketServer` is deliberately not an accept loop, and this is deliberately not a
 * `WebSocketServer`: the two are separable because listening and framing are separable,
 * and an embedder that already has a server — one that also serves HTTP, say — wants the
 * second without the first.
 *
 * **The loop is the backpressure.** It accepts one connection at a time and does not ask
 * for the next until the current one has either become a session or been refused, so a
 * server at its connection limit stops accepting rather than accepting and discarding.
 * That is why `accept` is pull-shaped, and it is the only reason a `backlog` means
 * anything.
 *
 * Returns when the listener closes or `signal` aborts. A connection that fails its
 * handshake is closed and reported; it never stops the loop, because one malformed
 * client must not be able to take the server down.
 */
export async function serveWebSocketUpgrades(
  listener: SocketListener,
  server: WebSocketServer,
  signal: AbortSignal,
  options: WebSocketAcceptOptions = {},
): Promise<void> {
  const limits = options.limits ?? defaultHeadLimits;
  for (;;) {
    let connection: ByteConnection | null;
    try {
      connection = await listener.accept(signal);
    } catch (error) {
      // An aborted signal ends the loop; it is the caller asking to stop, not a failure
      // of a connection.
      if (signal.aborted) return;
      throw error;
    }
    if (connection === null) return;

    try {
      await upgradeOne(connection, server, limits, options);
    } catch (error) {
      connection.close();
      options.onError?.(error);
    }
    if (signal.aborted) return;
  }
}

async function upgradeOne(
  connection: ByteConnection,
  server: WebSocketServer,
  limits: HeadLimits,
  options: WebSocketAcceptOptions,
): Promise<WebSocketUpgradeResult | null> {
  // One reader for the head and the frames alike: bytes a client sent immediately after
  // its handshake are already buffered here, and a second reader would lose them.
  const reader = new BufferedReader(connection);
  const head = await readRequestHead(reader, limits);

  if (options.accept !== undefined && !(await options.accept(head))) {
    connection.close();
    return null;
  }
  const result = await server.upgrade(head.method, head.headers, connection, reader);
  if (options.onSession !== undefined) await options.onSession(result, head);
  return result;
}
