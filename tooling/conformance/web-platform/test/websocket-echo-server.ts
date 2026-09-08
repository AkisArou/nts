// An echoing WebSocket server over a real socket, built from the shared server pieces.
//
// Extracted rather than copied. Two suites need a real peer -- the server-session tests
// and the dispatched client -- and a harness that exists twice is a harness that drifts,
// which for a test peer means two suites quietly stop testing the same thing.
import { createServer } from "node:net";
import type { Socket } from "node:net";
import type { TestContext } from "node:test";
import type {
  ByteConnection,
  SocketMessage,
  WebSocketDeflateProvider,
  WebSocketUpgradeOptions,
} from "../../../../runtime/web-platform/src/provider.ts";

import {
  acceptWebSocketUpgrade,
  adoptServerWebSocketSession,
  BufferedReader,
  readRequestHead,
  serializeUpgradeResponse,
  writeAll,
} from "../../../../runtime/web-platform/src/provider.ts";
import {
  HostNodeScheduler,
  hostNodeRandom,
} from "../node-primitives.ts";

const encoder = new TextEncoder();

/** Minimal ByteConnection over an accepted Node socket. Test harness, not a provider. */
export function byteConnection(socket: Socket): ByteConnection {
  const pending: Uint8Array[] = [];
  // The resolver of a `read` that arrived before any bytes did. `null` when nobody waits.
  let waiting: ((chunk: Uint8Array | null) => void) | null = null;
  let ended = false;
  socket.on("data", (chunk: Buffer) => {
    if (waiting !== null) {
      const resolve = waiting;
      waiting = null;
      resolve(new Uint8Array(chunk));
      return;
    }
    pending.push(new Uint8Array(chunk));
  });
  socket.on("end", () => {
    ended = true;
    if (waiting !== null) {
      const resolve = waiting;
      waiting = null;
      resolve(null);
    }
  });
  socket.on("error", () => {});
  return {
    get closed() {
      return socket.destroyed;
    },
    // The contract is "a nonempty chunk of at most maxBytes"; returning a whole socket
    // chunk regardless is a contract violation the reader is entitled to trip over.
    async read(maxBytes: number): Promise<Uint8Array | null> {
      const take = (chunk: Uint8Array | null): Uint8Array | null => {
        if (chunk === null || chunk.length <= maxBytes) return chunk;
        pending.unshift(chunk.subarray(maxBytes));
        return chunk.subarray(0, maxBytes);
      };
      const next = pending.shift();
      if (next !== undefined) return take(next);
      if (ended) return null;
      return new Promise<Uint8Array | null>((resolve) => {
        waiting = (chunk) => resolve(take(chunk));
      });
    },
    async write(data: Uint8Array): Promise<number> {
      socket.write(Buffer.from(data));
      return data.length;
    },
    close() {
      socket.destroy();
    },
  };
}

/** What the server end observed, for a test to assert against afterwards. */
export interface WebSocketServerSeen {
  protocol: string | null;
  extensions: string | null;
  readonly messages: SocketMessage[];
  readonly errors: unknown[];
}

export interface WebSocketServerHandle {
  readonly port: number;
  readonly seen: WebSocketServerSeen;
}

export async function websocketServer(
  t: TestContext,
  upgradeOptions: WebSocketUpgradeOptions = {},
  // Optional in fact as well as in use: most callers want no compression, and leaving it
  // untyped made every one of those calls read as a missing argument.
  deflate?: WebSocketDeflateProvider,
): Promise<WebSocketServerHandle> {
  const seen: WebSocketServerSeen = { protocol: null, extensions: null, messages: [], errors: [] };
  const sockets = new Set<Socket>();
  const scheduler = new HostNodeScheduler(() => {});
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    void (async () => {
      const connection = byteConnection(socket);
      const reader = new BufferedReader(connection);
      const request = await readRequestHead(reader);
      const outcome = acceptWebSocketUpgrade(request.method, request.headers, upgradeOptions);
      await writeAll(connection, encoder.encode(serializeUpgradeResponse(outcome)));
      if (!outcome.accepted) {
        connection.close();
        return;
      }
      seen.protocol = outcome.protocol;
      seen.extensions = outcome.perMessageDeflate?.response ?? null;
      // The same reader continues into the frames: bytes a client sent immediately
      // after its handshake are already buffered here.
      const session = adoptServerWebSocketSession({
        connection,
        reader,
        protocol: outcome.protocol ?? "",
        extensions: seen.extensions ?? "",
        perMessageDeflate: outcome.perMessageDeflate,
        deflate,
        random: hostNodeRandom,
        scheduler,
      });
      try {
        while (true) {
          const incoming = await session.next();
          // `"close"`, not `"closed"`. It was the latter, which is not one of the three kinds
          // `SocketIncoming` has, so the comparison was always false: the loop never broke on
          // a close, pushed the close frame into `messages`, and then tried to echo it back as
          // a message. Typing this file is what surfaced it -- every run took the error path
          // at the end of every connection, and no assertion looked.
          if (incoming.kind === "close") break;
          seen.messages.push(incoming);
          await session.send(incoming);
        }
      } catch (error) {
        seen.errors.push(error);
      }
    })();
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  // A listening TCP server always has the object form; narrowing says so rather than assuming.
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the echo server did not bind a TCP port");
  }
  return { port: address.port, seen };
}
