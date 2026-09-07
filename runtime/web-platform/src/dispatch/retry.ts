import { parseHTTPDate } from "../cache/freshness.ts";
import type { AbortSignal } from "../core/abort.ts";
import { ignoreRejection } from "../core/promise.ts";
import { Headers } from "../fetch/headers.ts";
import type {
  FetchTransport,
  TransportBodySource,
  TransportErrorCode,
  TransportRequest,
  TransportResponse,
} from "../fetch/transport.ts";
import { TransportError } from "../fetch/transport.ts";
import type { CancelHandle, Scheduler } from "../provider/primitives.ts";
import type { ReadableStream } from "../streams/readable.ts";
import type { FetchInterceptor } from "./interceptor.ts";

const defaultMethods = ["GET", "HEAD", "OPTIONS", "PUT", "DELETE", "TRACE"] as const;
const defaultStatusCodes = [500, 502, 503, 504, 429] as const;
const defaultErrorCodes: readonly TransportErrorCode[] = [
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ENETDOWN",
  "ENETUNREACH",
  "EHOSTDOWN",
  "EHOSTUNREACH",
  "EPIPE",
  "UND_ERR_SOCKET",
];

export interface RetryContext {
  readonly request: TransportRequest;
  /** One for the first retry, not the initial attempt. */
  readonly retryCount: number;
  readonly proposedDelayMilliseconds: number;
  readonly response: TransportResponse | null;
  readonly error: unknown;
}

export interface RetryDecision {
  readonly retry: boolean;
  readonly delayMilliseconds?: number;
}

export type RetryDecider = (context: RetryContext) => RetryDecision | Promise<RetryDecision>;
export type RetryObserver = (context: RetryContext) => void;
export type RetryErrorClassifier = (error: unknown) => boolean;

export interface RetryOptions {
  readonly scheduler: Scheduler;
  readonly maxRetries?: number;
  readonly minTimeoutMilliseconds?: number;
  readonly maxTimeoutMilliseconds?: number;
  readonly timeoutFactor?: number;
  readonly retryAfter?: boolean;
  readonly methods?: readonly string[];
  readonly statusCodes?: readonly number[];
  readonly errorCodes?: readonly TransportErrorCode[];
  readonly throwOnStatusExhaustion?: boolean;
  readonly nowMilliseconds?: () => number;
  readonly decide?: RetryDecider;
  readonly classifyError?: RetryErrorClassifier;
  readonly onRetry?: RetryObserver;
}

export class RetryExhaustedError extends Error {
  readonly code = "UND_ERR_REQ_RETRY";
  readonly statusCode: number;
  readonly retryCount: number;
  readonly headers: Headers;

  constructor(response: TransportResponse, retryCount: number) {
    super("Retry attempts exhausted for HTTP status " + String(response.status));
    this.name = "RetryExhaustedError";
    this.statusCode = response.status;
    this.retryCount = retryCount;
    this.headers = new Headers(response.headers);
  }
}

export class UnreplayableRequestError extends Error {
  readonly code = "UND_ERR_REQ_RETRY";

  constructor() {
    super("Request body cannot be replayed for a retry");
    this.name = "UnreplayableRequestError";
  }
}

class RetryCancellation extends Error {
  constructor(status: number) {
    super("HTTP status " + String(status) + " is being retried");
    this.name = "RetryCancellation";
  }
}

function validateCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(name + " must be a non-negative safe integer");
  }
}

function validateDelay(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(name + " must be a non-negative finite number");
  }
}

function validateFactor(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("Retry timeout factor must be a positive finite number");
  }
}

function includesNumber(values: readonly number[], candidate: number): boolean {
  for (const value of values) if (value === candidate) return true;
  return false;
}

function includesErrorCode(
  values: readonly TransportErrorCode[],
  candidate: TransportErrorCode,
): boolean {
  for (const value of values) if (value === candidate) return true;
  return false;
}

function defaultNow(): number {
  return 0;
}

function retryAfterMilliseconds(
  response: TransportResponse,
  nowMilliseconds: number,
): number | null {
  const value = new Headers(response.headers).get("retry-after");
  if (value === null) return null;
  if (/^[0-9]+$/.test(value)) {
    const seconds = Number(value);
    // An arbitrarily large decimal delay is still valid. Returning infinity lets
    // the caller clamp it without depending on bigint support in this layer.
    if (!Number.isFinite(seconds)) return Number.POSITIVE_INFINITY;
    return seconds * 1000;
  }
  const date = parseHTTPDate(value, nowMilliseconds);
  return date === null ? null : Math.max(0, date - nowMilliseconds);
}

