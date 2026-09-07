import type { AbortSignal } from "../core/abort.ts";
import { LimitError } from "../core/errors.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import type { FetchTransport, TransportRequest, TransportResponse } from "../fetch/transport.ts";
import type { CancelHandle, Scheduler, URLRecord } from "../provider/primitives.ts";
import { bytesStream } from "../streams/readable.ts";
import {
  captureMockRequest,
  replayMockRequest,
  type MockRequestSnapshot,
  type MockStringMatcher,
} from "./mock-agent.ts";

export type SnapshotMode = "record" | "playback" | "update";

export interface SnapshotRequestRecord {
  readonly method: string;
  readonly url: string;
  readonly headers: readonly HeaderEntry[];
  readonly body: Uint8Array | null;
}

export interface SnapshotResponseRecord {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly HeaderEntry[];
  readonly body: Uint8Array | null;
  readonly trailers: readonly HeaderEntry[];
}

/**
 * Portable on-disk/in-database shape. `key` is collision-free canonical material,
 * not a provider hash; a file facade may hash it for names without changing matching.
 */
export interface SnapshotData {
  readonly key: string;
  readonly request: SnapshotRequestRecord;
  responses: SnapshotResponseRecord[];
  callCount: number;
  recordedAtMilliseconds: number;
}

export interface SnapshotInfo {
  readonly key: string;
  readonly request: SnapshotRequestRecord;
  readonly responseCount: number;
  readonly callCount: number;
  readonly recordedAtMilliseconds: number;
}

/** Implementations atomically replace the complete collection or reject. */
export interface SnapshotStore {
  loadAll(): Promise<readonly SnapshotData[]>;

  replaceAll(snapshots: readonly SnapshotData[]): Promise<void>;
}

export type SnapshotBodyNormalizer = (body: Uint8Array | null) => Uint8Array | null;
export type SnapshotQueryNormalizer = (query: string) => string;
export type SnapshotRequestPredicate = (request: SnapshotRequestRecord) => boolean;

export interface SnapshotAgentOptions {
  readonly mode?: SnapshotMode;
  readonly fallback?: FetchTransport;
  readonly store?: SnapshotStore;
  readonly maxSnapshots?: number;
  readonly maxResponsesPerSnapshot?: number;
  readonly maxTotalBytes?: number;
  readonly maxRequestBodyBytes?: number;
  readonly maxResponseBodyBytes?: number;
  readonly autoFlush?: boolean;
  readonly flushIntervalMilliseconds?: number;
  readonly matchHeaders?: readonly string[];
  readonly ignoreHeaders?: readonly string[];
  /** These fields are excluded from both matching and persistent snapshots. */
  readonly excludeHeaders?: readonly string[];
  readonly matchBody?: boolean;
  readonly normalizeBody?: SnapshotBodyNormalizer;
  readonly matchQuery?: boolean;
  readonly normalizeQuery?: SnapshotQueryNormalizer;
  readonly caseSensitiveHeaders?: boolean;
  readonly shouldRecord?: SnapshotRequestPredicate;
  readonly shouldPlayback?: SnapshotRequestPredicate;
  readonly excludeURLs?: readonly MockStringMatcher[];
  /** Inject the environment wall clock; the deterministic default is zero. */
  readonly nowMilliseconds?: () => number;
}

export class SnapshotNotFoundError extends Error {
  readonly code = "UND_SNAPSHOT_NOT_FOUND";

  constructor(method: string, url: string) {
    super("No snapshot found for " + method + " " + url);
    this.name = "SnapshotNotFoundError";
  }
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(name + " must be a positive safe integer");
  }
}

function copyBytes(bytes: Uint8Array | null): Uint8Array | null {
  return bytes === null ? null : bytes.slice();
}

function copyHeaders(headers: readonly HeaderEntry[]): HeaderEntry[] {
  const result: HeaderEntry[] = [];
  for (const [name, value] of headers) result.push([name, value]);
  return result;
}

function copyRequest(request: SnapshotRequestRecord): SnapshotRequestRecord {
  return {
    method: request.method,
    url: request.url,
    headers: copyHeaders(request.headers),
    body: copyBytes(request.body),
  };
}

function copyResponse(response: SnapshotResponseRecord): SnapshotResponseRecord {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: copyHeaders(response.headers),
    body: copyBytes(response.body),
    trailers: copyHeaders(response.trailers),
  };
}

