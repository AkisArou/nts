import type { AbortSignal } from "../core/abort.ts";
import type { URLRecord } from "../provider/primitives.ts";
import type { ReadableStream } from "../streams/readable.ts";
import type { HeaderEntry } from "./headers.ts";

/** A body that can open an independent stream for each transport attempt. */
export interface TransportBodySource {
  readonly length: number;

  open(): ReadableStream<Uint8Array>;
}

/**
 * A one-shot request body put somewhere it can be read more than once.
 *
 * Declared here rather than where it is used because both ends need it and neither
 * should have to import the other: a retry policy must not know about storage, and
 * storage must not know about dispatch.
 */
export interface HeldRequestBody {
  readonly source: TransportBodySource;

  /** Releases whatever holding the body cost. Idempotent. */
  release(): Promise<void>;
}

/**
 * Somewhere a streaming request body can be held so that it can be replayed.
 *
 * Nothing here guesses: a body is held only because a caller supplied a place to hold
 * it, which is why an unreplayable body remains an error rather than becoming a silent
 * buffer the size of whatever arrived.
 */
export interface RequestBodyStore {
  hold(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<HeldRequestBody>;
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

/**
 * An interim response received before the final one.
 *
 * `103 Early Hints` is the reason this exists: it carries `Link` fields a client is
 * meant to act on while the origin is still working, and a client that never sees it
 * cannot. Discarding interim responses is safe but it throws away the only thing they
 * are for.
 */
export interface TransportInformationalResponse {
  readonly status: number;
  readonly headers: readonly HeaderEntry[];
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
  /**
   * Called for each interim (1xx) response, in the order received, before the final
   * one. Never called for `101`, which is a protocol switch rather than a hint.
   *
   * Optional because a provider that cannot surface interim responses simply does not
   * call it, and because Fetch itself exposes no such thing — this is the dispatcher
   * layer, where Undici's `onInfo` lives. An exception from the callback is reported
   * and does not change the request.
   */
  readonly onInformational?: (response: TransportInformationalResponse) => void;
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
