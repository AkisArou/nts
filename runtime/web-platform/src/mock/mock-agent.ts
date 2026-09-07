import type { AbortSignal } from "../core/abort.ts";
import { LimitError } from "../core/errors.ts";
import { TextDecoder, TextEncoder } from "../core/encoding.ts";
import { Headers } from "../fetch/headers.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import type {
  FetchTransport,
  TransportBodySource,
  TransportRequest,
  TransportResponse,
} from "../fetch/transport.ts";
import type { URLRecord } from "../provider/primitives.ts";
import type { CancelHandle, Scheduler } from "../provider/primitives.ts";
import { bytesStream, type ReadableStream } from "../streams/readable.ts";

export type MockStringMatcher = string | RegExp | ((value: string) => boolean);
export type MockBodyMatcher =
  | string
  | Uint8Array
  | RegExp
  | ((bytes: Uint8Array, text: string) => boolean);
export type MockHeadersMatcher = readonly HeaderEntry[] | ((headers: Headers) => boolean);

export interface MockInterceptorOptions {
  readonly path: MockStringMatcher;
  readonly method?: MockStringMatcher;
  readonly body?: MockBodyMatcher;
  readonly headers?: MockHeadersMatcher;
  /** Matches the serialized query without its leading question mark. */
  readonly query?: MockStringMatcher;
}

export type MockReplyBody = string | Uint8Array | null;

export interface MockReplyOptions {
  readonly headers?: readonly HeaderEntry[];
  readonly trailers?: readonly HeaderEntry[];
}

export interface MockReply {
  readonly status: number;
  readonly statusText?: string;
  readonly body?: MockReplyBody;
  readonly headers?: readonly HeaderEntry[];
  readonly trailers?: readonly HeaderEntry[];
}

export interface MockRequestSnapshot {
  readonly url: URLRecord;
  readonly method: string;
  readonly headers: readonly HeaderEntry[];
  readonly body: Uint8Array | null;
  readonly bodyText: string | null;
}

export type MockReplyFactory = (request: MockRequestSnapshot) => MockReply | Promise<MockReply>;

export interface MockAgentOptions {
  readonly fallback?: FetchTransport;
  readonly maxRequestBodyBytes?: number;
  readonly maxCallHistoryEntries?: number;
  readonly ignoreTrailingSlash?: boolean;
  readonly enableCallHistory?: boolean;
}

export interface PendingMockInterceptor {
  readonly origin: MockStringMatcher;
  readonly options: MockInterceptorOptions;
  readonly remaining: number | null;
  readonly persistent: boolean;
}

export class MockNotMatchedError extends TypeError {
  readonly code = "UND_MOCK_ERR_MOCK_NOT_MATCHED";

  constructor(message = "Mock request did not match any registered interceptor") {
    super(message);
    this.name = "MockNotMatchedError";
  }
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(name + " must be a positive safe integer");
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.length);
  result.set(bytes);
  return result;
}

class CapturedTransportBody implements TransportBodySource {
  readonly length: number;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = copyBytes(bytes);
    this.length = bytes.length;
  }

  open(): ReadableStream<Uint8Array> {
    return bytesStream(this.bytes);
  }
}

function byteEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function regularExpressionMatches(expression: RegExp, value: string): boolean {
  const previous = expression.lastIndex;
  expression.lastIndex = 0;
  const matched = expression.test(value);
  expression.lastIndex = previous;
  return matched;
}

function stringMatches(matcher: MockStringMatcher, value: string): boolean {
  if (typeof matcher === "string") return matcher === value;
  if (matcher instanceof RegExp) return regularExpressionMatches(matcher, value);
  return matcher(value);
}

function bodyMatches(matcher: MockBodyMatcher, bytes: Uint8Array, text: string): boolean {
  if (typeof matcher === "string") return matcher === text;
  if (matcher instanceof Uint8Array) return byteEqual(matcher, bytes);
  if (matcher instanceof RegExp) return regularExpressionMatches(matcher, text);
  return matcher(bytes, text);
}

