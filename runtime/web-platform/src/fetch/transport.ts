import type { AbortSignal } from "../core/abort.ts";
import type { URLRecord } from "../provider/primitives.ts";
import type { ReadableStream } from "../streams/readable.ts";
import type { HeaderEntry } from "./headers.ts";

export interface TransportRequest {
  readonly url: URLRecord;
  readonly method: string;
  readonly headers: readonly HeaderEntry[];
  readonly body: ReadableStream<Uint8Array> | null;
  readonly bodyLength: number | null;
  readonly signal: AbortSignal;
}

export interface TransportResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly HeaderEntry[];
  readonly body: ReadableStream<Uint8Array> | null;
}

/** No redirects, cookie jar, automatic retry or authentication in this contract. */
export interface FetchTransport {
  dispatch(request: TransportRequest): Promise<TransportResponse>;
}

/** Optional native decompressor; coding decisions and order belong to Fetch. */
export interface ContentDecoder {
  supports(coding: string): boolean;

  decode(coding: string, source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array>;
}
