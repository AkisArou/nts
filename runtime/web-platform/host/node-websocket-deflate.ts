import {
  constants,
  createDeflateRaw,
  createInflateRaw,
  type DeflateRaw,
  type InflateRaw,
} from "node:zlib";
import { LimitError } from "../src/core/errors.ts";
import type {
  WebSocketDeflateContext,
  WebSocketDeflateProvider,
} from "../src/provider.ts";

type RawDeflateTransform = DeflateRaw | InflateRaw;

interface PendingTransform {
  readonly chunks: Uint8Array[];
  readonly maxOutputBytes: number;
  readonly result: PromiseWithResolvers<Uint8Array>;
  total: number;
}

/** Node zlib is only the raw-DEFLATE primitive; RFC 7692 stays in shared TS. */
export class HostNodeWebSocketDeflate implements WebSocketDeflateProvider {
  createDeflater(windowBits: number): WebSocketDeflateContext {
    return new HostNodeRawDeflate(createDeflateRaw({ chunkSize: 65536, windowBits }));
  }

  createInflater(windowBits: number): WebSocketDeflateContext {
    return new HostNodeRawDeflate(createInflateRaw({ chunkSize: 65536, windowBits }));
  }
}

class HostNodeRawDeflate implements WebSocketDeflateContext {
  private readonly transform: RawDeflateTransform;
  private pending: PendingTransform | null = null;
  private closed = false;

  constructor(transform: RawDeflateTransform) {
    this.transform = transform;
    transform.on("data", (chunk: Uint8Array) => this.accept(chunk));
    transform.on("error", (error) => this.fail(error));
  }

  process(input: Uint8Array, maxOutputBytes: number): Promise<Uint8Array> {
    if (this.closed) return Promise.reject(new TypeError("Raw DEFLATE context is closed"));
    if (this.pending !== null) {
      return Promise.reject(new TypeError("Overlapping raw DEFLATE operations are not permitted"));
    }
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
      return Promise.reject(new RangeError("Invalid raw DEFLATE output limit"));
    }

    const result = Promise.withResolvers<Uint8Array>();
    this.pending = { chunks: [], maxOutputBytes, result, total: 0 };
    try {
      this.transform.write(input, (writeError) => {
        if (writeError) {
          this.fail(writeError);
          return;
        }
        this.transform.flush(constants.Z_SYNC_FLUSH, () => this.finish());
      });
    } catch (error) {
      this.fail(error);
    }
    return result.promise;
  }

  reset(): void {
    if (this.closed) throw new TypeError("Raw DEFLATE context is closed");
    if (this.pending !== null) throw new TypeError("Cannot reset raw DEFLATE while processing");
    this.transform.reset();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const pending = this.pending;
    this.pending = null;
    pending?.result.reject(new TypeError("Raw DEFLATE context was closed"));
    this.transform.destroy();
  }

  private accept(chunk: Uint8Array): void {
    const pending = this.pending;
    if (pending === null) return;
    pending.total += chunk.length;
    if (pending.total > pending.maxOutputBytes) {
      this.fail(new LimitError("Raw DEFLATE output exceeds configured limit"));
      this.transform.destroy();
      return;
    }
    pending.chunks.push(Uint8Array.from(chunk));
  }

  private finish(): void {
    const pending = this.pending;
    if (pending === null) return;
    this.pending = null;
    const output = new Uint8Array(pending.total);
    let offset = 0;
    for (const chunk of pending.chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    pending.result.resolve(output);
  }

  private fail(error: unknown): void {
    const pending = this.pending;
    this.pending = null;
    pending?.result.reject(error);
  }
}