function queryOf(url: URLRecord): string {
  return url.search.startsWith("?") ? url.search.slice(1) : url.search;
}

function pathOf(url: URLRecord, ignoreTrailingSlash: boolean): string {
  let path = url.pathname + url.search;
  if (!ignoreTrailingSlash) return path;
  const query = path.indexOf("?");
  const pathEnd = query < 0 ? path.length : query;
  if (pathEnd > 1 && path.charAt(pathEnd - 1) === "/") {
    path = path.slice(0, pathEnd - 1) + path.slice(pathEnd);
  }
  return path;
}

function originMatches(matcher: MockStringMatcher, origin: string): boolean {
  if (typeof matcher !== "string") return stringMatches(matcher, origin);
  const normalized = matcher.endsWith("/") ? matcher.slice(0, -1) : matcher;
  return normalized === origin;
}

function copyHeaders(entries: readonly HeaderEntry[]): HeaderEntry[] {
  const result: HeaderEntry[] = [];
  for (const [name, value] of entries) result.push([name, value]);
  return result;
}

function headersMatch(matcher: MockHeadersMatcher, entries: readonly HeaderEntry[]): boolean {
  const headers = new Headers(entries);
  if (typeof matcher === "function") return matcher(headers);
  for (const [name, expected] of matcher) {
    if (headers.get(name) !== expected) return false;
  }
  return true;
}

