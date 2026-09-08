// Ordinary-Node primitives for host-level conformance tests. This code never
// delegates Fetch or WebSocket behavior to Node, Undici, or node:http(s).

import { connect as tcpConnect, createServer, isIP } from "node:net";
import type { Server, Socket } from "node:net";
import { lookup as dnsLookup } from "node:dns";
import { checkServerIdentity, connect as tlsConnect } from "node:tls";
import type { TLSSocket } from "node:tls";
import { createHash, randomFillSync } from "node:crypto";
import { EOL } from "node:os";
import { URL } from "node:url";
import { setImmediate, setTimeout, clearTimeout } from "node:timers";
import type { Readable } from "node:stream";
import { DOMException } from "../src/core/errors.ts";
import type { AbortSignal } from "../src/core/abort.ts";
import type {
  BoundAddress,
  ByteConnection,
  CancelHandle,
  ConnectAddress,
  ListenAddress,
  SocketBinder,
  SocketListener,
  DnsAddress,
  DnsResolveOptions,
  DigestProvider,
  DnsResolver,
  NegotiatedConnection,
  NegotiatingSocketConnector,
  NegotiatingTlsUpgrader,
  PlatformPrimitives,
  RandomSource,
  Scheduler,
  URLParser,
  URLRecord,
} from "../src/provider.ts";
import { abortSignalSubscribe } from "../src/core/abort-brand.ts";

const MAX_IO_BYTES = 64 * 1024;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function requiredAlpn(address: ConnectAddress): readonly string[] {
  return address.alpnProtocols ?? ["http/1.1"];
}

/** dNSName subject-alternative names exactly as the peer presented them. */
function dnsNamesOf(socket: TLSSocket): readonly string[] {
  const certificate = socket.getPeerCertificate();
  const alternative: unknown = certificate.subjectaltname;
  if (typeof alternative !== "string" || alternative === "") return [];
  const names: string[] = [];
  for (const entry of alternative.split(",")) {
    const trimmed = entry.trim();
    if (trimmed.startsWith("DNS:")) names.push(trimmed.slice(4));
  }
  return names;
}

/** The protocol TLS selected, normalized to the shared `string | null` reporting. */
function selectedProtocol(selected: string | false | null | undefined): string | null {
  return selected === undefined || selected === false || selected === null || selected === ""
    ? null
    : selected;
}

function validateAlpn(selected: string | false | null, requested: readonly string[]): void {
  if (selected === false || selected === null || selected === "") {
    if (requested.includes("http/1.1")) return;
    throw new TypeError("TLS peer did not negotiate a required application protocol");
  }
  if (!requested.includes(selected)) {
    throw new TypeError("TLS peer negotiated an unexpected application protocol: " + selected);
  }
}

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
  private readonly onReadable = (): void => this.pump();
  private readonly onEnd = (): void => {
    this.ended = true;
    this.pump();
  };
  private readonly onError = (error: unknown): void => this.fail(error);
  private readonly onClose = (): void => {
    if (!this.ended && !this.failed) this.fail(new TypeError("Transport closed before EOF"));
  };
  private pending: {
    max: number;
    result: PromiseWithResolvers<Uint8Array | null>;
  } | null = null;
  private ended = false;
  private failed = false;
  private error: unknown;

  constructor(input: Readable) {
    this.input = input;
    input.on("readable", this.onReadable);
    input.on("end", this.onEnd);
    input.on("error", this.onError);
    input.on("close", this.onClose);
  }

  read(max: number): Promise<Uint8Array | null> {
    if (this.pending !== null)
      return Promise.reject(new TypeError("Overlapping reads are not permitted"));
    if (!Number.isInteger(max) || max < 1 || max > MAX_IO_BYTES)
      return Promise.reject(new RangeError(`Read size must be 1..${MAX_IO_BYTES}`));
    const result = Promise.withResolvers<Uint8Array | null>();
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

  /** Stop consuming the plaintext socket before a provider wraps it in TLS. */
  detach(): void {
    if (this.pending !== null) throw new TypeError("Cannot start TLS during a pending read");
    this.input.off("readable", this.onReadable);
    this.input.off("end", this.onEnd);
    this.input.off("error", this.onError);
    this.input.off("close", this.onClose);
  }
}

