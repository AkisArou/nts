import type { Scheduler } from "../provider/primitives.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import type { FetchTransport, TransportRequest, TransportResponse } from "../fetch/transport.ts";
import { ignoreRejection } from "../core/promise.ts";
import type { FetchInterceptor } from "./interceptor.ts";

const sensitiveHeaderNames = [
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
] as const;

export interface DispatchDiagnosticRequest {
  readonly method: string;
  readonly url: string;
  readonly queryRedacted: boolean;
  readonly headers: readonly HeaderEntry[];
  readonly bodyLength: number | null;
}

/** Object identity, rather than the display sequence, identifies one dispatch. */
export class DispatchDiagnosticContext {
  readonly sequence: number;
  readonly request: DispatchDiagnosticRequest;

  constructor(sequence: number, request: DispatchDiagnosticRequest) {
    this.sequence = sequence;
    this.request = request;
  }
}

export interface DispatchRequestCreatedEvent {
  readonly type: "request:create";
  readonly context: DispatchDiagnosticContext;
}

export interface DispatchResponseHeadersEvent {
  readonly type: "response:headers";
  readonly context: DispatchDiagnosticContext;
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly HeaderEntry[];
}

export interface DispatchResponseTrailersEvent {
  readonly type: "response:trailers";
  readonly context: DispatchDiagnosticContext;
  readonly headers: readonly HeaderEntry[];
}

export interface DispatchRequestErrorEvent {
  readonly type: "request:error";
  readonly context: DispatchDiagnosticContext;
  readonly phase: "dispatch" | "trailers";
  readonly error: unknown;
}

export type DispatchDiagnosticEvent =
  | DispatchRequestCreatedEvent
  | DispatchResponseHeadersEvent
  | DispatchResponseTrailersEvent
  | DispatchRequestErrorEvent;

/** Provider and Node facades adapt this typed sink; shared code has no host event bus. */
export interface DispatchDiagnosticObserver {
  publish(event: DispatchDiagnosticEvent): void;
}

export interface DispatchDiagnosticsPolicy {
  /** Query values are omitted by default because they commonly carry credentials. */
  readonly includeQueryString?: boolean;
  /** These names are redacted in addition to the built-in credential headers. */
  readonly additionalRedactedHeaderNames?: readonly string[];
}

export interface DiagnosticsInterceptorOptions extends DispatchDiagnosticsPolicy {
  readonly observer: DispatchDiagnosticObserver;
  readonly scheduler: Scheduler;
}

function includes(values: readonly string[], candidate: string): boolean {
  for (const value of values) if (value === candidate) return true;
  return false;
}

function redactedHeaders(
  entries: readonly HeaderEntry[],
  additionalNames: readonly string[],
): HeaderEntry[] {
  const result: HeaderEntry[] = [];
  for (const [name, value] of entries) {
    const lower = name.toLowerCase();
    result.push([
      name,
      includes(sensitiveHeaderNames, lower) || includes(additionalNames, lower)
        ? "[REDACTED]"
        : value,
    ]);
  }
  return result;
}

function diagnosticURL(
  request: TransportRequest,
  includeQueryString: boolean,
): {
  readonly value: string;
  readonly queryRedacted: boolean;
} {
  const url = request.url;
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { value: url.protocol + "<redacted>", queryRedacted: url.search !== "" };
  }
  const queryRedacted = !includeQueryString && url.search !== "";
  return {
    value:
      url.protocol +
      "//" +
      url.host +
      url.pathname +
      (includeQueryString ? url.search : queryRedacted ? "?<redacted>" : ""),
    queryRedacted,
  };
}

/**
 * Typed, environment-local request diagnostics.
 *
 * The interceptor deliberately does not wrap request or response bodies: observing a
 * stream by acquiring a reader or substituting a proxy stream changes ownership and
 * scheduling. Body-sent and connection events therefore belong at provider delivery
 * points and can feed the same observer without weakening the transport contract.
 */
export class DiagnosticsInterceptor implements FetchInterceptor {
  private readonly observer: DispatchDiagnosticObserver;
  private readonly scheduler: Scheduler;
  private readonly includeQueryString: boolean;
  private readonly additionalRedactedHeaderNames: readonly string[];
  private nextSequence = 1;

  constructor(options: DiagnosticsInterceptorOptions) {
    this.observer = options.observer;
    this.scheduler = options.scheduler;
    this.includeQueryString = options.includeQueryString === true;
    const additional: string[] = [];
    for (const name of options.additionalRedactedHeaderNames ?? []) {
      if (typeof name !== "string") {
        throw new TypeError("Additional redacted header names must be strings");
      }
      additional.push(name.toLowerCase());
    }
    this.additionalRedactedHeaderNames = additional;
  }

  dispatch(request: TransportRequest, next: FetchTransport): Promise<TransportResponse> {
    const context = this.context(request);
    this.publish({ type: "request:create", context });

    let pending: Promise<TransportResponse>;
    try {
      pending = next.dispatch(request);
    } catch (error) {
      this.publish({ type: "request:error", context, phase: "dispatch", error });
      throw error;
    }

    return pending.then(
      (response) => {
        this.publish({
          type: "response:headers",
          context,
          status: response.status,
          statusText: response.statusText,
          headers: redactedHeaders(response.headers, this.additionalRedactedHeaderNames),
        });
        this.observeTrailers(context, response);
        return response;
      },
      (error) => {
        this.publish({ type: "request:error", context, phase: "dispatch", error });
        throw error;
      },
    );
  }

  private context(request: TransportRequest): DispatchDiagnosticContext {
    const diagnostic = diagnosticURL(request, this.includeQueryString);
    const context = new DispatchDiagnosticContext(this.nextSequence, {
      method: request.method,
      url: diagnostic.value,
      queryRedacted: diagnostic.queryRedacted,
      headers: redactedHeaders(request.headers, this.additionalRedactedHeaderNames),
      bodyLength: request.bodyLength,
    });
    this.nextSequence = this.nextSequence === Number.MAX_SAFE_INTEGER ? 1 : this.nextSequence + 1;
    return context;
  }

  private observeTrailers(context: DispatchDiagnosticContext, response: TransportResponse): void {
    const trailers = response.trailers;
    if (trailers === undefined) return;
    const observation = trailers.then(
      (headers) => {
        this.publish({
          type: "response:trailers",
          context,
          headers: redactedHeaders(headers, this.additionalRedactedHeaderNames),
        });
      },
      (error) => {
        this.publish({ type: "request:error", context, phase: "trailers", error });
      },
    );
    ignoreRejection(observation);
  }

  private publish(event: DispatchDiagnosticEvent): void {
    try {
      this.observer.publish(event);
    } catch (error) {
      try {
        this.scheduler.reportError(error);
      } catch {
        // A broken diagnostic sink and reporter cannot alter transport semantics.
      }
    }
  }
}