/** @internal Shared by the deterministic snapshot transport. */
export async function captureMockRequest(
  request: TransportRequest,
  maximumBytes: number,
): Promise<MockRequestSnapshot> {
  if (request.body === null) {
    return {
      url: request.url,
      method: request.method,
      headers: copyHeaders(request.headers),
      body: null,
      bodyText: null,
    };
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      request.signal.throwIfAborted();
      const item = await reader.read();
      if (item.done) break;
      length += item.value.length;
      if (length > maximumBytes) {
        const error = new LimitError("Mock request body exceeds configured limit");
        await reader.cancel(error);
        throw error;
      }
      chunks.push(copyBytes(item.value));
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return {
    url: request.url,
    method: request.method,
    headers: copyHeaders(request.headers),
    body,
    bodyText: new TextDecoder().decode(body),
  };
}

/** @internal Reconstructs a consumed request without sharing its captured bytes. */
export function replayMockRequest(
  request: TransportRequest,
  snapshot: MockRequestSnapshot,
): TransportRequest {
  return {
    url: request.url,
    method: request.method,
    headers: copyHeaders(request.headers),
    body: snapshot.body === null ? null : bytesStream(snapshot.body),
    bodyLength: snapshot.body === null ? null : snapshot.body.length,
    replayBody: snapshot.body === null ? null : new CapturedTransportBody(snapshot.body),
    signal: request.signal,
  };
}

async function waitForDelay(
  scheduler: Scheduler,
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const result = Promise.withResolvers<void>();
  let timer: CancelHandle | null = null;
  const dispose = signal.subscribe(() => {
    timer?.cancel();
    result.reject(signal.reason);
  });
  timer = scheduler.delay(milliseconds, result.resolve);
  try {
    await result.promise;
    signal.throwIfAborted();
  } finally {
    timer.cancel();
    dispose();
  }
}

class MockDispatch {
  readonly options: MockInterceptorOptions;
  response: MockReplyFactory | null = null;
  error: Error | null = null;
  delayMilliseconds = 0;
  remaining = 1;
  persistent = false;
  defaultHeaders: HeaderEntry[] = [];
  defaultTrailers: HeaderEntry[] = [];
  addContentLength = false;

  constructor(options: MockInterceptorOptions) {
    this.options = options;
  }

  get available(): boolean {
    return this.persistent || this.remaining > 0;
  }

  get pending(): boolean {
    return this.remaining > 0;
  }

  matches(snapshot: MockRequestSnapshot, ignoreTrailingSlash: boolean): boolean {
    if (!this.available) return false;
    if (!stringMatches(this.options.path, pathOf(snapshot.url, ignoreTrailingSlash))) return false;
    if (this.options.method !== undefined && !stringMatches(this.options.method, snapshot.method)) {
      return false;
    }
    if (
      this.options.query !== undefined &&
      !stringMatches(this.options.query, queryOf(snapshot.url))
    ) {
      return false;
    }
    if (
      this.options.headers !== undefined &&
      !headersMatch(this.options.headers, snapshot.headers)
    ) {
      return false;
    }
    if (this.options.body === undefined) return true;
    if (snapshot.body === null || snapshot.bodyText === null) return false;
    return bodyMatches(this.options.body, snapshot.body, snapshot.bodyText);
  }

  consume(): void {
    if (this.remaining > 0) this.remaining--;
  }
}

export class MockScope {
  private readonly dispatch: MockDispatch;

  constructor(dispatch: MockDispatch) {
    this.dispatch = dispatch;
  }

  delay(milliseconds: number): this {
    validatePositiveInteger(milliseconds, "Mock reply delay");
    this.dispatch.delayMilliseconds = milliseconds;
    return this;
  }

  persist(): this {
    this.dispatch.persistent = true;
    return this;
  }

  times(count: number): this {
    validatePositiveInteger(count, "Mock reply count");
    this.dispatch.remaining = count;
    return this;
  }
}

export class MockInterceptor {
  private readonly options: MockInterceptorOptions;
  private readonly pool: MockPool;
  private defaultHeaders: HeaderEntry[] = [];
  private defaultTrailers: HeaderEntry[] = [];
  private addContentLength = false;

  constructor(options: MockInterceptorOptions, pool: MockPool) {
    this.options = options;
    this.pool = pool;
  }

  reply(status: number, body: MockReplyBody = "", options: MockReplyOptions = {}): MockScope {
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new RangeError("Invalid mock response status");
    }
    const dispatch = this.createDispatch();
    dispatch.response = () => ({
      status,
      body,
      headers: options.headers,
      trailers: options.trailers,
    });
    this.pool.register(dispatch);
    return new MockScope(dispatch);
  }

  replyUsing(factory: MockReplyFactory): MockScope {
    const dispatch = this.createDispatch();
    dispatch.response = factory;
    this.pool.register(dispatch);
    return new MockScope(dispatch);
  }

  replyWithError(error: Error): MockScope {
    if (!(error instanceof Error)) throw new TypeError("Mock reply error must be an Error");
    const dispatch = this.createDispatch();
    dispatch.error = error;
    this.pool.register(dispatch);
    return new MockScope(dispatch);
  }

  defaultReplyHeaders(headers: readonly HeaderEntry[]): this {
    this.defaultHeaders = copyHeaders(headers);
    return this;
  }

  defaultReplyTrailers(trailers: readonly HeaderEntry[]): this {
    this.defaultTrailers = copyHeaders(trailers);
    return this;
  }

  replyContentLength(): this {
    this.addContentLength = true;
    return this;
  }

  private createDispatch(): MockDispatch {
    const dispatch = new MockDispatch(this.options);
    dispatch.defaultHeaders = copyHeaders(this.defaultHeaders);
    dispatch.defaultTrailers = copyHeaders(this.defaultTrailers);
    dispatch.addContentLength = this.addContentLength;
    return dispatch;
  }
}

export class MockCallHistoryLog {
  readonly protocol: string;
  readonly host: string;
  readonly port: string;
  readonly origin: string;
  readonly path: string;
  readonly hash: string;
  readonly fullURL: string;
  readonly method: string;
  readonly bodyText: string | null;
  private readonly bodyBytes: Uint8Array | null;
  private readonly headerEntries: HeaderEntry[];