export class HostNodeByteConnection implements ByteConnection {
  private readonly socket: Socket;
  private readonly reader: HostNodeReadable;
  private writer: PromiseWithResolvers<number> | null = null;
  private locallyClosed = false;
  private readonly onSocketError = (error: unknown): void => {
    this.writer?.reject(error);
    this.writer = null;
  };
  private readonly onSocketClose = (): void => {
    this.writer?.reject(new TypeError("Socket closed during write"));
    this.writer = null;
  };

  constructor(socket: Socket) {
    this.socket = socket;
    this.reader = new HostNodeReadable(socket);
    socket.setNoDelay(true);
    socket.on("error", this.onSocketError);
    socket.on("close", this.onSocketClose);
  }

  get closed(): boolean {
    return this.locallyClosed || this.socket.destroyed || this.socket.readableEnded;
  }
  read(maxBytes: number): Promise<Uint8Array | null> {
    if (this.locallyClosed) return Promise.reject(new TypeError("Socket is closed"));
    return this.reader.read(maxBytes);
  }
  write(data: Uint8Array): Promise<number> {
    if (this.closed) return Promise.reject(new TypeError("Socket is closed"));
    if (this.writer !== null)
      return Promise.reject(new TypeError("Overlapping writes are not permitted"));
    if (data.length === 0 || data.length > MAX_IO_BYTES)
      return Promise.reject(new RangeError(`Write size must be 1..${MAX_IO_BYTES}`));
    const result = Promise.withResolvers<number>();
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

  /** @internal Host-only ownership transfer used by HostNodeTlsUpgrader. */
  detachForTls(): Socket {
    if (this.locallyClosed) throw new TypeError("Socket is closed");
    if (this.writer !== null) throw new TypeError("Cannot start TLS during a pending write");
    this.reader.detach();
    this.socket.off("error", this.onSocketError);
    this.socket.off("close", this.onSocketClose);
    this.locallyClosed = true;
    return this.socket;
  }
}

export interface HostNodeSocketOptions {
  ca?: string | readonly string[];
  /**
   * Host-only switch used to exercise the unreportable-provider contract without
   * inventing a second provider. A real provider decides this from the platform.
   */
  reportsNegotiatedProtocol?: boolean;
}

/**
 * A listening socket over `net.Server`.
 *
 * Node is push-shaped: libuv accepts a connection and `'connection'` fires before any
 * consumer is consulted, so this adapter holds what has arrived and hands it out on
 * `accept`. That queue is the reason `backlog` is specified as "waiting for an accept,
 * wherever the waiting happens" rather than "in the kernel" -- on this provider it is
 * partly here, and past the bound the excess is destroyed as the kernel would have
 * dropped it.
 */
class HostNodeSocketListener implements SocketListener {
  readonly address: BoundAddress;
  private readonly server: Server;
  private readonly backlog: number;
  private readonly waiting: Socket[] = [];
  private readonly askers: PromiseWithResolvers<ByteConnection | null>[] = [];
  private closed = false;

  constructor(server: Server, address: BoundAddress, backlog: number) {
    this.server = server;
    this.address = address;
    this.backlog = backlog;
    server.on("connection", (socket: Socket) => {
      const asker = this.askers.shift();
      if (asker !== undefined) {
        asker.resolve(new HostNodeByteConnection(socket));
        return;
      }
      if (this.waiting.length >= this.backlog) {
        socket.destroy();
        return;
      }
      this.waiting.push(socket);
    });
    server.on("error", () => {});
  }

