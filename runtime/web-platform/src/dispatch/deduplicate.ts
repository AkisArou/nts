import { AbortController } from "../core/abort.ts";
import type { AbortSignal } from "../core/abort.ts";
import { ignoreRejection } from "../core/promise.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import type { FetchTransport, TransportRequest, TransportResponse } from "../fetch/transport.ts";
import { Fifo } from "../streams/fifo.ts";
import {
  ReadableStream,
  type ReadableStreamDefaultController,
  type ReadableStreamDefaultReader,
  type UnderlyingSource,
} from "../streams/readable.ts";
import type { FetchInterceptor } from "./interceptor.ts";
import { abortSignalSubscribe } from "../core/abort.ts";

const safeMethods = ["GET", "HEAD", "OPTIONS", "TRACE"] as const;

export interface DeduplicationOptions {
  readonly methods?: readonly string[];
  readonly skipHeaderNames?: readonly string[];
  readonly excludeHeaderNames?: readonly string[];
  readonly maximumPendingRequests?: number;
  readonly maximumSubscribersPerRequest?: number;
  readonly maximumBufferedBytesPerSubscriber?: number;
  readonly maximumTotalBufferedBytes?: number;
}

export class DeduplicationBufferError extends Error {
  readonly code = "UND_ERR_ABORTED";
  readonly maximumBytes: number;
  readonly scope: "subscriber" | "total";

  constructor(maximumBytes: number, scope: "subscriber" | "total" = "subscriber") {
    super(
      scope === "subscriber"
        ? "Deduplicated response subscriber exceeded its buffer limit"
        : "Deduplicated responses exceeded their shared buffer limit",
    );
    this.name = "DeduplicationBufferError";
    this.maximumBytes = maximumBytes;
    this.scope = scope;
  }
}

class BufferBudget {
  readonly maximumBytes: number;
  private used = 0;

  constructor(maximum: number) {
    this.maximumBytes = maximum;
  }

  reserve(bytes: number): boolean {
    if (bytes > this.maximumBytes - this.used) return false;
    this.used += bytes;
    return true;
  }

  release(bytes: number): void {
    this.used -= bytes;
    if (this.used < 0) throw new Error("Deduplication buffer accounting underflow");
  }
}

function validatePositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(name + " must be a positive safe integer");
  }
}

function normalizedNames(values: readonly string[], name: string): readonly string[] {
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") throw new TypeError(name + " must contain only strings");
    result.push(value.toLowerCase());
  }
  return result;
}

function includes(values: readonly string[], candidate: string): boolean {
  for (const value of values) if (value === candidate) return true;
  return false;
}

function part(value: string): string {
  return String(value.length) + ":" + value;
}

function requestKey(request: TransportRequest, excluded: readonly string[]): string {
  const url =
    request.url.protocol + "//" + request.url.host + request.url.pathname + request.url.search;
  let result = part(request.method.toUpperCase()) + part(url);
  let count = 0;
  for (const [rawName, value] of request.headers) {
    const name = rawName.toLowerCase();
    if (includes(excluded, name)) continue;
    result += part(name) + part(value);
    count++;
  }
  return String(count) + ":" + result;
}

function hasSkippedHeader(request: TransportRequest, skipped: readonly string[]): boolean {
  if (skipped.length === 0) return false;
  for (const [rawName] of request.headers) {
    if (includes(skipped, rawName.toLowerCase())) return true;
  }
  return false;
}

function copyHeaders(entries: readonly HeaderEntry[]): HeaderEntry[] {
  const copy: HeaderEntry[] = [];
  for (const [name, value] of entries) copy.push([name, value]);
  return copy;
}

function copyTrailers(
  pending: Promise<readonly HeaderEntry[]>,
  signal: AbortSignal,
): Promise<readonly HeaderEntry[]> {
  signal.throwIfAborted();
  const result = Promise.withResolvers<readonly HeaderEntry[]>();
  const unsubscribe = signal[abortSignalSubscribe](() => result.reject(signal.reason));
  pending.then((entries) => {
    const copy = copyHeaders(entries);
    if (signal.aborted) return;
    result.resolve(copy);
  }, result.reject);
  const copied = result.promise.finally(unsubscribe);
  ignoreRejection(copied);
  return copied;
}