  constructor(snapshot: MockRequestSnapshot) {
    this.protocol = snapshot.url.protocol;
    this.host = snapshot.url.hostname;
    this.port = snapshot.url.port;
    this.origin = snapshot.url.origin;
    this.path = snapshot.url.pathname;
    this.hash = snapshot.url.hash;
    this.fullURL = snapshot.url.href;
    this.method = snapshot.method;
    this.bodyBytes = snapshot.body === null ? null : copyBytes(snapshot.body);
    this.bodyText = snapshot.bodyText;
    this.headerEntries = copyHeaders(snapshot.headers);
  }

  get body(): Uint8Array | null {
    return this.bodyBytes === null ? null : copyBytes(this.bodyBytes);
  }

  get headers(): readonly HeaderEntry[] {
    return copyHeaders(this.headerEntries);
  }
}

export type MockCallHistoryPredicate = (log: MockCallHistoryLog) => boolean;

export class MockCallHistory {
  private readonly entries: MockCallHistoryLog[] = [];
  private readonly maximumEntries: number;
  private dropped = 0;

  constructor(maximumEntries = 10000) {
    validatePositiveInteger(maximumEntries, "Mock call-history limit");
    this.maximumEntries = maximumEntries;
  }

  record(snapshot: MockRequestSnapshot): void {
    if (this.entries.length === this.maximumEntries) {
      this.entries.shift();
      this.dropped++;
    }
    this.entries.push(new MockCallHistoryLog(snapshot));
  }

  get droppedEntries(): number {
    return this.dropped;
  }

  calls(): MockCallHistoryLog[] {
    return this.entries.slice();
  }

  firstCall(): MockCallHistoryLog | undefined {
    return this.entries[0];
  }

  lastCall(): MockCallHistoryLog | undefined {
    return this.entries[this.entries.length - 1];
  }

  nthCall(position: number): MockCallHistoryLog | undefined {
    if (!Number.isSafeInteger(position) || position < 1) return undefined;
    return this.entries[position - 1];
  }

  filterCalls(predicate: MockCallHistoryPredicate): MockCallHistoryLog[] {
    const result: MockCallHistoryLog[] = [];
    for (const entry of this.entries) if (predicate(entry)) result.push(entry);
    return result;
  }

  clear(): void {
    this.entries.length = 0;
    this.dropped = 0;
  }

  *[Symbol.iterator](): Generator<MockCallHistoryLog> {
    yield* this.entries;
  }
}

export class MockPool implements FetchTransport {
  readonly origin: MockStringMatcher;
  private readonly agent: MockAgent;
  private readonly dispatches: MockDispatch[] = [];
  private closed = false;

  constructor(origin: MockStringMatcher, agent: MockAgent) {
    this.origin = origin;
    this.agent = agent;
  }

  intercept(options: MockInterceptorOptions): MockInterceptor {
    if (this.closed) throw new TypeError("Mock pool is closed");
    return new MockInterceptor(options, this);
  }

  dispatch(request: TransportRequest): Promise<TransportResponse> {
    if (!originMatches(this.origin, request.url.origin)) {
      return Promise.reject(new MockNotMatchedError("Request origin does not match mock pool"));
    }
    return this.agent.dispatchFrom(this, request);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  cleanMocks(): void {
    this.dispatches.length = 0;
  }

  /** @internal */
  register(dispatch: MockDispatch): void {
    if (this.closed) throw new TypeError("Mock pool is closed");
    this.dispatches.push(dispatch);
  }

  /** @internal */
  find(snapshot: MockRequestSnapshot, ignoreTrailingSlash: boolean): MockDispatch | null {
    if (this.closed) return null;
    for (const dispatch of this.dispatches) {
      if (dispatch.matches(snapshot, ignoreTrailingSlash)) return dispatch;
    }
    return null;
  }

  /** @internal */
  pending(): MockDispatch[] {
    const result: MockDispatch[] = [];
    for (const dispatch of this.dispatches) if (dispatch.pending) result.push(dispatch);
    return result;
  }
}

export class MockClient extends MockPool {}

export class MockAgent implements FetchTransport {
  private readonly scheduler: Scheduler;
  private readonly fallback: FetchTransport | undefined;
  private readonly maximumBodyBytes: number;
  private readonly maximumHistoryEntries: number;
  private readonly ignoreTrailingSlash: boolean;
  private readonly pools: MockPool[] = [];
  private readonly networkMatchers: MockStringMatcher[] = [];
  private history: MockCallHistory | null;
  private active = true;
  private allowAllNetwork = true;
  private closed = false;
  private inFlight = 0;
  private inFlightDone: PromiseWithResolvers<void> | null = null;
  private closeResult: Promise<void> | null = null;

