import type { FetchTransport, TransportRequest, TransportResponse } from "../fetch/transport.ts";
import type { FetchInterceptor } from "./interceptor.ts";
import {
  collectResponseBody,
  settleResponseTrailers,
  validateResponseBodyLimit,
} from "./response-body.ts";

export interface DumpOptions {
  readonly maximumBytes?: number;
}

/** Consume and discard a complete response under an explicit byte bound. */
export class DumpInterceptor implements FetchInterceptor {
  private readonly maximumBytes: number;

  constructor(options: DumpOptions = {}) {
    this.maximumBytes = options.maximumBytes ?? 1024 * 1024;
    validateResponseBodyLimit(this.maximumBytes);
  }

  async dispatch(request: TransportRequest, next: FetchTransport): Promise<TransportResponse> {
    const response = await next.dispatch(request);
    await collectResponseBody(response, request.signal, this.maximumBytes);
    const trailers = await settleResponseTrailers(response, request.signal);
    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: null,
      trailers: trailers === undefined ? undefined : Promise.resolve(trailers),
    };
  }
}