function copySnapshot(snapshot: SnapshotData): SnapshotData {
  const responses: SnapshotResponseRecord[] = [];
  for (const response of snapshot.responses) responses.push(copyResponse(response));
  return {
    key: snapshot.key,
    request: copyRequest(snapshot.request),
    responses,
    callCount: snapshot.callCount,
    recordedAtMilliseconds: snapshot.recordedAtMilliseconds,
  };
}

export class MemorySnapshotStore implements SnapshotStore {
  private snapshots: SnapshotData[] = [];

  constructor(initial: readonly SnapshotData[] = []) {
    for (const snapshot of initial) this.snapshots.push(copySnapshot(snapshot));
  }

  async loadAll(): Promise<readonly SnapshotData[]> {
    const result: SnapshotData[] = [];
    for (const snapshot of this.snapshots) result.push(copySnapshot(snapshot));
    return result;
  }

  async replaceAll(snapshots: readonly SnapshotData[]): Promise<void> {
    const replacement: SnapshotData[] = [];
    for (const snapshot of snapshots) replacement.push(copySnapshot(snapshot));
    this.snapshots = replacement;
  }
}

interface PreparedRequest {
  readonly key: string;
  readonly record: SnapshotRequestRecord;
}

interface CapturedResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly HeaderEntry[];
  readonly body: Uint8Array | null;
  readonly trailers: readonly HeaderEntry[] | null;
}

interface RecorderOptions {
  readonly store: SnapshotStore;
  readonly scheduler: Scheduler;
  readonly maximumSnapshots: number;
  readonly maximumResponsesPerSnapshot: number;
  readonly maximumTotalBytes: number;
  readonly maximumRequestBodyBytes: number;
  readonly maximumResponseBodyBytes: number;
  readonly autoFlush: boolean;
  readonly flushIntervalMilliseconds: number;
  readonly matchHeaders: readonly string[];
  readonly ignoreHeaders: readonly string[];
  readonly excludeHeaders: readonly string[];
  readonly matchBody: boolean;
  readonly normalizeBody: SnapshotBodyNormalizer | undefined;
  readonly matchQuery: boolean;
  readonly normalizeQuery: SnapshotQueryNormalizer | undefined;
  readonly caseSensitiveHeaders: boolean;
  readonly shouldRecord: SnapshotRequestPredicate | undefined;
  readonly shouldPlayback: SnapshotRequestPredicate | undefined;
  readonly excludeURLs: readonly MockStringMatcher[];
  readonly nowMilliseconds: () => number;
}

function normalHeaderName(name: string, caseSensitive: boolean): string {
  return caseSensitive ? name : name.toLowerCase();
}

function containsHeader(names: readonly string[], name: string, caseSensitive: boolean): boolean {
  const normal = normalHeaderName(name, caseSensitive);
  for (const candidate of names) {
    if (normalHeaderName(candidate, caseSensitive) === normal) return true;
  }
  return false;
}

function filterHeadersForStorage(
  headers: readonly HeaderEntry[],
  excluded: readonly string[],
  caseSensitive: boolean,
): HeaderEntry[] {
  const result: HeaderEntry[] = [];
  for (const [name, value] of headers) {
    if (containsHeader(excluded, name, caseSensitive)) continue;
    result.push([normalHeaderName(name, caseSensitive), value]);
  }
  return result;
}

function filterHeadersForMatching(
  headers: readonly HeaderEntry[],
  options: RecorderOptions,
): HeaderEntry[] {
  const result: HeaderEntry[] = [];
  for (const [name, value] of headers) {
    if (containsHeader(options.excludeHeaders, name, options.caseSensitiveHeaders)) continue;
    if (containsHeader(options.ignoreHeaders, name, options.caseSensitiveHeaders)) continue;
    if (
      options.matchHeaders.length !== 0 &&
      !containsHeader(options.matchHeaders, name, options.caseSensitiveHeaders)
    ) {
      continue;
    }
    result.push([normalHeaderName(name, options.caseSensitiveHeaders), value]);
  }
  result.sort((left, right) => {
    if (left[0] < right[0]) return -1;
    if (left[0] > right[0]) return 1;
    if (left[1] < right[1]) return -1;
    if (left[1] > right[1]) return 1;
    return 0;
  });
  return result;
}

function queryWithoutQuestionMark(search: string): string {
  return search.startsWith("?") ? search.slice(1) : search;
}

