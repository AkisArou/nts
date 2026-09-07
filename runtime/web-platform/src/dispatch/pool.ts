import { TransportError } from "../fetch/transport.ts";
import type { TransportRequest, TransportResponse } from "../fetch/transport.ts";
import type { URLRecord } from "../provider/primitives.ts";
import type { OriginDispatcher, OriginDispatcherStats } from "./agent.ts";

export interface PoolStats extends OriginDispatcherStats {
  readonly dispatchers: number;
  readonly idleDispatchers: number;
  readonly dispatched: number;
}

function promiseFrom(action: () => Promise<void>): Promise<void> {
  try {
    return action();
  } catch (error) {
    return Promise.reject(error);
  }
}

function dispatchWith(
  dispatcher: OriginDispatcher,
  request: TransportRequest,
): Promise<TransportResponse> {
  try {
    return dispatcher.dispatch(request);
  } catch (error) {
    return Promise.reject(error);
  }
}

/** A fixed-size, same-origin dispatcher pool with deterministic round-robin selection. */
export class RoundRobinPool implements OriginDispatcher {
  private readonly dispatchers: readonly OriginDispatcher[];
  private nextIndex = 0;
  private dispatchedCount = 0;
  private accepting = true;
  private destroyedState = false;
  private closeResult: Promise<void> | null = null;
  private destroyResult: Promise<void> | null = null;

  constructor(dispatchers: readonly OriginDispatcher[]) {
    if (dispatchers.length === 0) {
      throw new RangeError("A round-robin pool requires at least one dispatcher");
    }
    this.dispatchers = dispatchers.slice();
  }

  get closed(): boolean {
    return !this.accepting;
  }

  get destroyed(): boolean {
    return this.destroyedState;
  }

  get idle(): boolean {
    for (const dispatcher of this.dispatchers) if (!dispatcher.idle) return false;
    return true;
  }

  get stats(): PoolStats {
    let connections = 0;
    let pending = 0;
    let running = 0;
    let idleDispatchers = 0;
    for (const dispatcher of this.dispatchers) {
      const stats = dispatcher.stats;
      connections += stats.connections;
      pending += stats.pending;
      running += stats.running;
      if (dispatcher.idle) idleDispatchers++;
    }
    return {
      dispatchers: this.dispatchers.length,
      idleDispatchers,
      connections,
      pending,
      running,
      dispatched: this.dispatchedCount,
    };
  }

  dispatch(request: TransportRequest): Promise<TransportResponse> {
    if (!this.accepting) return Promise.reject(new TypeError("Pool is closed"));
    if (request.signal.aborted) return Promise.reject(request.signal.reason);
    const dispatcher = this.dispatchers[this.nextIndex];
    if (dispatcher === undefined) {
      return Promise.reject(new TypeError("Pool has no dispatcher at its selected index"));
    }
    this.nextIndex = (this.nextIndex + 1) % this.dispatchers.length;
    this.dispatchedCount++;
    return dispatchWith(dispatcher, request);
  }

  close(): Promise<void> {
    if (this.destroyResult !== null) return this.destroyResult;
    if (this.closeResult !== null) return this.closeResult;
    this.accepting = false;
    const closing: Promise<void>[] = [];
    for (const dispatcher of this.dispatchers) {
      closing.push(promiseFrom(() => dispatcher.close()));
    }
    this.closeResult = Promise.all(closing)
      .then(() => {})
      .finally(() => {
        this.destroyedState = true;
      });
    return this.closeResult;
  }

  destroy(reason: unknown = new TypeError("Pool destroyed")): Promise<void> {
    if (this.destroyResult !== null) return this.destroyResult;
    this.accepting = false;
    const destroying: Promise<void>[] = [];
    for (const dispatcher of this.dispatchers) {
      destroying.push(promiseFrom(() => dispatcher.destroy(reason)));
    }
    this.destroyResult = Promise.all(destroying)
      .then(() => {})
      .finally(() => {
        this.destroyedState = true;
      });
    return this.destroyResult;
  }
}

/** The common Pool contract uses deterministic round-robin selection. */
export class Pool extends RoundRobinPool {}

export interface BalancedPoolUpstream {
  /** A parsed canonical upstream; its path, query, fragment and credentials are ignored. */
  readonly url: URLRecord;
  readonly dispatcher: OriginDispatcher;
  readonly weight?: number;
}

export interface BalancedPoolOptions {
  readonly maximumUpstreams?: number;
  /** Amount removed after a typed transport failure and restored after success. */
  readonly errorPenalty?: number;
}

export interface BalancedPoolUpstreamStats extends OriginDispatcherStats {
  readonly origin: string;
  readonly configuredWeight: number;
  readonly healthWeight: number;
  readonly idle: boolean;
  readonly dispatched: number;
  readonly failures: number;
}

