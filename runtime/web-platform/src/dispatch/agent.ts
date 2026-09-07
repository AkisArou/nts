import type { FetchTransport, TransportRequest, TransportResponse } from "../fetch/transport.ts";

export interface OriginDispatcherStats {
  readonly connections: number;
  readonly pending: number;
  readonly running: number;
}

/** A provider dispatcher dedicated to one canonical HTTP(S) origin. */
export interface OriginDispatcher extends FetchTransport {
  /** True only when eviction cannot interrupt a request or live response body. */
  readonly idle: boolean;
  readonly stats: OriginDispatcherStats;

  close(): Promise<void>;

  destroy(reason: unknown): Promise<void>;
}

/** Provider-owned protocol/connection selection for one origin. */
export interface OriginDispatcherFactory {
  create(origin: string): OriginDispatcher;
}

export interface AgentOptions {
  readonly factory: OriginDispatcherFactory;
  /** Bounds retained origin dispatchers. Infinity disables the bound. */
  readonly maximumOrigins?: number;
  /** Bounds requests waiting to create or replace an origin dispatcher. */
  readonly maximumPendingOrigins?: number;
}

export interface AgentOriginStats extends OriginDispatcherStats {
  readonly origin: string;
  readonly idle: boolean;
}

export interface AgentStats {
  readonly origins: number;
  readonly idleOrigins: number;
  readonly connections: number;
  readonly pending: number;
  readonly running: number;
  readonly dispatched: number;
  readonly evicted: number;
  readonly pendingOriginAcquisitions: number;
  readonly entries: readonly AgentOriginStats[];
}

interface AgentRecord {
  readonly origin: string;
  readonly dispatcher: OriginDispatcher;
}

export class AgentOriginLimitError extends Error {
  readonly code = "UND_ERR_MAX_ORIGINS_REACHED";
  readonly maximumOrigins: number;

  constructor(maximumOrigins: number) {
    super("The maximum number of active origins has been reached");
    this.name = "AgentOriginLimitError";
    this.maximumOrigins = maximumOrigins;
  }
}

export class AgentPendingLimitError extends Error {
  readonly code = "UND_ERR_AGENT_QUEUE_FULL";
  readonly maximumPendingOrigins: number;

  constructor(maximumPendingOrigins: number) {
    super("The Agent origin-creation queue is full");
    this.name = "AgentPendingLimitError";
    this.maximumPendingOrigins = maximumPendingOrigins;
  }
}

function originOf(request: TransportRequest): string {
  if (request.url.protocol !== "http:" && request.url.protocol !== "https:") {
    throw new TypeError("Agent requests require an HTTP(S) URL");
  }
  if (request.url.host === "") throw new TypeError("Agent requests require a nonempty host");
  return request.url.protocol + "//" + request.url.host;
}