function normalizedURL(url: URLRecord, options: RecorderOptions): string {
  if (!options.matchQuery) return url.origin + url.pathname;
  const rawQuery = queryWithoutQuestionMark(url.search);
  const query = options.normalizeQuery?.(rawQuery) ?? rawQuery;
  return url.origin + url.pathname + (query === "" ? "" : "?" + query);
}

function keyPart(value: string): string {
  return String(value.length) + ":" + value;
}

function bytesKey(bytes: Uint8Array | null): string {
  if (bytes === null) return "null";
  const digits = "0123456789abcdef";
  let result = "";
  for (const byte of bytes) {
    result += digits.charAt(byte >>> 4) + digits.charAt(byte & 15);
  }
  return result;
}

function requestKey(
  method: string,
  url: string,
  headers: readonly HeaderEntry[],
  body: Uint8Array | null,
): string {
  let result = keyPart(method) + keyPart(url);
  for (const [name, value] of headers) result += keyPart(name) + keyPart(value);
  return result + keyPart(bytesKey(body));
}

function stringMatcherMatches(matcher: MockStringMatcher, value: string): boolean {
  if (typeof matcher === "string") return value.toLowerCase().includes(matcher.toLowerCase());
  if (matcher instanceof RegExp) {
    const previous = matcher.lastIndex;
    matcher.lastIndex = 0;
    const result = matcher.test(value);
    matcher.lastIndex = previous;
    return result;
  }
  return matcher(value);
}

function estimateHeaders(headers: readonly HeaderEntry[]): number {
  let size = 0;
  for (const [name, value] of headers) size += (name.length + value.length) * 2;
  return size;
}

function estimateSnapshot(snapshot: SnapshotData): number {
  let size =
    (snapshot.key.length + snapshot.request.method.length + snapshot.request.url.length) * 2;
  size += estimateHeaders(snapshot.request.headers) + (snapshot.request.body?.length ?? 0);
  for (const response of snapshot.responses) {
    size += response.statusText.length * 2;
    size += estimateHeaders(response.headers) + estimateHeaders(response.trailers);
    size += response.body?.length ?? 0;
  }
  return size;
}

function validateResponse(
  response: SnapshotResponseRecord,
  maximumResponseBodyBytes: number,
): void {
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    throw new TypeError("Snapshot response status is invalid");
  }
  if ((response.body?.length ?? 0) > maximumResponseBodyBytes) {
    throw new LimitError("Snapshot response body exceeds configured limit");
  }
}

function validateSnapshot(snapshot: SnapshotData, options: RecorderOptions): number {
  if (snapshot.responses.length < 1) throw new TypeError("Snapshot has no responses");
  if (snapshot.responses.length > options.maximumResponsesPerSnapshot) {
    throw new LimitError("Snapshot response count exceeds configured limit");
  }
  if (!Number.isSafeInteger(snapshot.callCount) || snapshot.callCount < 0) {
    throw new TypeError("Snapshot call count is invalid");
  }
  if (!Number.isFinite(snapshot.recordedAtMilliseconds)) {
    throw new TypeError("Snapshot recorded time is invalid");
  }
  if ((snapshot.request.body?.length ?? 0) > options.maximumRequestBodyBytes) {
    throw new LimitError("Snapshot request body exceeds configured limit");
  }
  for (const response of snapshot.responses)
    validateResponse(response, options.maximumResponseBodyBytes);
  return estimateSnapshot(snapshot);
}

export class SnapshotRecorder {
  readonly maximumRequestBodyBytes: number;
  readonly maximumResponseBodyBytes: number;
  private readonly options: RecorderOptions;
  private snapshots: SnapshotData[] = [];
  private totalBytes = 0;
  private dirty = false;
  private version = 0;
  private flushTimer: CancelHandle | null = null;
  private saveTail: Promise<void> = Promise.resolve();

  constructor(options: RecorderOptions) {
    this.options = options;
    this.maximumRequestBodyBytes = options.maximumRequestBodyBytes;
    this.maximumResponseBodyBytes = options.maximumResponseBodyBytes;
  }

  isURLExcluded(url: string): boolean {
    for (const matcher of this.options.excludeURLs) {
      if (stringMatcherMatches(matcher, url)) return true;
    }
    return false;
  }

