import { abortSignalSubscribe } from "../core/abort.ts";
import type { AbortSignal } from "../core/abort.ts";
import type { URLRecord } from "../provider/primitives.ts";

/** Serialize CONNECTING attempts, not the lifetime of established sessions. */
export class WebSocketConnectionQueue {
  private readonly tails: Map<string, Promise<void>> = new Map();

  async acquire(url: URLRecord, signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    // RFC 6455 §4.1 step 2: the connector does not expose the resolved peer IP,
    // so use the permitted hostname fallback and the effective destination port.
    const port = url.port || (url.protocol === "wss:" || url.protocol === "https:" ? "443" : "80");
    const key = url.hostname.toLowerCase() + ":" + port;
    const previous = this.tails.get(key) ?? Promise.resolve();
    const released = Promise.withResolvers<void>();
    // An aborted waiter releases its own place immediately, but its successors
    // must still wait for the earlier connection to leave CONNECTING.
    const tail = previous.then(() => released.promise);
    this.tails.set(key, tail);
    tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });

    const turn = Promise.withResolvers<void>();
    const detach = signal[abortSignalSubscribe](() => turn.reject(signal.reason));
    previous.then(turn.resolve);
    try {
      await turn.promise;
      signal.throwIfAborted();
      return released.resolve;
    } catch (error) {
      released.resolve();
      throw error;
    } finally {
      detach();
    }
  }
}