async function waitForRetry(
  scheduler: Scheduler,
  delayMilliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const result = Promise.withResolvers<void>();
  let timer: CancelHandle | null = null;
  const unsubscribe = signal.subscribe(() => {
    timer?.cancel();
    result.reject(signal.reason);
  });
  timer = scheduler.delay(delayMilliseconds, result.resolve);
  try {
    await result.promise;
    signal.throwIfAborted();
  } finally {
    timer.cancel();
    unsubscribe();
  }
}

function requestForRetry(request: TransportRequest): TransportRequest {
  if (request.body === null) {
    return {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: null,
      bodyLength: request.bodyLength,
      replayBody: request.replayBody,
      signal: request.signal,
    };
  }
  const source = request.replayBody;
  if (source === undefined || source === null) throw new UnreplayableRequestError();
  validateReplaySource(source, request.bodyLength);
  return {
    url: request.url,
    method: request.method,
    headers: request.headers,
    body: source.open(),
    bodyLength: source.length,
    replayBody: source,
    signal: request.signal,
  };
}

function ensureReplayable(request: TransportRequest): void {
  if (request.body === null) return;
  const source = request.replayBody;
  if (source === undefined || source === null) throw new UnreplayableRequestError();
  validateReplaySource(source, request.bodyLength);
}

function validateReplaySource(source: TransportBodySource, declaredLength: number | null): void {
  if (!Number.isSafeInteger(source.length) || source.length < 0) {
    throw new TypeError("Replayable request body has an invalid length");
  }
  if (declaredLength !== null && source.length !== declaredLength) {
    throw new TypeError("Replayable request body length does not match the request");
  }
}

function responseBody(response: TransportResponse): ReadableStream<Uint8Array> | null {
  return response.body;
}

async function discardResponse(response: TransportResponse, reason: unknown): Promise<void> {
  const body = responseBody(response);
  if (body !== null) await body.cancel(reason);
  if (response.trailers !== undefined) ignoreRejection(response.trailers);
}

async function throwIfResponseAborted(
  response: TransportResponse,
  signal: AbortSignal,
): Promise<void> {
  if (!signal.aborted) return;
  await discardResponse(response, signal.reason);
  throw signal.reason;
}

export class RetryInterceptor implements FetchInterceptor {
  private readonly scheduler: Scheduler;
  private readonly maximumRetries: number;
  private readonly minimumTimeout: number;
  private readonly maximumTimeout: number;
  private readonly timeoutFactor: number;
  private readonly useRetryAfter: boolean;
  private readonly methods: readonly string[];
  private readonly statusCodes: readonly number[];
  private readonly errorCodes: readonly TransportErrorCode[];
  private readonly throwOnStatusExhaustion: boolean;
  private readonly nowMilliseconds: () => number;
  private readonly decide: RetryDecider | undefined;
  private readonly classifyError: RetryErrorClassifier | undefined;
  private readonly observer: RetryObserver | undefined;