class SubscriberSource implements UnderlyingSource<Uint8Array> {
  private readonly subscriber: DeduplicationSubscriber;

  constructor(subscriber: DeduplicationSubscriber) {
    this.subscriber = subscriber;
  }

  start(controller: ReadableStreamDefaultController<Uint8Array>): void {
    this.subscriber.start(controller);
  }

  pull(): void {
    this.subscriber.pull();
  }

  cancel(reason: unknown): Promise<void> {
    return this.subscriber.cancel(reason);
  }
}

class DeduplicationSubscriber {
  readonly result = Promise.withResolvers<TransportResponse>();
  private readonly owner: PendingDeduplication;
  private readonly budget: BufferBudget;
  private readonly maximumBufferedBytes: number;
  private readonly cancellation = new AbortController();
  private readonly queue = new Fifo<Uint8Array>();
  private readonly unsubscribeRequest: () => void;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private queuedBytes = 0;
  private responseSettled = false;
  private active = true;
  private wantsChunk = false;
  private sourceDone = false;

  constructor(
    owner: PendingDeduplication,
    requestSignal: AbortSignal,
    budget: BufferBudget,
    maximumBufferedBytes: number,
  ) {
    this.owner = owner;
    this.budget = budget;
    this.maximumBufferedBytes = maximumBufferedBytes;
    this.unsubscribeRequest = requestSignal[abortSignalSubscribe](() => this.abort(requestSignal.reason));
  }

  get isActive(): boolean {
    return this.active;
  }

  get waitingForChunk(): boolean {
    return this.active && this.wantsChunk;
  }

  attach(response: TransportResponse): void {
    if (!this.active) return;
    const body =
      response.body === null
        ? null
        : new ReadableStream<Uint8Array>(new SubscriberSource(this), { highWaterMark: 0 });
    this.responseSettled = true;
    this.result.resolve({
      status: response.status,
      statusText: response.statusText,
      headers: copyHeaders(response.headers),
      body,
      trailers:
        response.trailers === undefined
          ? undefined
          : copyTrailers(response.trailers, this.cancellation.signal),
    });
    if (body === null) this.finish();
  }

  start(controller: ReadableStreamDefaultController<Uint8Array>): void {
    this.controller = controller;
  }

  pull(): void {
    if (!this.active) return;
    const chunk = this.queue.dequeue();
    if (chunk !== undefined) {
      this.queuedBytes -= chunk.length;
      this.budget.release(chunk.length);
      this.controller?.enqueue(chunk);
      return;
    }
    if (this.sourceDone) {
      this.controller?.close();
      this.finish();
      return;
    }
    this.wantsChunk = true;
    this.owner.pump();
  }

  deliver(chunk: Uint8Array): void {
    if (!this.active) return;
    if (this.wantsChunk) {
      this.wantsChunk = false;
      this.controller?.enqueue(chunk.slice());
      return;
    }
    if (chunk.length > this.maximumBufferedBytes - this.queuedBytes) {
      this.fail(new DeduplicationBufferError(this.maximumBufferedBytes));
      return;
    }
    if (!this.budget.reserve(chunk.length)) {
      this.fail(new DeduplicationBufferError(this.budget.maximumBytes, "total"));
      return;
    }
    let copy: Uint8Array;
    try {
      copy = chunk.slice();
    } catch (error) {
      this.budget.release(chunk.length);
      this.fail(error);
      return;
    }
    this.queue.enqueue(copy);
    this.queuedBytes += copy.length;
  }

  end(): void {
    if (!this.active) return;
    this.sourceDone = true;
    if (!this.queue.empty) return;
    this.controller?.close();
    this.finish();
  }

  fail(reason: unknown): void {
    this.stop(reason, true, true);
  }

  abort(reason: unknown): void {
    this.stop(reason, true, true);
  }

  cancel(reason: unknown): Promise<void> {
    return this.stop(reason, false, true);
  }

  private finish(): void {
    if (!this.active) return;
    this.active = false;
    this.wantsChunk = false;
    this.unsubscribeRequest();
  }

