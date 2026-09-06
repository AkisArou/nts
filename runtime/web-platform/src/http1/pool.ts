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
  started: boolean;
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
  private pending: Waiter[] = [];
  private readonly connecting = new Map<Waiter, AbortController>();
  private total = 0;
  private closed = false;

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
    if (this.closed) return Promise.reject(new TypeError("Connection pool is closed"));
    if (signal.aborted) return Promise.reject(signal.reason);
    if (this.pending.length >= this.maxPending)
      return Promise.reject(new LimitError("Connection pool queue is full"));
    const key = (address.secure ? "tls:" : "tcp:") + address.hostname + ":" + address.port;
    const waiter: Waiter = {
      key,
      address,
      signal,
      result: Promise.withResolvers(),
      unsubscribe: () => {},
      started: false,
      settled: false,
    };
    waiter.unsubscribe = signal.subscribe(() => {
      rejectWaiter(waiter, signal.reason);
      this.connecting.get(waiter)?.abort(signal.reason);
      if (!waiter.started) {
        this.pending = this.pending.filter((item) => item !== waiter);
        this.pump();
      }
    });
    this.pending.push(waiter);
    this.pump();
    return waiter.result.promise;
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
  private pump(): void {
    if (this.closed) return;
    for (const record of this.records)
      if (!record.busy && record.connection.closed) this.drop(record);
    for (let i = 0; i < this.pending.length;) {
      const waiter = this.pending[i];
      if (waiter === undefined) break;
      if (waiter.settled) {
        this.pending.splice(i, 1);
        waiter.unsubscribe();
        continue;
      }
      let idle: RecordEntry | undefined;
      for (const record of this.records)
        if (!record.busy && record.key === waiter.key) {
          idle = record;
          break;
        }
      if (idle !== undefined) {
        this.pending.splice(i, 1);
        idle.busy = true;
        idle.timer?.cancel();
        idle.timer = null;
        waiter.unsubscribe();
        resolveWaiter(waiter, new ConnectionLease(idle, this));
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
        (this.counts.get(waiter.key) ?? 0) >= this.maxPerOrigin
      ) {
        i++;
        continue;
      }
      this.pending.splice(i, 1);
      waiter.started = true;
      this.changeCount(waiter.key, 1);
      const controller = new AbortController();
      this.connecting.set(waiter, controller);
      Promise.resolve()
        .then(() => this.connector.connect(waiter.address, controller.signal))
        .then(
          (connection) => {
            this.connecting.delete(waiter);
            waiter.unsubscribe();
            if (this.closed || waiter.settled || waiter.signal.aborted) {
              connection.close();
              this.changeCount(waiter.key, -1);
              rejectWaiter(
                waiter,
                waiter.signal.aborted
                  ? waiter.signal.reason
                  : new TypeError("Connection pool closed"),
              );
            } else {
              const record: RecordEntry = {
                key: waiter.key,
                connection,
                reader: new BufferedReader(connection),
                busy: true,
                timer: null,
              };
              this.records.add(record);
              resolveWaiter(waiter, new ConnectionLease(record, this));
            }
            this.pump();
          },
          (error) => {
            this.connecting.delete(waiter);
            waiter.unsubscribe();
            this.changeCount(waiter.key, -1);
            rejectWaiter(waiter, error);
            this.pump();
          },
        );
    }
  }
  /** @internal */ release(record: RecordEntry, reusable: boolean): void {
    if (!this.records.has(record)) return;
    if (
      !reusable ||
      this.closed ||
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
    if (this.closed) return;
    this.closed = true;
    for (const [waiter, controller] of this.connecting) {
      const error = new TypeError("Connection pool is closed");
      rejectWaiter(waiter, error);
      controller.abort(error);
    }
    for (const record of this.records) this.drop(record);
    for (const waiter of this.pending.splice(0)) {
      waiter.unsubscribe();
      rejectWaiter(waiter, new TypeError("Connection pool is closed"));
    }
  }

  get stats(): { connections: number; pending: number; idle: number } {
    let idle = 0;
    for (const record of this.records) if (!record.busy) idle++;
    return { connections: this.total, pending: this.pending.length, idle };
  }
}