  constructor(options: RetryOptions) {
    this.scheduler = options.scheduler;
    this.maximumRetries = options.maxRetries ?? 5;
    this.minimumTimeout = options.minTimeoutMilliseconds ?? 500;
    this.maximumTimeout = options.maxTimeoutMilliseconds ?? 30000;
    this.timeoutFactor = options.timeoutFactor ?? 2;
    this.useRetryAfter = options.retryAfter ?? true;
    this.methods = options.methods ?? defaultMethods;
    this.statusCodes = options.statusCodes ?? defaultStatusCodes;
    this.errorCodes = options.errorCodes ?? defaultErrorCodes;
    this.throwOnStatusExhaustion = options.throwOnStatusExhaustion ?? true;
    this.nowMilliseconds = options.nowMilliseconds ?? defaultNow;
    this.decide = options.decide;
    this.classifyError = options.classifyError;
    this.observer = options.onRetry;
    validateCount(this.maximumRetries, "Maximum retry count");
    validateDelay(this.minimumTimeout, "Minimum retry timeout");
    validateDelay(this.maximumTimeout, "Maximum retry timeout");
    validateFactor(this.timeoutFactor);
    if (this.minimumTimeout > this.maximumTimeout) {
      throw new RangeError("Minimum retry timeout exceeds maximum retry timeout");
    }
    for (const status of this.statusCodes) {
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        throw new RangeError("Retry status code is invalid");
      }
    }
  }

  async dispatch(request: TransportRequest, next: FetchTransport): Promise<TransportResponse> {
    const method = request.method.toUpperCase();
    let retryCount = 0;
    let attempt = request;
    while (true) {
      request.signal.throwIfAborted();
      let response: TransportResponse;
      try {
        response = await next.dispatch(attempt);
      } catch (error) {
        request.signal.throwIfAborted();
        if (!this.methodEligible(method) || !this.errorEligible(error)) throw error;
        if (retryCount >= this.maximumRetries) throw error;
        retryCount++;
        const context = this.context(request, retryCount, null, error);
        const decision = await this.retryDecision(context);
        if (!decision.retry) throw error;
        ensureReplayable(request);
        this.observe(context);
        await waitForRetry(this.scheduler, this.decisionDelay(context, decision), request.signal);
        attempt = requestForRetry(request);
        continue;
      }

      await throwIfResponseAborted(response, request.signal);

      if (!this.methodEligible(method) || !includesNumber(this.statusCodes, response.status)) {
        return response;
      }
      if (retryCount >= this.maximumRetries) {
        if (!this.throwOnStatusExhaustion) return response;
        await discardResponse(response, new RetryCancellation(response.status));
        throw new RetryExhaustedError(response, retryCount);
      }
      retryCount++;
      let context: RetryContext;
      let decision: RetryDecision;
      try {
        context = this.context(request, retryCount, response, null);
        decision = await this.retryDecision(context);
      } catch (error) {
        await discardResponse(response, new RetryCancellation(response.status));
        throw error;
      }
      await throwIfResponseAborted(response, request.signal);
      if (!decision.retry) return response;
      try {
        ensureReplayable(request);
      } catch (error) {
        await discardResponse(response, new RetryCancellation(response.status));
        throw error;
      }
      await discardResponse(response, new RetryCancellation(response.status));
      this.observe(context);
      await waitForRetry(this.scheduler, this.decisionDelay(context, decision), request.signal);
      attempt = requestForRetry(request);
    }
  }

  private methodEligible(method: string): boolean {
    for (const candidate of this.methods) {
      if (candidate.toUpperCase() === method) return true;
    }
    return false;
  }

  private errorEligible(error: unknown): boolean {
    if (this.classifyError !== undefined) return this.classifyError(error);
    return error instanceof TransportError && includesErrorCode(this.errorCodes, error.code);
  }

  private proposedDelay(retryCount: number, response: TransportResponse | null): number {
    if (this.useRetryAfter && response !== null) {
      const now = this.nowMilliseconds();
      if (!Number.isFinite(now))
        throw new TypeError("Retry wall clock returned a non-finite value");
      const fromHeader = retryAfterMilliseconds(response, now);
      if (fromHeader !== null) return Math.min(fromHeader, this.maximumTimeout);
    }
    const exponential = this.minimumTimeout * this.timeoutFactor ** (retryCount - 1);
    return Math.min(exponential, this.maximumTimeout);
  }

  private context(
    request: TransportRequest,
    retryCount: number,
    response: TransportResponse | null,
    error: unknown,
  ): RetryContext {
    return {
      request,
      retryCount,
      proposedDelayMilliseconds: this.proposedDelay(retryCount, response),
      response,
      error,
    };
  }

  private retryDecision(context: RetryContext): Promise<RetryDecision> {
    return Promise.resolve(
      this.decide?.(context) ?? {
        retry: true,
        delayMilliseconds: context.proposedDelayMilliseconds,
      },
    );
  }

  private decisionDelay(context: RetryContext, decision: RetryDecision): number {
    const delay = decision.delayMilliseconds ?? context.proposedDelayMilliseconds;
    validateDelay(delay, "Retry decision delay");
    return Math.min(delay, this.maximumTimeout);
  }

  private observe(context: RetryContext): void {
    if (this.observer === undefined) return;
    try {
      this.observer(context);
    } catch (error) {
      this.scheduler.reportError(error);
    }
  }
}

export class RetryAgent implements FetchTransport {
  private readonly transport: FetchTransport;
  private readonly interceptor: RetryInterceptor;

  constructor(transport: FetchTransport, options: RetryOptions) {
    this.transport = transport;
    this.interceptor = new RetryInterceptor(options);
  }

  dispatch(request: TransportRequest): Promise<TransportResponse> {
    return this.interceptor.dispatch(request, this.transport);
  }
}
