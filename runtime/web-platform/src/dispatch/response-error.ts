import { TextDecoder } from "../core/encoding.ts";
import { Headers } from "../fetch/headers.ts";
import type { FetchTransport, TransportRequest, TransportResponse } from "../fetch/transport.ts";
import type { FetchInterceptor } from "./interceptor.ts";
import {
  collectResponseBody,
  settleResponseTrailers,
  validateResponseBodyLimit,
} from "./response-body.ts";

export type ResponseErrorBody = string | Uint8Array | null;

export interface ResponseErrorOptions {
  readonly maximumBodyBytes?: number;
}

export class ResponseError extends Error {
  readonly code = "UND_ERR_RESPONSE";
  readonly statusCode: number;
  readonly statusMessage: string;
  readonly headers: Headers;
  readonly body: ResponseErrorBody;

  constructor(response: TransportResponse, body: ResponseErrorBody) {
    super("Response Error");
    this.name = "ResponseError";
    this.statusCode = response.status;
    this.statusMessage = response.statusText;
    this.headers = new Headers(response.headers);
    this.body = body;
  }
}

function errorBody(response: TransportResponse, bytes: Uint8Array): ResponseErrorBody {
  if (response.body === null) return null;
  const contentType = new Headers(response.headers).get("content-type")?.toLowerCase() ?? "";
  const separator = contentType.indexOf(";");
  const essence = (separator < 0 ? contentType : contentType.slice(0, separator)).trim();
  if (essence === "text/plain" || essence === "application/json" || essence.endsWith("+json")) {
    return new TextDecoder().decode(bytes);
  }
  return bytes;
}

/** Convert status responses at or above 400 into a stable, bounded typed error. */
export class ResponseErrorInterceptor implements FetchInterceptor {
  private readonly maximumBodyBytes: number;

  constructor(options: ResponseErrorOptions = {}) {
    this.maximumBodyBytes = options.maximumBodyBytes ?? 1024 * 1024;
    validateResponseBodyLimit(this.maximumBodyBytes);
  }

  async dispatch(request: TransportRequest, next: FetchTransport): Promise<TransportResponse> {
    const response = await next.dispatch(request);
    if (response.status < 400) return response;
    const bytes = await collectResponseBody(response, request.signal, this.maximumBodyBytes);
    await settleResponseTrailers(response, request.signal);
    throw new ResponseError(response, errorBody(response, bytes));
  }
}