export interface BalancedPoolStats extends OriginDispatcherStats {
  readonly upstreams: number;
  readonly idleUpstreams: number;
  readonly dispatched: number;
  readonly entries: readonly BalancedPoolUpstreamStats[];
}

interface BalancedRecord {
  readonly origin: string;
  readonly url: URLRecord;
  readonly dispatcher: OriginDispatcher;
  readonly configuredWeight: number;
  healthWeight: number;
  currentWeight: number;
  dispatched: number;
  failures: number;
}

const MAXIMUM_BALANCING_VALUE = 1_000_000;

export class BalancedPoolMissingUpstreamError extends Error {
  readonly code = "UND_ERR_BPL_MISSING_UPSTREAM";

  constructor() {
    super("No upstream is available in the balanced pool");
    this.name = "BalancedPoolMissingUpstreamError";
  }
}

export class BalancedPoolLimitError extends Error {
  readonly code = "UND_ERR_BPL_UPSTREAM_LIMIT";
  readonly maximumUpstreams: number;

  constructor(maximumUpstreams: number) {
    super("The balanced pool upstream limit has been reached");
    this.name = "BalancedPoolLimitError";
    this.maximumUpstreams = maximumUpstreams;
  }
}

function upstreamOrigin(url: URLRecord): string {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Balanced pool upstreams require an HTTP(S) URL");
  }
  if (url.host === "") throw new TypeError("Balanced pool upstreams require a nonempty host");
  if (url.username !== "" || url.password !== "") {
    throw new TypeError("Balanced pool upstream URLs cannot contain credentials");
  }
  return url.protocol + "//" + url.host;
}

function routedRequest(request: TransportRequest, upstream: BalancedRecord): TransportRequest {
  const url: URLRecord = {
    href: upstream.origin + request.url.pathname + request.url.search + request.url.hash,
    protocol: upstream.url.protocol,
    hostname: upstream.url.hostname,
    port: upstream.url.port,
    host: upstream.url.host,
    origin: upstream.origin,
    pathname: request.url.pathname,
    search: request.url.search,
    hash: request.url.hash,
    username: "",
    password: "",
  };
  return {
    url,
    method: request.method,
    headers: request.headers,
    body: request.body,
    bodyLength: request.bodyLength,
    replayBody: request.replayBody,
    signal: request.signal,
  };
}

/** Smooth weighted round-robin over mutable, provider-owned upstream dispatchers. */
export class BalancedPool implements OriginDispatcher {
  private readonly records = new Map<string, BalancedRecord>();
  /** Includes records removed from selection while their graceful close is pending. */
  private readonly owned = new Set<OriginDispatcher>();
  private readonly maximumUpstreams: number;
  private readonly errorPenalty: number;
  private accepting = true;
  private destroyedState = false;
  private dispatchedCount = 0;
  private closeResult: Promise<void> | null = null;
  private destroyResult: Promise<void> | null = null;

  constructor(upstreams: readonly BalancedPoolUpstream[] = [], options: BalancedPoolOptions = {}) {
    this.maximumUpstreams = options.maximumUpstreams ?? 64;
    this.errorPenalty = options.errorPenalty ?? 15;
    for (const [value, name] of [
      [this.maximumUpstreams, "maximumUpstreams"],
      [this.errorPenalty, "errorPenalty"],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1 || value > MAXIMUM_BALANCING_VALUE) {
        throw new RangeError(name + " must be an integer from 1 through 1000000");
      }
    }
    for (const upstream of upstreams) this.addUpstream(upstream);
  }

  get closed(): boolean {
    return !this.accepting;
  }

  get destroyed(): boolean {
    return this.destroyedState;
  }

  get idle(): boolean {
    for (const record of this.records.values()) if (!record.dispatcher.idle) return false;
    return true;
  }

  get upstreams(): readonly string[] {
    return Array.from(this.records.keys());
  }

  get stats(): BalancedPoolStats {
    let connections = 0;
    let pending = 0;
    let running = 0;
    let idleUpstreams = 0;
    const entries: BalancedPoolUpstreamStats[] = [];
    for (const record of this.records.values()) {
      const stats = record.dispatcher.stats;
      if (record.dispatcher.idle) idleUpstreams++;
      connections += stats.connections;
      pending += stats.pending;
      running += stats.running;
      entries.push({
        origin: record.origin,
        configuredWeight: record.configuredWeight,
        healthWeight: record.healthWeight,
        idle: record.dispatcher.idle,
        dispatched: record.dispatched,
        failures: record.failures,
        connections: stats.connections,
        pending: stats.pending,
        running: stats.running,
      });
    }
    return {
      upstreams: this.records.size,
      idleUpstreams,
      dispatched: this.dispatchedCount,
      connections,
      pending,
      running,
      entries,
    };
  }

