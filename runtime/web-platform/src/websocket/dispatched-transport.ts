import type { AbortSignal } from "../core/abort.ts";
import { ProtocolError } from "../core/errors.ts";
import { Headers } from "../fetch/headers.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import type { FetchTransport, TransportRequest } from "../fetch/transport.ts";
import { BufferedReader } from "../http1/io.ts";
import type { RandomSource, Scheduler } from "../provider/primitives.ts";
import { createKey, validateHandshake } from "./handshake.ts";
import { perMessageDeflateOffer } from "./permessage-deflate.ts";
import { adoptClientWebSocketSession } from "./raw-transport.ts";
import type { RawWebSocketOptions } from "./raw-transport.ts";
import type {
  WebSocketDeflateProvider,
  WebSocketHandshake,
  WebSocketSession,
  WebSocketTransport,
} from "./transport.ts";

/**
 * A WebSocket client that opens its connection through the HTTP dispatch stack.
 *
 * {@link RawWebSocketTransport} takes a `SocketConnector` and writes the upgrade
 * request itself, which is the right shape for the reference path and means WebSocket
 * gets none of what the dispatch stack does: no proxy, no DNS cache, no connection
 * accounting, no interceptors. Every one of those had to be reimplemented or done
 * without.
 *
 * This one dispatches an ordinary request that asks to keep its connection, so all of
 * that applies to a WebSocket exactly as it does to a request — and the handshake
 * validation, the framing engine and the session are the same code either way. What
 * changes is only where the connection came from.
 *
 * The transport must be able to surrender a connection. One that cannot answers with an
 * ordinary response, and that is reported rather than papered over: a WebSocket whose
 * transport silently declined would appear to connect and then read HTTP as frames.
 */
export class DispatchedWebSocketTransport implements WebSocketTransport {
  readonly #transport: FetchTransport;
  readonly #random: RandomSource;
  readonly #scheduler: Scheduler;
  readonly #options: RawWebSocketOptions;
  readonly #deflate: WebSocketDeflateProvider | undefined;
  readonly #sessions = new Set<WebSocketSession>();
  #closed = false;

  constructor(
    transport: FetchTransport,
    random: RandomSource,
    scheduler: Scheduler,
    options: RawWebSocketOptions = {},
    deflate?: WebSocketDeflateProvider,
  ) {
    this.#transport = transport;
    this.#random = random;
    this.#scheduler = scheduler;
    this.#options = options;
    this.#deflate = deflate;
  }

  async connect(handshake: WebSocketHandshake, signal: AbortSignal): Promise<WebSocketSession> {
    signal.throwIfAborted();
    if (this.#closed) throw new TypeError("WebSocket transport is closed");

    const key = createKey(this.#random);
    const headers: HeaderEntry[] = [
      ["sec-websocket-key", key],
      ["sec-websocket-version", "13"],
      ["origin", handshake.origin],
    ];
    if (handshake.protocols.length !== 0) {
      headers.push(["sec-websocket-protocol", handshake.protocols.join(", ")]);
    }
    if (this.#deflate !== undefined) {
      headers.push(["sec-websocket-extensions", perMessageDeflateOffer]);
    }

    // `Upgrade` and `Connection` are not among these: they are framing headers the
    // transport owns, and `upgradeProtocol` is how a caller names what it wants.
    const request: TransportRequest = {
      url: handshake.url,
      method: "GET",
      headers,
      body: null,
      bodyLength: null,
      signal,
      acceptTunnel: true,
      upgradeProtocol: "websocket",
    };

    const response = await this.#transport.dispatch(request);
    const connection = response.connection;
    if (connection === undefined) {
      // Either the server refused or the transport cannot hand over a socket. Draining
      // the body would be tidier; leaving it is deliberate, because the caller of a
      // WebSocket has nowhere to put a response body and a silent drain would make a
      // refusal indistinguishable from a transport limitation.
      throw new ProtocolError(
        "The WebSocket upgrade did not yield a connection (status " + response.status + ")",
      );
    }

    let validated;
    try {
      signal.throwIfAborted();
      validated = validateHandshake(
        response.status,
        new Headers(response.headers),
        key,
        handshake.protocols,
        this.#deflate !== undefined,
      );
    } catch (error) {
      // The connection is ours now, and nothing else will close it.
      connection.close();
      throw error;
    }

    const session = adoptClientWebSocketSession({
      connection,
      // A fresh reader over the tunnel connection, which itself drains whatever the
      // HTTP head parser buffered. Frames that arrived in the same packet as the `101`
      // are therefore read as frames rather than lost.
      reader: new BufferedReader(connection),
      handshake: validated,
      deflate: this.#deflate,
      random: this.#random,
      scheduler: this.#scheduler,
      transport: this.#options,
      onEnd: () => {
        this.#sessions.delete(session);
      },
    });
    this.#sessions.add(session);
    return session;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const session of [...this.#sessions]) session.abort();
    this.#sessions.clear();
  }
}
