// Ordinary-Node primitives for host-level conformance tests. This code never
// delegates Fetch or WebSocket behavior to Node, Undici, or node:http(s).

import { connect as tcpConnect, isIP } from "node:net";
import type { Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { randomFillSync } from "node:crypto";
import { URL } from "node:url";
import { setImmediate, setTimeout, clearTimeout } from "node:timers";
import type { Readable } from "node:stream";
import { Deferred } from "../../../runtime/web-platform/src/core/deferred.ts";
import { DOMException } from "../../../runtime/web-platform/src/core/errors.ts";
import type { AbortSignal } from "../../../runtime/web-platform/src/core/abort.ts";
import type {
  ByteConnection,
  CancelHandle,
  ConnectAddress,
  PlatformPrimitives,
  RandomSource,
  Scheduler,
  SocketConnector,
  URLParser,
} from "../../../runtime/web-platform/src/core/platform.ts";

const MAX_IO_BYTES = 64 * 1024;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export const hostNodeURLs: URLParser = {
  parse(input, base) {
    const url = new URL(input, base);
    return {
      href: url.href,
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      host: url.host,
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      username: url.username,
      password: url.password,
    };
  },
};

export const hostNodeRandom: RandomSource = {
  fill(bytes) {
    randomFillSync(bytes);
  },
};

export class HostNodeScheduler implements Scheduler {
  private readonly report: (error: unknown) => void;

  constructor(
    report: (error: unknown) => void = (error) => {
      setImmediate(() => {
        throw error;
      });
    },
  ) {
    this.report = report;
  }

  enqueue(task: () => void): void {
    setImmediate(task);
  }

  delay(milliseconds: number, task: () => void): CancelHandle {
    if (!Number.isFinite(milliseconds) || milliseconds < 0)
      throw new RangeError("Invalid timer delay");
    // Chain long delays rather than letting Node clamp them to 1ms.
    let remaining = milliseconds;
    let canceled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const arm = (): void => {
      const delay = Math.min(remaining, MAX_TIMER_DELAY_MS);
      remaining -= delay;
      timer = setTimeout(() => {
        if (!canceled) {
          if (remaining > 0) arm();
          else task();
        }
      }, delay);
      timer.unref();
    };

    arm();

    return {
      cancel(): void {
        canceled = true;
        if (timer !== undefined) clearTimeout(timer);
      },
    };
  }

  reportError(error: unknown): void {
    this.report(error);
  }
}

/** Paused-mode reader. Node retains only its stream high-water mark when no one reads. */
export class HostNodeReadable {
  private readonly input: Readable;
  private pending: { max: number; result: Deferred<Uint8Array | null> } | null = null;
  private ended = false;
  private failed = false;
  private error: unknown;

  constructor(input: Readable) {
    this.input = input;
    input.on("readable", () => this.pump());
    input.on("end", () => {
      this.ended = true;
      this.pump();
    });
    input.on("error", (error) => this.fail(error));
    input.on("close", () => {
      if (!this.ended && !this.failed) this.fail(new TypeError("Transport closed before EOF"));
    });
  }

  read(max: number): Promise<Uint8Array | null> {
    if (this.pending !== null)
      return Promise.reject(new TypeError("Overlapping reads are not permitted"));
    if (!Number.isInteger(max) || max < 1 || max > MAX_IO_BYTES)
      return Promise.reject(new RangeError(`Read size must be 1..${MAX_IO_BYTES}`));
    const result = new Deferred<Uint8Array | null>();
    this.pending = { max, result };
    this.pump();
    return result.promise;
  }

  private pump(): void {
    const pending = this.pending;
    if (pending === null) return;
    if (this.failed) {
      this.pending = null;
      pending.result.reject(this.error);
      return;
    }
    try {
      const available = this.input.readableLength;
      if (available > 0) {
        const value: unknown = this.input.read(Math.min(available, pending.max));
        if (!(value instanceof Uint8Array)) throw new TypeError("Transport returned non-byte data");
        this.pending = null;
        pending.result.resolve(value);
        return;
      }
      if (this.ended || this.input.readableEnded) {
        this.pending = null;
        pending.result.resolve(null);
        return;
      }
      // Ensure Node requests another chunk in paused mode without consuming it.
      this.input.read(0);
    } catch (error) {
      this.fail(error);
    }
  }

  fail(error: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.error = error;
    const pending = this.pending;
    this.pending = null;
    pending?.result.reject(error);
  }
}

export class HostNodeByteConnection implements ByteConnection {
  private readonly socket: Socket;
  private readonly reader: HostNodeReadable;
  private writer: Deferred<number> | null = null;
  private locallyClosed = false;

  constructor(socket: Socket) {
    this.socket = socket;
    this.reader = new HostNodeReadable(socket);
    socket.setNoDelay(true);
    socket.on("error", (error) => {
      this.writer?.reject(error);
      this.writer = null;
    });
    socket.on("close", () => {
      this.writer?.reject(new TypeError("Socket closed during write"));
      this.writer = null;
    });
  }

  get closed(): boolean {
    return this.locallyClosed || this.socket.destroyed || this.socket.readableEnded;
  }
  read(maxBytes: number): Promise<Uint8Array | null> {
    return this.reader.read(maxBytes);
  }
  write(data: Uint8Array): Promise<number> {
    if (this.closed) return Promise.reject(new TypeError("Socket is closed"));
    if (this.writer !== null)
      return Promise.reject(new TypeError("Overlapping writes are not permitted"));
    if (data.length === 0 || data.length > MAX_IO_BYTES)
      return Promise.reject(new RangeError(`Write size must be 1..${MAX_IO_BYTES}`));
    const result = new Deferred<number>();
    this.writer = result;
    // The callback, not write()'s boolean, signals completion and ownership return.
    try {
      this.socket.write(data, (error) => {
        if (this.writer === result) this.writer = null;
        if (error) result.reject(error);
        else result.resolve(data.length);
      });
    } catch (error) {
      this.writer = null;
      result.reject(error);
    }
    return result.promise;
  }

  close(): void {
    if (this.locallyClosed) return;
    this.locallyClosed = true;
    const error = new TypeError("Socket closed");
    this.reader.fail(error);
    this.writer?.reject(error);
    this.writer = null;
    this.socket.destroy();
  }
}

export interface HostNodeSocketOptions {
  ca?: string | readonly string[];
}

export class HostNodeSocketConnector implements SocketConnector {
  private readonly options: HostNodeSocketOptions;

  constructor(options: HostNodeSocketOptions = {}) {
    this.options = options;
  }

  connect(address: ConnectAddress, signal: AbortSignal): Promise<ByteConnection> {
    if (signal.aborted) return Promise.reject(signal.reason);
    if (
      !Number.isInteger(address.connectTimeoutMs) ||
      address.connectTimeoutMs < 1 ||
      address.connectTimeoutMs > MAX_TIMER_DELAY_MS
    )
      return Promise.reject(new RangeError(`Connect timeout must be 1..${MAX_TIMER_DELAY_MS} ms`));
    return new Promise<ByteConnection>((resolve, reject) => {
      const ca = typeof this.options.ca === "string" ? this.options.ca : this.options.ca?.slice();
      const socket = address.secure
        ? tlsConnect({
            host: address.hostname,
            port: address.port,
            servername: isIP(address.hostname) === 0 ? address.hostname : undefined,
            rejectUnauthorized: true,
            minVersion: "TLSv1.2",
            ALPNProtocols: ["http/1.1"],
            ca,
          })
        : tcpConnect({ host: address.hostname, port: address.port });
      let settled = false;
      let dispose = (): void => {};
      const timer = setTimeout(
        () => finishError(new DOMException("Connection timed out", "TimeoutError")),
        address.connectTimeoutMs,
      );
      timer.unref();
      const cleanup = (): void => {
        clearTimeout(timer);
        dispose();
        socket.off("error", finishError);
        socket.off("close", closed);
      };
      const finishError = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        // Keep an error listener while destroy/handshake callbacks unwind.
        socket.on("error", () => {});
        socket.destroy();
        reject(error);
      };
      const closed = (): void =>
        finishError(new TypeError("Connection closed before it was established"));
      socket.once("error", finishError);
      socket.once("close", closed);
      dispose = signal.subscribe(() => finishError(signal.reason));
      socket.once(address.secure ? "secureConnect" : "connect", () => {
        if (settled) return;
        if (signal.aborted) {
          finishError(signal.reason);
          return;
        }
        settled = true;
        const connection = new HostNodeByteConnection(socket);
        cleanup();
        resolve(connection);
      });
    });
  }
}

export function createHostNodePrimitives(
  options: HostNodeSocketOptions = {},
  reportError?: (error: unknown) => void,
): PlatformPrimitives {
  return {
    sockets: new HostNodeSocketConnector(options),
    random: hostNodeRandom,
    scheduler: new HostNodeScheduler(reportError),
    urls: hostNodeURLs,
  };
}