  prepare(snapshot: MockRequestSnapshot): PreparedRequest {
    let body = this.options.matchBody ? copyBytes(snapshot.body) : null;
    if (this.options.matchBody && this.options.normalizeBody !== undefined) {
      body = copyBytes(this.options.normalizeBody(copyBytes(body)));
      if ((body?.length ?? 0) > this.maximumRequestBodyBytes) {
        throw new LimitError("Normalized snapshot request body exceeds configured limit");
      }
    }
    const url = normalizedURL(snapshot.url, this.options);
    const storedHeaders = filterHeadersForStorage(
      snapshot.headers,
      this.options.excludeHeaders,
      this.options.caseSensitiveHeaders,
    );
    const matchHeaders = filterHeadersForMatching(snapshot.headers, this.options);
    const record: SnapshotRequestRecord = {
      method: snapshot.method,
      url,
      headers: storedHeaders,
      body,
    };
    return {
      key: requestKey(snapshot.method, url, matchHeaders, body),
      record,
    };
  }

  prepareResponse(response: CapturedResponse): SnapshotResponseRecord {
    return {
      status: response.status,
      statusText: response.statusText,
      headers: filterHeadersForStorage(
        response.headers,
        this.options.excludeHeaders,
        this.options.caseSensitiveHeaders,
      ),
      body: copyBytes(response.body),
      trailers: filterHeadersForStorage(
        response.trailers ?? [],
        this.options.excludeHeaders,
        this.options.caseSensitiveHeaders,
      ),
    };
  }

  mayRecord(request: SnapshotRequestRecord): boolean {
    return this.options.shouldRecord?.(copyRequest(request)) ?? true;
  }

  mayPlayback(request: SnapshotRequestRecord): boolean {
    return this.options.shouldPlayback?.(copyRequest(request)) ?? true;
  }

  find(key: string): SnapshotResponseRecord | null {
    for (const snapshot of this.snapshots) {
      if (snapshot.key !== key) continue;
      const position = Math.min(snapshot.callCount, snapshot.responses.length - 1);
      if (snapshot.callCount < Number.MAX_SAFE_INTEGER) snapshot.callCount++;
      const response = snapshot.responses[position];
      if (response === undefined) throw new TypeError("Snapshot response sequence is empty");
      return copyResponse(response);
    }
    return null;
  }

  record(prepared: PreparedRequest, response: SnapshotResponseRecord): void {
    validateResponse(response, this.options.maximumResponseBodyBytes);
    for (const snapshot of this.snapshots) {
      if (snapshot.key !== prepared.key) continue;
      if (snapshot.responses.length >= this.options.maximumResponsesPerSnapshot) {
        throw new LimitError("Snapshot response count exceeds configured limit");
      }
      const recordedAtMilliseconds = this.readNow();
      const addition = estimateSnapshot({
        key: "",
        request: { method: "", url: "", headers: [], body: null },
        responses: [response],
        callCount: 0,
        recordedAtMilliseconds: 0,
      });
      if (estimateSnapshot(snapshot) + addition > this.options.maximumTotalBytes) {
        throw new LimitError("Snapshot response sequence exceeds configured total byte limit");
      }
      this.makeRoom(addition, snapshot);
      snapshot.responses = [...snapshot.responses, copyResponse(response)];
      snapshot.recordedAtMilliseconds = recordedAtMilliseconds;
      this.totalBytes += addition;
      this.changed();
      return;
    }

    const recordedAtMilliseconds = this.readNow();
    const snapshot: SnapshotData = {
      key: prepared.key,
      request: copyRequest(prepared.record),
      responses: [copyResponse(response)],
      callCount: 0,
      recordedAtMilliseconds,
    };
    const size = validateSnapshot(snapshot, this.options);
    if (size > this.options.maximumTotalBytes) {
      throw new LimitError("Snapshot exceeds configured total byte limit");
    }
    while (this.snapshots.length >= this.options.maximumSnapshots) this.evictOldest(null);
    this.makeRoom(size, null);
    this.snapshots.push(snapshot);
    this.totalBytes += size;
    this.changed();
  }

