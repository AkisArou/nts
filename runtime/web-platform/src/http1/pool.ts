import { AbortController } from "../core/abort.ts";
import type { AbortSignal } from "../core/abort.ts";
import { LimitError } from "../core/errors.ts";
import type {
  ByteConnection,
  CancelHandle,
  ConnectAddress,
  Scheduler,
  SocketConnector,
} from "../provider/primitives.ts";
import { BufferedReader } from "./io.ts";

export interface PoolOptions {
  maxConnections?: number;
  maxConnectionsPerOrigin?: number;
  maxPending?: number;
  idleTimeoutMs?: number;
}

interface RecordEntry {
  key: string;
  connection: ByteConnection;
  reader: BufferedReader;
  busy: boolean;
  timer: CancelHandle | null;
}

interface Waiter {
  key: string;
  address: ConnectAddress;
  signal: AbortSignal;
  result: PromiseWithResolvers<ConnectionLease>;
  unsubscribe: () => void;
  previous: Waiter | null;
  next: Waiter | null;
  queued: boolean;
  settled: boolean;
}

function resolveWaiter(waiter: Waiter, lease: ConnectionLease): void {
  if (waiter.settled) return;
  waiter.settled = true;
  waiter.result.resolve(lease);
}

function rejectWaiter(waiter: Waiter, reason: unknown): void {
  if (waiter.settled) return;
  waiter.settled = true;
  waiter.result.reject(reason);
}

export class ConnectionLease {
  readonly connection: ByteConnection;
  readonly reader: BufferedReader;
  private readonly record: RecordEntry;
  private readonly pool: ConnectionPool;
  private released = false;

  constructor(record: RecordEntry, pool: ConnectionPool) {
    this.connection = record.connection;
    this.reader = record.reader;
    this.record = record;
    this.pool = pool;
  }

  release(reusable: boolean): void {
    if (this.released) return;
    this.released = true;
    this.pool.release(this.record, reusable);
  }

  /**
   * Gives the connection to the caller and forgets it, without closing it.
   *
   * A protocol switch ends this pool's interest in the socket while the socket is very
   * much still alive: `release(false)` would close it, and `release(true)` would offer
   * a connection now speaking someone else's protocol to the next HTTP request. The
   * accounting is freed either way, so a detached connection does not go on occupying
   * a slot it no longer competes for.
   */
  detach(): void {
    if (this.released) return;
    this.released = true;
    this.pool.detach(this.record);
  }
}

export class ConnectionPool {
  private readonly connector: SocketConnector;
  private readonly scheduler: Scheduler;
  private readonly maxConnections: number;
  private readonly maxPerOrigin: number;
  private readonly maxPending: number;
  private readonly idleTimeoutMs: number;
  private readonly records = new Set<RecordEntry>();
  private readonly counts = new Map<string, number>();
  private firstPending: Waiter | null = null;
  private lastPending: Waiter | null = null;
  private pendingCount = 0;
  private readonly connecting = new Map<Waiter, AbortController>();
  private total = 0;
  private accepting = true;
  private destroyed = false;
  private drainResult: Promise<void> | null = null;
  private drainResolve: (() => void) | null = null;

  constructor(connector: SocketConnector, scheduler: Scheduler, options: PoolOptions = {}) {
    this.connector = connector;
    this.scheduler = scheduler;
    this.maxConnections = options.maxConnections ?? 64;
    this.maxPerOrigin = options.maxConnectionsPerOrigin ?? 8;
    this.maxPending = options.maxPending ?? 256;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 15000;
    for (const value of [this.maxConnections, this.maxPerOrigin, this.maxPending]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Invalid pool capacity");
    }
    if (!Number.isFinite(this.idleTimeoutMs) || this.idleTimeoutMs < 0)
      throw new RangeError("Invalid pool idle timeout");
  }

  acquire(address: ConnectAddress, signal: AbortSignal): Promise<ConnectionLease> {
    if (!this.accepting) return Promise.reject(new TypeError("Connection pool is closed"));
    if (signal.aborted) return Promise.reject(signal.reason);
    if (this.pendingCount >= this.maxPending)
      return Promise.reject(new LimitError("Connection pool queue is full"));
    const key = (address.secure ? "tls:" : "tcp:") + address.hostname + ":" + address.port;
    const waiter: Waiter = {
      key,
      address,
      signal,
      result: Promise.withResolvers(),
      unsubscribe: () => {},
      previous: null,
      next: null,
      queued: false,
      settled: false,
    };
    waiter.unsubscribe = signal.subscribe(() => {
      rejectWaiter(waiter, signal.reason);
      this.connecting.get(waiter)?.abort(signal.reason);
      if (waiter.queued) {
        this.removePending(waiter);
        this.pump();
      }
    });
    this.appendPending(waiter);
    this.pump();
    return waiter.result.promise;
  }

  private appendPending(waiter: Waiter): void {
    waiter.previous = this.lastPending;
    waiter.queued = true;
    if (this.lastPending === null) this.firstPending = waiter;
    else this.lastPending.next = waiter;
    this.lastPending = waiter;
    this.pendingCount++;
  }

