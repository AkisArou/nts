// Test-only lifetime tracking below the Web API. The original WPT creates some
// writes without awaiting them; closing its runtime immediately would reject
// those otherwise valid writes during the shared adapter's teardown.
import type { WebSocketSession, WebSocketTransport } from "../../../src/websocket/transport.ts";

export interface DrainableTransport {
  readonly transport: WebSocketTransport;
  drain(): Promise<void>;
}

const checkpoint = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Observe whole provider operations, including asynchronous compression and all
 * frame writes. A byte-write counter can be empty while that work is pending.
 * Read operations deliberately stay outside the drain: an idle open connection
 * may have a read pending forever.
 *
 * The fixture injects this facade into a second runtime. The first runtime owns
 * the real transport, since injected transports are not runtime-owned. After a
 * successful drain, close the fixture runtime and then its transport owner; on
 * failure, close both in finally. This helper never closes either one itself.
 */
export function createDrainableTransport(
  provider: WebSocketTransport,
): DrainableTransport {
  const pending = new Set<Promise<unknown>>();
  let generation = 0;

  function track<T>(operation: Promise<T>): Promise<T> {
    pending.add(operation);
    generation++;
    const settled = (): void => { pending.delete(operation); };
    // Observe provider completion only. Public writer.write() promises are never
    // handled here; send/close callers still receive the original promise.
    void operation.then(settled, settled);
    return operation;
  }

  function sessionFor(session: WebSocketSession): WebSocketSession {
    return {
      get protocol() { return session.protocol; },
      get extensions() { return session.extensions; },
      next() { return session.next(); },
      send(message) { return track(session.send(message)); },
      close(code, reason) { return track(session.close(code, reason)); },
      abort() { session.abort(); },
    };
  }

  return {
    transport: {
      connect(handshake, signal) {
        return track(provider.connect(handshake, signal).then(sessionFor));
      },
    },
    async drain() {
      while (true) {
        if (pending.size !== 0) {
          // Rejections remain observable by API callers. A provider rejection
          // already asserted by WPT is completion, not a second test failure.
          await Promise.allSettled([...pending]);
        }
        const observed = generation;
        await checkpoint();
        if (pending.size !== 0 || generation !== observed) continue;
        // A successful send queues one scheduler task before its stream write
        // settles. That task may have been queued after the first checkpoint;
        // its promise continuations can start the next queued provider write.
        // Require the same generation across both explicit task boundaries.
        await checkpoint();
        if (pending.size === 0 && generation === observed) return;
      }
    },
  };
}
