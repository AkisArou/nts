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
 *
 * **Which order to put them in is not free, and three of the constraints are
 * demonstrable rather than stylistic.** Each is a test in
 * `tooling/conformance/web-platform/test/interceptor-order.test.mjs`, which runs both
 * arrangements and asserts that the wrong one misbehaves — so these are claims with
 * their own controls rather than advice.
 *
 * - `ResponseErrorInterceptor` must be **outside** `RetryInterceptor`. It throws on any
 *   status at or above 400, so from the inside it converts a retryable `503` into an
 *   exception before retry ever sees a status to retry.
 * - `ResponseErrorInterceptor` must be **outside** `AuthenticationInterceptor`, for the
 *   same reason with a sharper edge: a `401` is a challenge, and thrown from the inside
 *   it is an error the authenticator is never offered.
 * - `AuthenticationInterceptor` should be **outside** `RetryInterceptor`. Both orders
 *   work and the difference is arithmetic, but it runs the opposite way to the guess
 *   that a challenge is best answered close to the transport. A `401` is not a
 *   retryable status, so retry never loops on a challenge; what happens instead is that
 *   with retry on the outside, *every* retry of a retryable failure re-runs the whole
 *   authentication exchange from unauthenticated. With authentication outside, the
 *   credential is obtained once and retry re-sends a request that already carries it.
 *   The difference only shows when a retryable status and a challenge both occur, which
 *   is exactly what the test scripts.
 *
 * `DumpInterceptor` is not on that list because it is not an ordering question but an
 * exclusion: it returns `body: null`, so anything outside it that needs a body — which
 * is exactly `ResponseErrorInterceptor`, whose error carries one — gets nothing. Compose
 * one or the other.
 *
 * Nothing is claimed here about where `DiagnosticsInterceptor` or
 * `DeduplicationInterceptor` belong. Both have defensible positions and this lane has
 * not demonstrated either, so saying so is more useful than a preference dressed as a
 * rule.
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
