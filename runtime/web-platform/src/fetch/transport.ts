import type { AbortSignal } from "../core/abort.ts";
import type { URLRecord } from "../provider/primitives.ts";
import type { ReadableStream } from "../streams/readable.ts";
import type { HeaderEntry } from "./headers.ts";

/** A body that can open an independent stream for each transport attempt. */
export interface TransportBodySource {
  readonly length: number;

  open(): ReadableStream<Uint8Array>;
}

export type TransportErrorCode =
  | "ECONNRESET"
  | "ECONNREFUSED"
  | "ENOTFOUND"
  | "ENETDOWN"
  | "ENETUNREACH"
  | "EHOSTDOWN"
  | "EHOSTUNREACH"
  | "EPIPE"
  | "UND_ERR_SOCKET";

/** Provider errors use this typed envelope; platform facades translate native errors into it. */
export class TransportError extends Error {
  readonly code: TransportErrorCode;

  constructor(code: TransportErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "TransportError";
    this.code = code;
  }
}

export interface TransportRequest {
  readonly url: URLRecord;
  readonly method: string;
  readonly headers: readonly HeaderEntry[];
  readonly body: ReadableStream<Uint8Array> | null;
  readonly bodyLength: number | null;
  /** Absent/null means the body is one-shot. Providers do not consume this metadata. */
  readonly replayBody?: TransportBodySource | null;
  readonly signal: AbortSignal;
}

export interface TransportResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly HeaderEntry[];
  readonly body: ReadableStream<Uint8Array> | null;
  /** Settles after the body terminates; absent when a provider cannot expose trailers. */
  readonly trailers?: Promise<readonly HeaderEntry[]>;
}

/** No redirects, cookie jar, automatic retry or authentication in this contract. */
export interface FetchTransport {
  dispatch(request: TransportRequest): Promise<TransportResponse>;
}

/** Optional native decompressor; coding decisions and order belong to Fetch. */
export interface ContentDecoder {
  /** Exact HTTP content-coding tokens this provider is prepared to decode. */
  readonly codings: readonly string[];

  supports(coding: string): boolean;

  decode(coding: string, source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array>;
}