  accept(signal: AbortSignal): Promise<ByteConnection | null> {
    if (signal.aborted) return Promise.reject(signal.reason);
    if (this.closed) return Promise.resolve(null);
    const socket = this.waiting.shift();
    if (socket !== undefined) return Promise.resolve(new HostNodeByteConnection(socket));

    const asker = Promise.withResolvers<ByteConnection | null>();
    this.askers.push(asker);
    // Aborting one accept removes that caller and leaves the listener open.
    const detach = signal[abortSignalSubscribe](() => {
      const index = this.askers.indexOf(asker);
      if (index >= 0) this.askers.splice(index, 1);
      asker.reject(signal.reason);
    });
    return asker.promise.finally(detach);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const socket of this.waiting.splice(0)) socket.destroy();
    // A closed listener is a normal ending, so everyone waiting gets `null`.
    for (const asker of this.askers.splice(0)) asker.resolve(null);
    this.server.close();
  }
}

/** Binds listening sockets on the ordinary-Node host. */
export class HostNodeSocketBinder implements SocketBinder {
  listen(address: ListenAddress, signal: AbortSignal): Promise<SocketListener> {
    signal.throwIfAborted();
    const backlog = address.backlog ?? 511;
    if (!Number.isSafeInteger(backlog) || backlog < 1) {
      return Promise.reject(new RangeError("backlog must be a positive safe integer"));
    }
    const server = createServer();
    const result = Promise.withResolvers<SocketListener>();
    // Node reports a bind failure on `'error'` a tick after `listen()` returns, not from
    // the call. Wiring the rejection to the call instead would turn a taken port into an
    // unhandled event on the server.
    const onError = (error: unknown): void => {
      server.removeListener("listening", onListening);
      result.reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      const bound = server.address();
      if (bound === null || typeof bound === "string") {
        server.close();
        result.reject(new TypeError("The host did not report a bound address"));
        return;
      }
      result.resolve(
        new HostNodeSocketListener(
          server,
          { hostname: bound.address, port: bound.port },
          backlog,
        ),
      );
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: address.hostname, port: address.port, backlog });
    return result.promise;
  }
}

export class HostNodeSocketConnector implements NegotiatingSocketConnector {
  private readonly options: HostNodeSocketOptions;
  /**
   * Node reports `TLSSocket.alpnProtocol`, so this host connector answers. A
   * provider that cannot is offered exactly one protocol instead; this is declared
   * per instance because the same build may run where the platform can and cannot.
   */
  readonly reportsNegotiatedProtocol: boolean;

  constructor(options: HostNodeSocketOptions = {}) {
    this.options = options;
    this.reportsNegotiatedProtocol = options.reportsNegotiatedProtocol ?? true;
  }

  connect(address: ConnectAddress, signal: AbortSignal): Promise<ByteConnection> {
    return this.connectNegotiated(address, signal).then((result) => result.connection);
  }

  connectNegotiated(address: ConnectAddress, signal: AbortSignal): Promise<NegotiatedConnection> {
    if (signal.aborted) return Promise.reject(signal.reason);
    if (
      !Number.isInteger(address.connectTimeoutMs) ||
      address.connectTimeoutMs < 1 ||
      address.connectTimeoutMs > MAX_TIMER_DELAY_MS
    )
      return Promise.reject(new RangeError(`Connect timeout must be 1..${MAX_TIMER_DELAY_MS} ms`));
    return new Promise<NegotiatedConnection>((resolve, reject) => {
      const ca = typeof this.options.ca === "string" ? this.options.ca : this.options.ca?.slice();
      const physicalHostname = address.resolvedAddress ?? address.hostname;
      const socket = address.secure
        ? tlsConnect({
            host: physicalHostname,
            port: address.port,
            servername: isIP(address.hostname) === 0 ? address.hostname : undefined,
            rejectUnauthorized: true,
            minVersion: "TLSv1.2",
            ALPNProtocols: requiredAlpn(address).slice(),
            ca,
          })
        : tcpConnect({ host: physicalHostname, port: address.port });
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
      dispose = signal[abortSignalSubscribe](() => finishError(signal.reason));
      socket.once(address.secure ? "secureConnect" : "connect", () => {
        if (settled) return;
        if (signal.aborted) {
          finishError(signal.reason);
          return;
        }
        let protocol: string | null = null;
        let certificateNames: readonly string[] = [];
        if (address.secure) {
          try {
            if (!("alpnProtocol" in socket)) throw new TypeError("TLS socket has no ALPN result");
            validateAlpn(socket.alpnProtocol, requiredAlpn(address));
            protocol = this.reportsNegotiatedProtocol
              ? selectedProtocol(socket.alpnProtocol)
              : null;
            certificateNames = dnsNamesOf(socket);
          } catch (error) {
            finishError(error);
            return;
          }
        }
        settled = true;
        const connection = new HostNodeByteConnection(socket);
        cleanup();
        resolve({ connection, protocol, certificateNames, endpoint: physicalHostname });
      });
    });
  }
}