  async loadSnapshots(): Promise<void> {
    await this.saveTail;
    const loaded = await this.options.store.loadAll();
    if (loaded.length > this.options.maximumSnapshots) {
      throw new LimitError("Snapshot count exceeds configured limit");
    }
    const replacement: SnapshotData[] = [];
    let totalBytes = 0;
    const keys: string[] = [];
    for (const candidate of loaded) {
      const snapshot = copySnapshot(candidate);
      if (keys.includes(snapshot.key))
        throw new TypeError("Snapshot store contains a duplicate key");
      if (snapshot.key !== this.keyFromRecord(snapshot.request)) {
        throw new TypeError("Snapshot key does not match its recorded request");
      }
      keys.push(snapshot.key);
      totalBytes += validateSnapshot(snapshot, this.options);
      if (totalBytes > this.options.maximumTotalBytes) {
        throw new LimitError("Stored snapshots exceed configured total byte limit");
      }
      replacement.push(snapshot);
    }
    this.snapshots = replacement;
    this.totalBytes = totalBytes;
    this.dirty = false;
    this.version++;
  }

  saveSnapshots(): Promise<void> {
    this.flushTimer?.cancel();
    this.flushTimer = null;
    const version = this.version;
    const data = this.getSnapshots();
    const saving = this.saveTail.then(() => this.options.store.replaceAll(data));
    this.saveTail = saving.then(
      () => {},
      () => {},
    );
    return saving.then(() => {
      if (this.version === version) this.dirty = false;
      if (this.dirty) this.scheduleFlush();
    });
  }

  getSnapshots(): SnapshotData[] {
    const result: SnapshotData[] = [];
    for (const snapshot of this.snapshots) result.push(copySnapshot(snapshot));
    return result;
  }

  size(): number {
    return this.snapshots.length;
  }

  clear(): void {
    if (this.snapshots.length === 0) return;
    this.snapshots.length = 0;
    this.totalBytes = 0;
    this.changed();
  }

  resetCallCounts(): void {
    for (const snapshot of this.snapshots) snapshot.callCount = 0;
  }

  deleteSnapshot(key: string): boolean {
    for (let index = 0; index < this.snapshots.length; index++) {
      const snapshot = this.snapshots[index];
      if (snapshot === undefined || snapshot.key !== key) continue;
      this.totalBytes -= estimateSnapshot(snapshot);
      this.snapshots.splice(index, 1);
      this.changed();
      return true;
    }
    return false;
  }

  getSnapshotInfo(key: string): SnapshotInfo | null {
    for (const snapshot of this.snapshots) {
      if (snapshot.key !== key) continue;
      return {
        key: snapshot.key,
        request: copyRequest(snapshot.request),
        responseCount: snapshot.responses.length,
        callCount: snapshot.callCount,
        recordedAtMilliseconds: snapshot.recordedAtMilliseconds,
      };
    }
    return null;
  }

  replaceSnapshots(snapshots: readonly SnapshotData[]): void {
    if (snapshots.length > this.options.maximumSnapshots) {
      throw new LimitError("Snapshot count exceeds configured limit");
    }
    const replacement: SnapshotData[] = [];
    const keys: string[] = [];
    let totalBytes = 0;
    for (const candidate of snapshots) {
      const snapshot = copySnapshot(candidate);
      if (keys.includes(snapshot.key)) throw new TypeError("Snapshots contain a duplicate key");
      if (snapshot.key !== this.keyFromRecord(snapshot.request)) {
        throw new TypeError("Snapshot key does not match its recorded request");
      }
      keys.push(snapshot.key);
      totalBytes += validateSnapshot(snapshot, this.options);
      if (totalBytes > this.options.maximumTotalBytes) {
        throw new LimitError("Snapshots exceed configured total byte limit");
      }
      replacement.push(snapshot);
    }
    this.snapshots = replacement;
    this.totalBytes = totalBytes;
    this.changed();
  }

  async close(save: boolean): Promise<void> {
    this.flushTimer?.cancel();
    this.flushTimer = null;
    if (save && this.dirty) await this.saveSnapshots();
    else await this.saveTail;
  }

  private changed(): void {
    this.version++;
    this.dirty = true;
    this.scheduleFlush();
  }

  private keyFromRecord(request: SnapshotRequestRecord): string {
    return requestKey(
      request.method,
      request.url,
      filterHeadersForMatching(request.headers, this.options),
      this.options.matchBody ? request.body : null,
    );
  }

  private readNow(): number {
    const result = this.options.nowMilliseconds();
    if (!Number.isFinite(result)) {
      throw new TypeError("Snapshot wall clock returned a non-finite value");
    }
    return result;
  }

  private scheduleFlush(): void {
    if (!this.options.autoFlush || !this.dirty || this.flushTimer !== null) return;
    this.flushTimer = this.options.scheduler.delay(this.options.flushIntervalMilliseconds, () => {
      this.flushTimer = null;
      this.saveSnapshots().catch((error) => this.options.scheduler.reportError(error));
    });
  }

