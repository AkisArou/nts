import type { AbortSignal } from "./abort.ts";

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
  readonly hostname: string; // IPv6 has no surrounding brackets at this boundary.
  readonly port: number;
  readonly secure: boolean;
  readonly connectTimeoutMs: number;
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
export interface PlatformPrimitives {
  readonly sockets: SocketConnector;
  readonly random: RandomSource;
  readonly scheduler: Scheduler;
  readonly urls: URLParser;
}