/** Host-only TLS primitive used to test shared CONNECT/SOCKS tunnel policy. */
export class HostNodeTlsUpgrader implements NegotiatingTlsUpgrader {
  private readonly options: HostNodeSocketOptions;
  /** Same declaration and same per-instance rule as the connector. */
  readonly reportsNegotiatedProtocol: boolean;

  constructor(options: HostNodeSocketOptions = {}) {
    this.options = options;
    this.reportsNegotiatedProtocol = options.reportsNegotiatedProtocol ?? true;
  }

  upgrade(
    connection: ByteConnection,
    target: ConnectAddress,
    signal: AbortSignal,
  ): Promise<ByteConnection> {
    return this.upgradeNegotiated(connection, target, signal).then((result) => result.connection);
  }

  upgradeNegotiated(
    connection: ByteConnection,
    target: ConnectAddress,
    signal: AbortSignal,
  ): Promise<NegotiatedConnection> {
    if (!(connection instanceof HostNodeByteConnection)) {
      return Promise.reject(new TypeError("Host TLS requires a HostNodeByteConnection"));
    }
    if (!target.secure) return Promise.reject(new TypeError("TLS target must be secure"));
    if (signal.aborted) {
      connection.close();
      return Promise.reject(signal.reason);
    }
    let raw: Socket;
    try {
      raw = connection.detachForTls();
    } catch (error) {
      connection.close();
      return Promise.reject(error);
    }
    return new Promise<NegotiatedConnection>((resolve, reject) => {
      const ca = typeof this.options.ca === "string" ? this.options.ca : this.options.ca?.slice();
      const socket = tlsConnect({
        socket: raw,
        servername: isIP(target.hostname) === 0 ? target.hostname : undefined,
        checkServerIdentity: (_hostname, certificate) =>
          checkServerIdentity(target.hostname, certificate),
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        ALPNProtocols: requiredAlpn(target).slice(),
        ca,
      });
      let settled = false;
      let unsubscribe = (): void => {};
      const cleanup = (): void => {
        unsubscribe();
        socket.off("error", fail);
        socket.off("close", closed);
        socket.off("secureConnect", connected);
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.on("error", () => {});
        socket.destroy();
        reject(error);
      };
      const closed = (): void => fail(new TypeError("TLS tunnel closed during handshake"));
      const connected = (): void => {
        if (settled) return;
        if (signal.aborted) {
          fail(signal.reason);
          return;
        }
        let protocol: string | null = null;
        let certificateNames: readonly string[] = [];
        try {
          validateAlpn(socket.alpnProtocol, requiredAlpn(target));
          protocol = this.reportsNegotiatedProtocol ? selectedProtocol(socket.alpnProtocol) : null;
          certificateNames = dnsNamesOf(socket);
        } catch (error) {
          fail(error);
          return;
        }
        settled = true;
        cleanup();
        resolve({ connection: new HostNodeByteConnection(socket), protocol, certificateNames });
      };
      socket.once("error", fail);
      socket.once("close", closed);
      socket.once("secureConnect", connected);
      unsubscribe = signal[abortSignalSubscribe](() => fail(signal.reason));
    });
  }
}