  private makeRoom(addition: number, protectedSnapshot: SnapshotData | null): void {
    while (this.totalBytes + addition > this.options.maximumTotalBytes) {
      if (!this.evictOldest(protectedSnapshot)) {
        throw new LimitError("Snapshots exceed configured total byte limit");
      }
    }
  }

  private evictOldest(protectedSnapshot: SnapshotData | null): boolean {
    for (let index = 0; index < this.snapshots.length; index++) {
      const snapshot = this.snapshots[index];
      if (snapshot === undefined || snapshot === protectedSnapshot) continue;
      this.snapshots.splice(index, 1);
      this.totalBytes -= estimateSnapshot(snapshot);
      return true;
    }
    return false;
  }
}

async function captureBody(
  response: TransportResponse,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  if (response.body === null) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const item = await reader.read();
      if (item.done) break;
      length += item.value.length;
      if (length > maximumBytes) {
        const error = new LimitError("Snapshot response body exceeds configured limit");
        await reader.cancel(error);
        throw error;
      }
      chunks.push(item.value.slice());
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
  return body;
}

async function captureResponse(
  response: TransportResponse,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<CapturedResponse> {
  const body = await captureBody(response, maximumBytes, signal);
  signal.throwIfAborted();
  const trailers = response.trailers === undefined ? null : copyHeaders(await response.trailers);
  signal.throwIfAborted();
  return {
    status: response.status,
    statusText: response.statusText,
    headers: copyHeaders(response.headers),
    body,
    trailers,
  };
}

function transportResponse(response: CapturedResponse): TransportResponse {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: copyHeaders(response.headers),
    body: response.body === null ? null : bytesStream(response.body),
    trailers:
      response.trailers === null ? undefined : Promise.resolve(copyHeaders(response.trailers)),
  };
}

function recordedTransportResponse(response: SnapshotResponseRecord): TransportResponse {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: copyHeaders(response.headers),
    body: response.body === null ? null : bytesStream(response.body),
    trailers: Promise.resolve(copyHeaders(response.trailers)),
  };
}

function defaultNow(): number {
  return 0;
}

export class SnapshotAgent implements FetchTransport {
  private readonly mode: SnapshotMode;
  private readonly fallback: FetchTransport | undefined;
  private readonly recorder: SnapshotRecorder;
  private loaded: boolean;
  private loading: Promise<void> | null = null;
  private closed = false;
  private inFlight = 0;
  private inFlightDone: PromiseWithResolvers<void> | null = null;
  private closeResult: Promise<void> | null = null;

  constructor(scheduler: Scheduler, options: SnapshotAgentOptions = {}) {
    const mode = options.mode ?? "record";
    if (mode !== "record" && mode !== "playback" && mode !== "update") {
      throw new TypeError("Invalid snapshot mode");
    }
    const maximumSnapshots = options.maxSnapshots ?? 1000;
    const maximumResponsesPerSnapshot = options.maxResponsesPerSnapshot ?? 1000;
    const maximumTotalBytes = options.maxTotalBytes ?? 256 * 1024 * 1024;
    const maximumRequestBodyBytes = options.maxRequestBodyBytes ?? 16 * 1024 * 1024;
    const maximumResponseBodyBytes = options.maxResponseBodyBytes ?? 64 * 1024 * 1024;
    const flushIntervalMilliseconds = options.flushIntervalMilliseconds ?? 30000;
    validatePositiveInteger(maximumSnapshots, "Snapshot count limit");
    validatePositiveInteger(maximumResponsesPerSnapshot, "Snapshot response count limit");
    validatePositiveInteger(maximumTotalBytes, "Snapshot total byte limit");
    validatePositiveInteger(maximumRequestBodyBytes, "Snapshot request body limit");
    validatePositiveInteger(maximumResponseBodyBytes, "Snapshot response body limit");
    validatePositiveInteger(flushIntervalMilliseconds, "Snapshot flush interval");
    this.mode = mode;
    this.fallback = options.fallback;
    if (mode !== "playback" && this.fallback === undefined) {
      throw new TypeError("Record and update snapshot modes require a fallback transport");
    }
    if ((options.excludeURLs?.length ?? 0) !== 0 && this.fallback === undefined) {
      throw new TypeError("Excluded snapshot URLs require a fallback transport");
    }
    this.loaded = mode === "record";
    this.recorder = new SnapshotRecorder({
      store: options.store ?? new MemorySnapshotStore(),
      scheduler,
      maximumSnapshots,
      maximumResponsesPerSnapshot,
      maximumTotalBytes,
      maximumRequestBodyBytes,
      maximumResponseBodyBytes,
      autoFlush: options.autoFlush ?? false,
      flushIntervalMilliseconds,
      matchHeaders: options.matchHeaders ?? [],
      ignoreHeaders: options.ignoreHeaders ?? [],
      excludeHeaders: options.excludeHeaders ?? [],
      matchBody: options.matchBody ?? true,
      normalizeBody: options.normalizeBody,
      matchQuery: options.matchQuery ?? true,
      normalizeQuery: options.normalizeQuery,
      caseSensitiveHeaders: options.caseSensitiveHeaders ?? false,
      shouldRecord: options.shouldRecord,
      shouldPlayback: options.shouldPlayback,
      excludeURLs: options.excludeURLs ?? [],
      nowMilliseconds: options.nowMilliseconds ?? defaultNow,
    });
  }