  constructor(scheduler: Scheduler, options: MockAgentOptions = {}) {
    this.scheduler = scheduler;
    this.fallback = options.fallback;
    this.maximumBodyBytes = options.maxRequestBodyBytes ?? 16 * 1024 * 1024;
    validatePositiveInteger(this.maximumBodyBytes, "Mock request body limit");
    this.maximumHistoryEntries = options.maxCallHistoryEntries ?? 10000;
    validatePositiveInteger(this.maximumHistoryEntries, "Mock call-history limit");
    this.ignoreTrailingSlash = options.ignoreTrailingSlash ?? false;
    this.history =
      options.enableCallHistory === true ? new MockCallHistory(this.maximumHistoryEntries) : null;
  }

  get(origin: MockStringMatcher): MockPool {
    if (this.closed) throw new TypeError("Mock agent is closed");
    for (const pool of this.pools) if (pool.origin === origin) return pool;
    const pool = new MockPool(origin, this);
    this.pools.push(pool);
    return pool;
  }

  async dispatch(request: TransportRequest): Promise<TransportResponse> {
    return await this.dispatchInternal(request, null);
  }

  /** @internal */
  async dispatchFrom(pool: MockPool, request: TransportRequest): Promise<TransportResponse> {
    return await this.dispatchInternal(request, pool);
  }

  private async dispatchInternal(
    request: TransportRequest,
    preferredPool: MockPool | null,
  ): Promise<TransportResponse> {
    if (this.closed) throw new TypeError("Mock agent is closed");
    this.inFlight++;
    try {
      if (!this.active) return await this.dispatchFallback(request);
      const snapshot = await captureMockRequest(request, this.maximumBodyBytes);
      request.signal.throwIfAborted();
      this.history?.record(snapshot);
      if (preferredPool !== null) {
        const dispatch = preferredPool.find(snapshot, this.ignoreTrailingSlash);
        if (dispatch !== null) return await this.reply(dispatch, snapshot, request.signal);
        return await this.dispatchNetwork(replayMockRequest(request, snapshot));
      }
      for (const pool of this.pools) {
        if (!originMatches(pool.origin, request.url.origin)) continue;
        const dispatch = pool.find(snapshot, this.ignoreTrailingSlash);
        if (dispatch !== null) return await this.reply(dispatch, snapshot, request.signal);
      }
      return await this.dispatchNetwork(replayMockRequest(request, snapshot));
    } finally {
      this.inFlight--;
      if (this.closed && this.inFlight === 0) this.inFlightDone?.resolve();
    }
  }

  activate(): void {
    if (this.closed) throw new TypeError("Mock agent is closed");
    this.active = true;
  }

  deactivate(): void {
    if (this.closed) throw new TypeError("Mock agent is closed");
    this.active = false;
  }

  enableNetConnect(matcher?: MockStringMatcher): void {
    if (matcher === undefined) {
      this.allowAllNetwork = true;
      this.networkMatchers.length = 0;
      return;
    }
    this.allowAllNetwork = false;
    this.networkMatchers.push(matcher);
  }

  disableNetConnect(): void {
    this.allowAllNetwork = false;
    this.networkMatchers.length = 0;
  }

  enableCallHistory(): this {
    if (this.history === null) this.history = new MockCallHistory(this.maximumHistoryEntries);
    return this;
  }

  disableCallHistory(): this {
    this.history = null;
    return this;
  }

  getCallHistory(): MockCallHistory | undefined {
    return this.history ?? undefined;
  }

  clearCallHistory(): void {
    this.history?.clear();
  }

