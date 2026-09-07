import type { AbortSignal } from "../core/abort.ts";
import type { URLRecord } from "../provider/primitives.ts";

export type SocketMessage = { kind: "text"; data: string } | { kind: "binary"; data: Uint8Array };

export interface SocketClose {
  kind: "close";
  code: number;
  reason: string;
  wasClean: boolean;
  failed: boolean;
}

export type SocketIncoming = SocketMessage | SocketClose;

export interface WebSocketHandshake {
  url: URLRecord;
  protocols: readonly string[];
  origin: string;
}

/**
 * One provider-owned raw-DEFLATE context. `process()` performs a synchronous
 * flush and returns every byte produced by that flush. The caller supplies a
 * hard output bound; providers must stop before retaining unbounded output.
 */
export interface WebSocketDeflateContext {
  process(input: Uint8Array, maxOutputBytes: number): Promise<Uint8Array>;

  reset(): void;

  close(): void;
}

/** Native raw-DEFLATE contexts; RFC 7692 framing and policy remain shared. */
export interface WebSocketDeflateProvider {
  createDeflater(windowBits: number): WebSocketDeflateContext;

  createInflater(windowBits: number): WebSocketDeflateContext;
}

/** Public WebSocket state does not know whether the provider owns RFC 6455 framing. */
export interface WebSocketSession {
  readonly protocol: string;
  readonly extensions: string;

  next(): Promise<SocketIncoming>;

  send(message: SocketMessage): Promise<void>;

  close(code: number | null, reason: string): Promise<void>;

  abort(): void;
}

export interface WebSocketTransport {
  connect(handshake: WebSocketHandshake, signal: AbortSignal): Promise<WebSocketSession>;
}