  private removePending(waiter: Waiter): void {
    if (!waiter.queued) return;
    const previous = waiter.previous;
    const next = waiter.next;
    if (previous === null) this.firstPending = next;
    else previous.next = next;
    if (next === null) this.lastPending = previous;
    else next.previous = previous;
    waiter.previous = null;
    waiter.next = null;
    waiter.queued = false;
    this.pendingCount--;
  }

  private changeCount(key: string, delta: number): void {
    const count = (this.counts.get(key) ?? 0) + delta;
    if (count === 0) this.counts.delete(key);
    else this.counts.set(key, count);
    this.total += delta;
  }
  private drop(record: RecordEntry): void {
    if (!this.records.delete(record)) return;
    record.timer?.cancel();
    record.connection.close();
    this.changeCount(record.key, -1);
  }

  /** @internal Forget a record without closing it; see {@link ConnectionLease.detach}. */
  detach(record: RecordEntry): void {
    if (!this.records.delete(record)) return;
    record.timer?.cancel();
    this.changeCount(record.key, -1);
    this.pump();
  }
  private pump(): void {
    if (this.destroyed) return;
    for (const record of this.records)
      if (!record.busy && record.connection.closed) this.drop(record);
    let waiter = this.firstPending;
    while (waiter !== null) {
      const current = waiter;
      const next = current.next;
      if (current.settled) {
        this.removePending(current);
        current.unsubscribe();
        waiter = next;
        continue;
      }
      let idle: RecordEntry | undefined;
      for (const record of this.records)
        if (!record.busy && record.key === current.key) {
          idle = record;
          break;
        }
      if (idle !== undefined) {
        this.removePending(current);
        idle.busy = true;
        idle.timer?.cancel();
        idle.timer = null;
        current.unsubscribe();
        resolveWaiter(current, new ConnectionLease(idle, this));
        waiter = next;
        continue;
      }
      // Reclaim an unrelated idle connection before blocking on the global cap.
      if (this.total >= this.maxConnections) {
        for (const record of this.records)
          if (!record.busy) {
            this.drop(record);
            break;
          }
      }
      if (
        this.total >= this.maxConnections ||
        (this.counts.get(current.key) ?? 0) >= this.maxPerOrigin
      ) {
        waiter = next;
        continue;
      }
      this.removePending(current);
      this.changeCount(current.key, 1);
      const controller = new AbortController();
      this.connecting.set(current, controller);
      Promise.resolve()
        .then(() => this.connector.connect(current.address, controller.signal))
        .then(
          (connection) => {
            this.connecting.delete(current);
            current.unsubscribe();
            if (this.destroyed || current.settled || current.signal.aborted) {
              connection.close();
              this.changeCount(current.key, -1);
              rejectWaiter(
                current,
                current.signal.aborted
                  ? current.signal.reason
                  : new TypeError("Connection pool closed"),
              );
            } else {
              const record: RecordEntry = {
                key: current.key,
                connection,
                reader: new BufferedReader(connection),
                busy: true,
                timer: null,
              };
              this.records.add(record);
              resolveWaiter(current, new ConnectionLease(record, this));
            }
            this.pump();
          },
          (error) => {
            this.connecting.delete(current);
            current.unsubscribe();
            this.changeCount(current.key, -1);
            rejectWaiter(current, error);
            this.pump();
          },
        );
      waiter = next;
    }
    this.checkDrained();
  }

  /** @internal */ release(record: RecordEntry, reusable: boolean): void {
    if (!this.records.has(record)) return;
    if (
      !reusable ||
      !this.accepting ||
      record.connection.closed ||
      record.reader.bufferedBytes !== 0 ||
      this.idleTimeoutMs === 0
    ) {
      this.drop(record);
    } else {
      record.busy = false;
      record.timer = this.scheduler.delay(this.idleTimeoutMs, () => {
        this.drop(record);
        this.pump();
      });
    }
    this.pump();
  }

  close(): void {
    if (this.destroyed) return;
    this.accepting = false;
    this.destroyed = true;
    for (const [waiter, controller] of this.connecting) {
      const error = new TypeError("Connection pool is closed");
      rejectWaiter(waiter, error);
      controller.abort(error);
    }
    for (const record of this.records) this.drop(record);
    let waiter = this.firstPending;
    while (waiter !== null) {
      const next = waiter.next;
      this.removePending(waiter);
      waiter.unsubscribe();
      rejectWaiter(waiter, new TypeError("Connection pool is closed"));
      waiter = next;
    }
    const resolve = this.drainResolve;
    this.drainResolve = null;
    resolve?.();
  }

  drain(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this.drainResult !== null) return this.drainResult;
    this.accepting = false;
    const result = Promise.withResolvers<void>();
    this.drainResult = result.promise;
    this.drainResolve = result.resolve;
    for (const record of this.records) if (!record.busy) this.drop(record);
    this.pump();
    this.checkDrained();
    return this.drainResult;
  }

  private checkDrained(): void {
    if (
      this.accepting ||
      this.destroyed ||
      this.drainResolve === null ||
      this.pendingCount !== 0 ||
      this.connecting.size !== 0 ||
      this.records.size !== 0
    ) {
      return;
    }
    const resolve = this.drainResolve;
    this.drainResolve = null;
    resolve();
  }

  get stats(): { connections: number; pending: number; idle: number } {
    let idle = 0;
    for (const record of this.records) if (!record.busy) idle++;
    return { connections: this.total, pending: this.pendingCount, idle };
  }
}
