import type { AbortSignal } from "../core/abort.ts";

/** A provider-owned cancellation token. Repeated cancellation is harmless. */
export interface CancelHandle {
  cancel(): void;
}

/** enqueue MUST enqueue a task, never invoke inline. Timer cancellation is idempotent. */
export interface Scheduler {
  enqueue(task: () => void): void;

  delay(milliseconds: number, task: () => void): CancelHandle;

  reportError(error: unknown): void;
}

export interface RandomSource {
  fill(bytes: Uint8Array): void;
}

export interface URLRecord {
  readonly href: string;
  readonly protocol: string;
  readonly hostname: string;
  readonly port: string;
  readonly host: string;
  readonly origin: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly username: string;
  readonly password: string;
}

/** Bind the project's WHATWG URL implementation here, not java.net.URI. */
export interface URLParser {
  parse(input: string, base?: string): URLRecord;
}

export interface ConnectAddress {
  /** Logical authority used for pooling, HTTP Host, TLS SNI and certificate verification. */
  readonly hostname: string; // IPv6 has no surrounding brackets at this boundary.
  readonly port: number;
  readonly secure: boolean;
  readonly connectTimeoutMs: number;
  /** Ordered application protocols required of a TLS connection. */
  readonly alpnProtocols?: readonly string[];
  /** Optional physical endpoint selected by the shared resolver; never use it as TLS identity. */
  readonly resolvedAddress?: string;
  readonly resolvedFamily?: DnsAddressFamily;
}

export type DnsAddressFamily = 4 | 6;

export interface DnsAddress {
  readonly address: string;
  readonly family: DnsAddressFamily;
  /** Provider-reported positive-cache lifetime. Zero keeps the answer request-local. */
  readonly ttlMilliseconds: number;
}

export interface DnsResolveOptions {
  readonly families: readonly DnsAddressFamily[];
  /** Provider must not materialize more records than this shared-policy bound. */
  readonly maximumAddresses: number;
}

/** Provider-owned nonblocking DNS primitive. Shared code owns cache and selection policy. */
export interface DnsResolver {
  resolve(
    hostname: string,
    options: DnsResolveOptions,
    signal: AbortSignal,
  ): Promise<readonly DnsAddress[]>;
}

/**
 * One concurrent read and one concurrent write are allowed. No overlapping reads
 * or overlapping writes. read() transfers ownership of a nonempty chunk of at
 * most maxBytes bytes; null means EOF. write() borrows data until it settles and
 * returns 1..data.length. close() is idempotent and MUST interrupt pending I/O.
 */
export interface ByteConnection {
  readonly closed: boolean;

  read(maxBytes: number): Promise<Uint8Array | null>;

  write(data: Uint8Array): Promise<number>;

  close(): void;
}

export interface SocketConnector {
  connect(address: ConnectAddress, signal: AbortSignal): Promise<ByteConnection>;
}

/**
 * Provider-owned TLS over an already connected byte stream.
 *
 * The target carries the logical hostname used for SNI and certificate
 * verification. The upgrader consumes the input connection immediately and must
 * close it if the handshake fails; callers never reuse the plaintext handle.
 */
export interface TlsUpgrader {
  upgrade(
    connection: ByteConnection,
    target: ConnectAddress,
    signal: AbortSignal,
  ): Promise<ByteConnection>;
}

export interface PlatformPrimitives {
  readonly sockets: SocketConnector;
  readonly random: RandomSource;
  readonly scheduler: Scheduler;
  readonly urls: URLParser;
  readonly nativeLineEnding: "\n" | "\r\n";

  wallTimeMilliseconds(): number;
}