function promiseFrom(action: () => Promise<void>): Promise<void> {
  try {
    return action();
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * Environment-owned multi-origin dispatcher.
 *
 * The map order is an LRU: a successful lookup moves its record to the end. A new
 * origin evicts only the oldest dispatcher whose provider reports it fully idle,
 * and waits for that close before constructing the replacement. Thus a configured
 * origin bound is a resource bound rather than only a bound on map entries.
 */
export class Agent implements FetchTransport {
  private readonly factory: OriginDispatcherFactory;
  private readonly maximumOrigins: number;
  private readonly maximumPendingOrigins: number;
  private readonly records = new Map<string, AgentRecord>();
  private readonly owned = new Set<OriginDispatcher>();
  private mutation: Promise<void> = Promise.resolve();
  private closeResult: Promise<void> | null = null;
  private destroyResult: Promise<void> | null = null;
  private accepting = true;
  private destroyedState = false;
  private dispatchedCount = 0;
  private evictedCount = 0;
  private pendingOriginAcquisitions = 0;

  constructor(options: AgentOptions) {
    this.factory = options.factory;
    this.maximumOrigins = options.maximumOrigins ?? Infinity;
    this.maximumPendingOrigins = options.maximumPendingOrigins ?? 256;
    if (
      this.maximumOrigins !== Infinity &&
      (!Number.isSafeInteger(this.maximumOrigins) || this.maximumOrigins < 1)
    ) {
      throw new RangeError("maximumOrigins must be a positive safe integer or Infinity");
    }
    if (!Number.isSafeInteger(this.maximumPendingOrigins) || this.maximumPendingOrigins < 1) {
      throw new RangeError("maximumPendingOrigins must be a positive safe integer");
    }
  }

  get closed(): boolean {
    return !this.accepting;
  }

  get destroyed(): boolean {
    return this.destroyedState;
  }

  dispatch(request: TransportRequest): Promise<TransportResponse> {
    if (!this.accepting) return Promise.reject(new TypeError("Agent is closed"));
    if (request.signal.aborted) return Promise.reject(request.signal.reason);

    let origin: string;
    try {
      origin = originOf(request);
    } catch (error) {
      return Promise.reject(error);
    }

    const existing = this.records.get(origin);
    if (existing !== undefined) {
      this.touch(existing);
      this.dispatchedCount++;
      return this.dispatchWith(existing.dispatcher, request);
    }

    if (this.pendingOriginAcquisitions >= this.maximumPendingOrigins) {
      return Promise.reject(new AgentPendingLimitError(this.maximumPendingOrigins));
    }
    this.pendingOriginAcquisitions++;
    const acquired = this.serializeMutation(() => this.acquire(origin, request));
    return acquired.then(
      (record) => {
        this.pendingOriginAcquisitions--;
        this.dispatchedCount++;
        return this.dispatchWith(record.dispatcher, request);
      },
      (error) => {
        this.pendingOriginAcquisitions--;
        throw error;
      },
    );
  }

  close(): Promise<void> {
    if (this.destroyResult !== null) return this.destroyResult;
    if (this.closeResult !== null) return this.closeResult;
    this.accepting = false;
    this.closeResult = this.finishClose();
    return this.closeResult;
  }

  destroy(reason: unknown = new TypeError("Agent destroyed")): Promise<void> {
    if (this.destroyResult !== null) return this.destroyResult;
    this.accepting = false;
    this.destroyResult = this.finishDestroy(reason);
    return this.destroyResult;
  }

  get stats(): AgentStats {
    let idleOrigins = 0;
    let connections = 0;
    let pending = 0;
    let running = 0;
    const entries: AgentOriginStats[] = [];
    for (const record of this.records.values()) {
      const stats = record.dispatcher.stats;
      if (record.dispatcher.idle) idleOrigins++;
      connections += stats.connections;
      pending += stats.pending;
      running += stats.running;
      entries.push({
        origin: record.origin,
        idle: record.dispatcher.idle,
        connections: stats.connections,
        pending: stats.pending,
        running: stats.running,
      });
    }
    return {
      origins: this.records.size,
      idleOrigins,
      connections,
      pending,
      running,
      dispatched: this.dispatchedCount,
      evicted: this.evictedCount,
      pendingOriginAcquisitions: this.pendingOriginAcquisitions,
      entries,
    };
  }

  private dispatchWith(
    dispatcher: OriginDispatcher,
    request: TransportRequest,
  ): Promise<TransportResponse> {
    try {
      return dispatcher.dispatch(request);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private touch(record: AgentRecord): void {
    this.records.delete(record.origin);
    this.records.set(record.origin, record);
  }

  private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation);
    this.mutation = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private async acquire(origin: string, request: TransportRequest): Promise<AgentRecord> {
    request.signal.throwIfAborted();
    const raced = this.records.get(origin);
    if (raced !== undefined) {
      this.touch(raced);
      return raced;
    }

    if (this.records.size >= this.maximumOrigins) {
      let evicted: AgentRecord | null = null;
      for (const candidate of this.records.values()) {
        if (!candidate.dispatcher.idle) continue;
        evicted = candidate;
        break;
      }
      if (evicted === null) throw new AgentOriginLimitError(this.maximumOrigins);
      this.records.delete(evicted.origin);
      try {
        await promiseFrom(() => evicted.dispatcher.close());
      } catch (error) {
        this.records.set(evicted.origin, evicted);
        throw error;
      }
      this.owned.delete(evicted.dispatcher);
      this.evictedCount++;
      request.signal.throwIfAborted();
    }

    const dispatcher = this.factory.create(origin);
    const record = { origin, dispatcher };
    this.records.set(origin, record);
    this.owned.add(dispatcher);
    return record;
  }

  private async finishClose(): Promise<void> {
    await this.mutation;
    if (this.destroyResult !== null) return this.destroyResult;
    const closing: Promise<void>[] = [];
    for (const dispatcher of this.owned) closing.push(promiseFrom(() => dispatcher.close()));
    this.records.clear();
    try {
      await Promise.all(closing);
    } finally {
      this.owned.clear();
      this.destroyedState = true;
    }
  }

  private async finishDestroy(reason: unknown): Promise<void> {
    await this.mutation;
    const destroying: Promise<void>[] = [];
    for (const dispatcher of this.owned) {
      destroying.push(promiseFrom(() => dispatcher.destroy(reason)));
    }
    this.records.clear();
    try {
      await Promise.all(destroying);
    } finally {
      this.owned.clear();
      this.destroyedState = true;
    }
  }
}

/** A standalone, single-origin dispatcher over one provider-owned transport. */
export class Client implements FetchTransport {
  readonly origin: string;
  private readonly dispatcher: OriginDispatcher;
  private closeResult: Promise<void> | null = null;
  private destroyResult: Promise<void> | null = null;
  private accepting = true;
  private destroyedState = false;

  constructor(origin: string, dispatcher: OriginDispatcher) {
    if (origin === "") throw new TypeError("Client origin must not be empty");
    this.origin = origin;
    this.dispatcher = dispatcher;
  }

  get closed(): boolean {
    return !this.accepting;
  }

  get destroyed(): boolean {
    return this.destroyedState;
  }

  get stats(): OriginDispatcherStats {
    return this.dispatcher.stats;
  }

  dispatch(request: TransportRequest): Promise<TransportResponse> {
    if (!this.accepting) return Promise.reject(new TypeError("Client is closed"));
    let origin: string;
    try {
      origin = originOf(request);
    } catch (error) {
      return Promise.reject(error);
    }
    if (origin !== this.origin) {
      return Promise.reject(new TypeError("Client request origin does not match its origin"));
    }
    try {
      return this.dispatcher.dispatch(request);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  close(): Promise<void> {
    if (this.destroyResult !== null) return this.destroyResult;
    if (this.closeResult !== null) return this.closeResult;
    this.accepting = false;
    this.closeResult = promiseFrom(() => this.dispatcher.close()).finally(() => {
      this.destroyedState = true;
    });
    return this.closeResult;
  }

  destroy(reason: unknown = new TypeError("Client destroyed")): Promise<void> {
    if (this.destroyResult !== null) return this.destroyResult;
    this.accepting = false;
    this.destroyResult = promiseFrom(() => this.dispatcher.destroy(reason)).finally(() => {
      this.destroyedState = true;
    });
    return this.destroyResult;
  }
}