  addUpstream(upstream: BalancedPoolUpstream): boolean {
    if (!this.accepting) throw new TypeError("Balanced pool is closed");
    const origin = upstreamOrigin(upstream.url);
    if (this.records.has(origin)) return false;
    if (this.records.size >= this.maximumUpstreams) {
      throw new BalancedPoolLimitError(this.maximumUpstreams);
    }
    const weight = upstream.weight ?? 100;
    if (!Number.isSafeInteger(weight) || weight < 1 || weight > MAXIMUM_BALANCING_VALUE) {
      throw new RangeError("Upstream weight must be an integer from 1 through 1000000");
    }
    this.records.set(origin, {
      origin,
      url: upstream.url,
      dispatcher: upstream.dispatcher,
      configuredWeight: weight,
      healthWeight: weight,
      currentWeight: 0,
      dispatched: 0,
      failures: 0,
    });
    this.owned.add(upstream.dispatcher);
    return true;
  }

  removeUpstream(origin: string): Promise<boolean> {
    const record = this.records.get(origin);
    if (record === undefined) return Promise.resolve(false);
    this.records.delete(origin);
    return promiseFrom(() => record.dispatcher.close()).then(
      () => {
        this.owned.delete(record.dispatcher);
        return true;
      },
      (error) => {
        if (this.accepting && !this.records.has(origin)) this.records.set(origin, record);
        throw error;
      },
    );
  }

  /** Provider lifecycle hooks use this when a response body or live connection fails later. */
  reportFailure(origin: string, error: unknown): boolean {
    const record = this.records.get(origin);
    if (record === undefined || !(error instanceof TransportError)) return false;
    record.failures++;
    record.healthWeight = Math.max(1, record.healthWeight - this.errorPenalty);
    return true;
  }

  /** A successful provider lifecycle event restores one health step. */
  reportSuccess(origin: string): boolean {
    const record = this.records.get(origin);
    if (record === undefined) return false;
    record.healthWeight = Math.min(
      record.configuredWeight,
      record.healthWeight + this.errorPenalty,
    );
    return true;
  }

  dispatch(request: TransportRequest): Promise<TransportResponse> {
    if (!this.accepting) return Promise.reject(new TypeError("Balanced pool is closed"));
    if (request.signal.aborted) return Promise.reject(request.signal.reason);
    let selected: BalancedRecord;
    try {
      selected = this.select();
    } catch (error) {
      return Promise.reject(error);
    }
    selected.dispatched++;
    this.dispatchedCount++;
    return dispatchWith(selected.dispatcher, routedRequest(request, selected)).then(
      (response) => {
        this.restoreRecord(selected);
        return response;
      },
      (error) => {
        this.penalizeRecord(selected, error);
        throw error;
      },
    );
  }

  close(): Promise<void> {
    if (this.destroyResult !== null) return this.destroyResult;
    if (this.closeResult !== null) return this.closeResult;
    this.accepting = false;
    const closing: Promise<void>[] = [];
    for (const dispatcher of this.owned) closing.push(promiseFrom(() => dispatcher.close()));
    this.records.clear();
    this.closeResult = Promise.all(closing).then(() => {
      this.owned.clear();
      this.destroyedState = true;
    });
    return this.closeResult;
  }

  destroy(reason: unknown = new TypeError("Balanced pool destroyed")): Promise<void> {
    if (this.destroyResult !== null) return this.destroyResult;
    this.accepting = false;
    const destroying: Promise<void>[] = [];
    for (const dispatcher of this.owned) {
      destroying.push(promiseFrom(() => dispatcher.destroy(reason)));
    }
    this.records.clear();
    this.destroyResult = Promise.all(destroying).then(() => {
      this.owned.clear();
      this.destroyedState = true;
    });
    return this.destroyResult;
  }

  private select(): BalancedRecord {
    if (this.records.size === 0) throw new BalancedPoolMissingUpstreamError();
    let selected: BalancedRecord | null = null;
    let total = 0;
    for (const record of this.records.values()) {
      record.currentWeight += record.healthWeight;
      total += record.healthWeight;
      if (selected === null || record.currentWeight > selected.currentWeight) {
        selected = record;
      }
    }
    if (selected === null) throw new BalancedPoolMissingUpstreamError();
    selected.currentWeight -= total;
    return selected;
  }

  private penalizeRecord(record: BalancedRecord, error: unknown): void {
    if (!(error instanceof TransportError)) return;
    record.failures++;
    record.healthWeight = Math.max(1, record.healthWeight - this.errorPenalty);
  }

  private restoreRecord(record: BalancedRecord): void {
    record.healthWeight = Math.min(
      record.configuredWeight,
      record.healthWeight + this.errorPenalty,
    );
  }
}