  pendingInterceptors(): PendingMockInterceptor[] {
    const result: PendingMockInterceptor[] = [];
    for (const pool of this.pools) {
      for (const dispatch of pool.pending()) {
        result.push({
          origin: pool.origin,
          options: dispatch.options,
          remaining: dispatch.persistent ? null : dispatch.remaining,
          persistent: dispatch.persistent,
        });
      }
    }
    return result;
  }

  assertNoPendingInterceptors(): void {
    const pending = this.pendingInterceptors();
    if (pending.length !== 0) {
      throw new TypeError(String(pending.length) + " mock interceptor(s) remain pending");
    }
  }

  close(): Promise<void> {
    if (this.closeResult !== null) return this.closeResult;
    this.closed = true;
    this.closeResult = this.finishClose();
    return this.closeResult;
  }

  private async finishClose(): Promise<void> {
    if (this.inFlight > 0) {
      this.inFlightDone = Promise.withResolvers<void>();
      await this.inFlightDone.promise;
    }
    const closing: Promise<void>[] = [];
    for (const pool of this.pools) closing.push(pool.close());
    await Promise.all(closing);
  }

  private async reply(
    dispatch: MockDispatch,
    snapshot: MockRequestSnapshot,
    signal: AbortSignal,
  ): Promise<TransportResponse> {
    dispatch.consume();
    if (dispatch.delayMilliseconds > 0) {
      await waitForDelay(this.scheduler, dispatch.delayMilliseconds, signal);
    } else {
      await Promise.resolve();
      signal.throwIfAborted();
    }
    if (dispatch.error !== null) throw dispatch.error;
    if (dispatch.response === null) {
      throw new MockNotMatchedError("Mock interceptor has no configured reply");
    }
    const reply = await dispatch.response(snapshot);
    signal.throwIfAborted();
    if (!Number.isInteger(reply.status) || reply.status < 100 || reply.status > 599) {
      throw new RangeError("Invalid mock response status");
    }
    const body = this.replyBody(reply.body ?? "");
    const headers = new Headers(dispatch.defaultHeaders);
    if (dispatch.addContentLength && body !== null)
      headers.set("content-length", String(body.length));
    this.overrideHeaders(headers, reply.headers ?? []);
    const trailers = new Headers(dispatch.defaultTrailers);
    this.overrideHeaders(trailers, reply.trailers ?? []);
    return {
      status: reply.status,
      statusText: reply.statusText ?? "",
      headers: headers.raw(),
      body: body === null ? null : bytesStream(body),
      trailers: Promise.resolve(trailers.raw()),
    };
  }

  private replyBody(body: MockReplyBody): Uint8Array | null {
    if (body === null) return null;
    return typeof body === "string" ? new TextEncoder().encode(body) : copyBytes(body);
  }

  private overrideHeaders(headers: Headers, entries: readonly HeaderEntry[]): void {
    const replaced: string[] = [];
    for (const [name, value] of entries) {
      const lower = name.toLowerCase();
      if (!replaced.includes(lower)) {
        headers.delete(name);
        replaced.push(lower);
      }
      headers.append(name, value);
    }
  }

  private dispatchNetwork(request: TransportRequest): Promise<TransportResponse> {
    if (!this.networkAllowed(request.url)) {
      return Promise.reject(
        new MockNotMatchedError(
          "Mock request was not matched and network access is disabled for " + request.url.origin,
        ),
      );
    }
    return this.dispatchFallback(request);
  }

  private dispatchFallback(request: TransportRequest): Promise<TransportResponse> {
    if (this.fallback === undefined) {
      return Promise.reject(
        new MockNotMatchedError("Mock request was not matched and no fallback transport exists"),
      );
    }
    return this.fallback.dispatch(request);
  }

  private networkAllowed(url: URLRecord): boolean {
    if (this.allowAllNetwork) return true;
    for (const matcher of this.networkMatchers) {
      if (stringMatches(matcher, url.host)) return true;
    }
    return false;
  }
}