/** Host-only resolver used to exercise the shared DNS policy without delegating Fetch. */
export class HostNodeDnsResolver implements DnsResolver {
  private readonly ttlMilliseconds: number;

  constructor(ttlMilliseconds = 10000) {
    if (!Number.isFinite(ttlMilliseconds) || ttlMilliseconds < 0) {
      throw new RangeError("DNS TTL must be a non-negative finite number");
    }
    this.ttlMilliseconds = ttlMilliseconds;
  }

  resolve(
    hostname: string,
    options: DnsResolveOptions,
    signal: AbortSignal,
  ): Promise<readonly DnsAddress[]> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<readonly DnsAddress[]>((resolve, reject) => {
      let settled = false;
      const unsubscribe = signal[abortSignalSubscribe](() => {
        if (settled) return;
        settled = true;
        reject(signal.reason);
      });
      const family = options.families.length === 1 ? options.families[0] : 0;
      dnsLookup(hostname, { all: true, family, order: "verbatim" }, (error, addresses) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        if (error !== null) {
          reject(error);
          return;
        }
        const result: DnsAddress[] = [];
        for (const address of addresses) {
          if (result.length >= options.maximumAddresses) break;
          if (address.family !== 4 && address.family !== 6) continue;
          result.push({
            address: address.address,
            family: address.family,
            ttlMilliseconds: this.ttlMilliseconds,
          });
        }
        resolve(result);
      });
    });
  }
}

/**
 * How this host answers `systemProxyFor`.
 *
 * The default is `null` for every URL, and that is the honest answer rather than a stub:
 * Node has no system proxy API. What a Node process has is `HTTP_PROXY`, `HTTPS_PROXY` and
 * `NO_PROXY`, which `EnvironmentProxyPolicy` already reads -- and wiring those in here too
 * would give one question two answers that could disagree, which is the arrangement this
 * runtime avoids everywhere else.
 *
 * A resolver can be supplied so that a host embedder with a real source of system settings,
 * or a test, can provide one.
 */
export type HostNodeSystemProxyResolver = (url: URLRecord) => string | null;

export function createHostNodePrimitives(
  options: HostNodeSocketOptions = {},
  reportError?: (error: unknown) => void,
  systemProxyFor: HostNodeSystemProxyResolver = () => null,
): PlatformPrimitives {
  return {
    sockets: new HostNodeSocketConnector(options),
    random: hostNodeRandom,
    scheduler: new HostNodeScheduler(reportError),
    urls: hostNodeURLs,
    nativeLineEnding: EOL === "\r\n" ? "\r\n" : "\n",
    wallTimeMilliseconds: Date.now,
    // `performance.now()`: milliseconds since `performance.timeOrigin`, backed by
    // `uv_hrtime`, so a system clock change cannot move it. Not `process.hrtime.bigint()`,
    // whose origin is documented as "an arbitrary time in the past" and which returns a
    // `BigInt` that two other providers would have to implement.
    monotonicMilliseconds: () => performance.now(),
    systemProxyFor,
  };
}

/** Host digest primitive for subresource integrity in conformance tests. */
export const hostNodeDigest: DigestProvider = {
  algorithms: ["sha256", "sha384", "sha512"],
  digest(algorithm, bytes) {
    if (!this.algorithms.includes(algorithm)) {
      return Promise.reject(new TypeError("Unsupported digest algorithm: " + algorithm));
    }
    const hash = createHash(algorithm.replace("sha", "sha"));
    hash.update(bytes);
    const result = hash.digest();
    return Promise.resolve(new Uint8Array(result.buffer, result.byteOffset, result.byteLength));
  },
};
