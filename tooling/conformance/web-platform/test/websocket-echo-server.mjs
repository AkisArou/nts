// An echoing WebSocket server over a real socket, built from the shared server pieces.
//
// Extracted rather than copied. Two suites need a real peer -- the server-session tests
// and the dispatched client -- and a harness that exists twice is a harness that drifts,
// which for a test peer means two suites quietly stop testing the same thing.
import { createServer } from "node:net";

import {
  acceptWebSocketUpgrade,
  adoptServerWebSocketSession,
  BufferedReader,
  readRequestHead,
  serializeUpgradeResponse,
  writeAll,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/provider.js";
import {
  HostNodeScheduler,
  hostNodeRandom,
} from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-primitives.js";

const encoder = new TextEncoder();

/** Minimal ByteConnection over an accepted Node socket. Test harness, not a provider. */
export function byteConnection(socket) {
  const pending = [];
  let waiting = null;
  let ended = false;
  socket.on("data", (chunk) => {
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
    async read(maxBytes) {
      const take = (chunk) => {
        if (chunk === null || chunk.length <= maxBytes) return chunk;
        pending.unshift(chunk.subarray(maxBytes));
        return chunk.subarray(0, maxBytes);
      };
      const next = pending.shift();
      if (next !== undefined) return take(next);
      if (ended) return null;
      return new Promise((resolve) => {
        waiting = (chunk) => resolve(take(chunk));
      });
    },
    async write(data) {
      socket.write(Buffer.from(data));
      return data.length;
    },
    close() {
      socket.destroy();
    },
  };
}

export async function websocketServer(t, upgradeOptions, deflate) {
  const seen = { protocol: null, extensions: null, messages: [], errors: [] };
  const sockets = new Set();
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
          if (incoming.kind === "closed") break;
          seen.messages.push(incoming);
          await session.send(incoming);
        }
      } catch (error) {
        seen.errors.push(error);
      }
    })();
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  return { port: server.address().port, seen };
}