  private stop(reason: unknown, errorStream: boolean, notifyOwner: boolean): Promise<void> {
    if (!this.active) return Promise.resolve();
    this.active = false;
    this.wantsChunk = false;
    this.releaseQueue();
    this.unsubscribeRequest();
    this.cancellation.abort(reason);
    if (!this.responseSettled) this.result.reject(reason);
    else if (errorStream) this.controller?.error(reason);
    return notifyOwner ? this.owner.subscriberStopped(reason) : Promise.resolve();
  }

  private releaseQueue(): void {
    while (!this.queue.empty) {
      const chunk = this.queue.dequeue();
      if (chunk !== undefined) this.budget.release(chunk.length);
    }
    this.queuedBytes = 0;
  }
}

class PendingDeduplication {
  private readonly key: string;
  private readonly request: TransportRequest;
  private readonly next: FetchTransport;
  private readonly owner: DeduplicationInterceptor;
  private readonly budget: BufferBudget;
  private readonly maximumSubscribers: number;
  private readonly maximumBufferedBytes: number;
  private readonly cancellation = new AbortController();
  private readonly subscribers: DeduplicationSubscriber[] = [];
  private response: TransportResponse | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private reading = false;
  private dataStarted = false;
  private sourceDone = false;
  private stopped = false;
  private stopReason: unknown;

  constructor(
    key: string,
    request: TransportRequest,
    next: FetchTransport,
    owner: DeduplicationInterceptor,
    budget: BufferBudget,
    maximumSubscribers: number,
    maximumBufferedBytes: number,
  ) {
    this.key = key;
    this.request = request;
    this.next = next;
    this.owner = owner;
    this.budget = budget;
    this.maximumSubscribers = maximumSubscribers;
    this.maximumBufferedBytes = maximumBufferedBytes;
  }

  start(): void {
    const request: TransportRequest = {
      url: this.request.url,
      method: this.request.method,
      headers: this.request.headers,
      body: this.request.body,
      bodyLength: this.request.bodyLength,
      replayBody: this.request.replayBody,
      signal: this.cancellation.signal,
    };
    Promise.resolve()
      .then(() => this.next.dispatch(request))
      .then((response) => this.responseStarted(response))
      .catch((error) => this.sourceFailed(error));
  }

  subscribe(signal: AbortSignal): Promise<TransportResponse> | null {
    if (this.stopped || this.dataStarted || this.subscribers.length >= this.maximumSubscribers) {
      return null;
    }
    if (signal.aborted) return Promise.reject(signal.reason);
    const subscriber = new DeduplicationSubscriber(
      this,
      signal,
      this.budget,
      this.maximumBufferedBytes,
    );
    this.subscribers.push(subscriber);
    if (this.response !== null) subscriber.attach(this.response);
    return subscriber.result.promise;
  }

  pump(): void {
    if (this.reader === null || this.reading || this.sourceDone || this.stopped) return;
    let demanded = false;
    for (const subscriber of this.subscribers) {
      if (subscriber.waitingForChunk) {
        demanded = true;
        break;
      }
    }
    if (!demanded) return;
    this.reading = true;
    this.reader.read().then(
      (item) => {
        this.reading = false;
        if (this.stopped) return;
        if (item.done) {
          this.sourceCompleted();
          return;
        }
        if (!(item.value instanceof Uint8Array)) {
          this.sourceFailed(new TypeError("Transport response body chunks must be Uint8Array"));
          return;
        }
        if (!this.dataStarted) {
          this.dataStarted = true;
          this.owner.removePending(this.key, this);
        }
        for (const subscriber of this.subscribers) subscriber.deliver(item.value);
        this.pump();
      },
      (error) => {
        this.reading = false;
        this.sourceFailed(error);
      },
    );
  }

  async subscriberStopped(reason: unknown): Promise<void> {
    if (this.sourceDone || this.stopped) return;
    for (const subscriber of this.subscribers) if (subscriber.isActive) return;
    this.stopped = true;
    this.stopReason = reason;
    this.owner.removePending(this.key, this);
    this.cancellation.abort(reason);
    const reader = this.reader;
    if (reader !== null) {
      try {
        await reader.cancel(reason);
      } finally {
        this.releaseReader();
      }
    }
  }

  private async responseStarted(response: TransportResponse): Promise<void> {
    if (this.stopped) {
      if (response.body !== null) {
        try {
          await response.body.cancel(this.stopReason);
        } catch {
          // No subscriber remains to observe cleanup failure.
        }
      }
      if (response.trailers !== undefined) ignoreRejection(response.trailers);
      return;
    }
    this.response = response;
    for (const subscriber of this.subscribers) subscriber.attach(response);
    if (response.body === null) {
      this.sourceCompleted();
      return;
    }
    this.reader = response.body.getReader();
    this.pump();
  }

