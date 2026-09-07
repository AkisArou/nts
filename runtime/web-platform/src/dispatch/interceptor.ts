import type { FetchTransport, TransportRequest, TransportResponse } from "../fetch/transport.ts";

/** A shared policy layer. The first interceptor is the outermost request observer. */
export interface FetchInterceptor {
  dispatch(request: TransportRequest, next: FetchTransport): Promise<TransportResponse>;
}

class InterceptorTransport implements FetchTransport {
  private readonly interceptor: FetchInterceptor;
  private readonly next: FetchTransport;

  constructor(interceptor: FetchInterceptor, next: FetchTransport) {
    this.interceptor = interceptor;
    this.next = next;
  }

  dispatch(request: TransportRequest): Promise<TransportResponse> {
    return this.interceptor.dispatch(request, this.next);
  }
}

/**
 * Request flow follows array order; response and error flow unwind in reverse.
 * The input array is copied structurally by building immutable transport layers.
 */
export function composeFetchTransport(
  transport: FetchTransport,
  interceptors: readonly FetchInterceptor[],
): FetchTransport {
  let result = transport;
  for (let index = interceptors.length - 1; index >= 0; index--) {
    const interceptor = interceptors[index];
    if (interceptor !== undefined) result = new InterceptorTransport(interceptor, result);
  }
  return result;
}