  async dispatch(request: TransportRequest): Promise<TransportResponse> {
    if (this.closed) throw new TypeError("Snapshot agent is closed");
    this.inFlight++;
    try {
      if (this.recorder.isURLExcluded(request.url.href)) return await this.dispatchLive(request);
      await this.ensureLoaded();
      const captured = await captureMockRequest(request, this.recorder.maximumRequestBodyBytes);
      request.signal.throwIfAborted();
      const prepared = this.recorder.prepare(captured);
      if (
        (this.mode === "playback" || this.mode === "update") &&
        this.recorder.mayPlayback(prepared.record)
      ) {
        const found = this.recorder.find(prepared.key);
        if (found !== null) {
          await Promise.resolve();
          request.signal.throwIfAborted();
          return recordedTransportResponse(found);
        }
      }
      if (this.mode === "playback") {
        throw new SnapshotNotFoundError(prepared.record.method, prepared.record.url);
      }
      const live = await this.dispatchLive(replayMockRequest(request, captured));
      if (!this.recorder.mayRecord(prepared.record)) return live;
      const response = await captureResponse(
        live,
        this.recorder.maximumResponseBodyBytes,
        request.signal,
      );
      this.recorder.record(prepared, this.recorder.prepareResponse(response));
      return transportResponse(response);
    } finally {
      this.inFlight--;
      if (this.closed && this.inFlight === 0) this.inFlightDone?.resolve();
    }
  }

  getMode(): SnapshotMode {
    return this.mode;
  }

  getRecorder(): SnapshotRecorder {
    return this.recorder;
  }

  async loadSnapshots(): Promise<void> {
    if (this.loading !== null) return await this.loading;
    const loading = this.recorder.loadSnapshots();
    this.loading = loading;
    try {
      await loading;
      this.loaded = true;
    } finally {
      if (this.loading === loading) this.loading = null;
    }
  }

  async saveSnapshots(): Promise<void> {
    await this.ensureLoaded();
    await this.recorder.saveSnapshots();
  }

  clearSnapshots(): void {
    this.recorder.clear();
  }

  resetCallCounts(): void {
    this.recorder.resetCallCounts();
  }

  deleteSnapshot(key: string): boolean {
    return this.recorder.deleteSnapshot(key);
  }

  getSnapshotInfo(key: string): SnapshotInfo | null {
    return this.recorder.getSnapshotInfo(key);
  }

  replaceSnapshots(snapshots: readonly SnapshotData[]): void {
    this.recorder.replaceSnapshots(snapshots);
    this.loaded = true;
  }

  close(): Promise<void> {
    if (this.closeResult !== null) return this.closeResult;
    this.closed = true;
    this.closeResult = this.finishClose();
    return this.closeResult;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.loadSnapshots();
  }

  private async dispatchLive(request: TransportRequest): Promise<TransportResponse> {
    if (this.fallback === undefined) {
      throw new TypeError("Snapshot agent has no fallback transport");
    }
    return await this.fallback.dispatch(request);
  }

  private async finishClose(): Promise<void> {
    if (this.inFlight > 0) {
      this.inFlightDone = Promise.withResolvers<void>();
      await this.inFlightDone.promise;
    }
    await this.recorder.close(this.mode !== "playback");
  }
}