  private sourceCompleted(): void {
    if (this.sourceDone) return;
    this.sourceDone = true;
    this.owner.removePending(this.key, this);
    this.releaseReader();
    for (const subscriber of this.subscribers) subscriber.end();
  }

  private sourceFailed(reason: unknown): void {
    if (this.sourceDone) return;
    this.sourceDone = true;
    this.owner.removePending(this.key, this);
    this.releaseReader();
    for (const subscriber of this.subscribers) subscriber.fail(reason);
  }

  private releaseReader(): void {
    const reader = this.reader;
    if (reader === null) return;
    this.reader = null;
    reader.releaseLock();
  }
}

/** Coalesce compatible in-flight safe requests without sharing response-body identity. */
export class DeduplicationInterceptor implements FetchInterceptor {
  private readonly methods: readonly string[];
  private readonly skipHeaderNames: readonly string[];
  private readonly excludeHeaderNames: readonly string[];
  private readonly maximumPendingRequests: number;
  private readonly maximumSubscribers: number;
  private readonly maximumBufferedBytes: number;
  private readonly budget: BufferBudget;
  private readonly pending = new Map<string, PendingDeduplication>();

  constructor(options: DeduplicationOptions = {}) {
    const methods = options.methods ?? ["GET"];
    const normalizedMethods: string[] = [];
    for (const value of methods) {
      if (typeof value !== "string") throw new TypeError("Deduplication methods must be strings");
      const method = value.toUpperCase();
      if (!includes(safeMethods, method)) {
        throw new TypeError("Deduplication supports only safe HTTP methods");
      }
      normalizedMethods.push(method);
    }
    this.methods = normalizedMethods;
    this.skipHeaderNames = normalizedNames(
      options.skipHeaderNames ?? [],
      "Deduplication skipHeaderNames",
    );
    this.excludeHeaderNames = normalizedNames(
      options.excludeHeaderNames ?? [],
      "Deduplication excludeHeaderNames",
    );
    this.maximumPendingRequests = options.maximumPendingRequests ?? 1024;
    this.maximumSubscribers = options.maximumSubscribersPerRequest ?? 64;
    this.maximumBufferedBytes = options.maximumBufferedBytesPerSubscriber ?? 5 * 1024 * 1024;
    const maximumTotalBufferedBytes = options.maximumTotalBufferedBytes ?? 64 * 1024 * 1024;
    validatePositiveSafeInteger(this.maximumPendingRequests, "Deduplication pending limit");
    validatePositiveSafeInteger(this.maximumSubscribers, "Deduplication subscriber limit");
    validatePositiveSafeInteger(this.maximumBufferedBytes, "Deduplication subscriber byte limit");
    validatePositiveSafeInteger(maximumTotalBufferedBytes, "Deduplication total byte limit");
    this.budget = new BufferBudget(maximumTotalBufferedBytes);
  }

  dispatch(request: TransportRequest, next: FetchTransport): Promise<TransportResponse> {
    const method = request.method.toUpperCase();
    if (
      !includes(this.methods, method) ||
      request.body !== null ||
      hasSkippedHeader(request, this.skipHeaderNames)
    ) {
      return next.dispatch(request);
    }
    const key = requestKey(request, this.excludeHeaderNames);
    const existing = this.pending.get(key);
    if (existing !== undefined) {
      const joined = existing.subscribe(request.signal);
      return joined ?? next.dispatch(request);
    }
    if (this.pending.size >= this.maximumPendingRequests) return next.dispatch(request);

    const entry = new PendingDeduplication(
      key,
      request,
      next,
      this,
      this.budget,
      this.maximumSubscribers,
      this.maximumBufferedBytes,
    );
    const result = entry.subscribe(request.signal);
    if (result === null) return next.dispatch(request);
    this.pending.set(key, entry);
    entry.start();
    return result;
  }

  /** @internal */ removePending(key: string, entry: PendingDeduplication): void {
    if (this.pending.get(key) === entry) this.pending.delete(key);
  }
}
