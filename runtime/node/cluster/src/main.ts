// `node:cluster`, the primary and the worker in one file.
//
// # Why one file where node has two
//
// node's `lib/cluster.js` is three lines: it reads `NODE_UNIQUE_ID` from the
// environment and requires `internal/cluster/primary` or `internal/cluster/child`
// accordingly, so the module a program gets *is* one role or the other. The two
// surfaces are different -- 16 published names in a primary, 10 in a worker, partly
// overlapping -- and `shape.mjs` is where this profile assembles a published surface,
// so the role is decided here and the surface is trimmed there.
//
// # What is here, and what a test actually needs
//
// The handshake, because everything else rests on it. A primary forks a child with
// `NODE_UNIQUE_ID` in its environment; the child's copy of this module sees it, becomes
// a worker, and announces itself with `{ cmd: 'NODE_CLUSTER', act: 'online' }`. That
// `NODE_` prefix is what routes it to `internalMessage` rather than `message`, which is
// why `child_process` had to learn that distinction first. The primary answers by
// setting the worker's state and emitting `online` on both the worker and itself.
//
// # What is deliberately absent
//
// Handle distribution -- `round_robin_handle` and `shared_handle` -- and therefore
// `listening`. A worker that calls `net.createServer().listen()` asks the primary for a
// server handle over the channel, and the primary either shares the descriptor or
// accepts connections itself and passes sockets round. That is the half of `cluster`
// that makes it interesting and it is not here yet, so `_getServer` answers with an
// error rather than silence: a worker that tries to listen finds out.

import { EventEmitter } from "../../events/src/main.ts";
import { fork as forkChild } from "../../child_process/src/main.ts";
import { createServer } from "../../net/src/main.ts";
import type { Server, Socket } from "../../net/src/main.ts";
import type { ChildProcess } from "../../child_process/src/main.ts";

declare function nts_process_env(name: string): string;
/**
 * The current process's channel, which a worker answers through.
 *
 * `node:process` in this profile has no `send`, `connected` or `disconnect` -- nothing
 * needed them until a module could be a forked child of itself -- so a worker reaches
 * the host's, and these three names say so. They go when `process` grows a channel.
 */
declare function nts_cluster_self_connected(): boolean;
declare function nts_cluster_self_disconnect(): void;
declare function nts_cluster_self_send(message: unknown): boolean;
declare function nts_process_env_has(name: string): boolean;

/** `undefined` rather than `""` for a name nothing set, which is what node's env does. */
function environment(name: string): string | undefined {
  return nts_process_env_has(name) ? nts_process_env(name) : undefined;
}

export const SCHED_NONE = 1;
export const SCHED_RR = 2;

const uniqueId = environment("NODE_UNIQUE_ID");

/** True in a process this module forked, which is what decides the whole surface. */
export const isWorker = uniqueId !== undefined && uniqueId !== "";
export const isPrimary = !isWorker;
/** node kept the old spelling working and so does this. */
export const isMaster = isPrimary;

export interface ClusterSettings {
  execArgv?: readonly string[] | undefined;
  exec?: string | undefined;
  args?: readonly string[] | undefined;
  cwd?: string | undefined;
  silent?: boolean | undefined;
  serialization?: string | undefined;
}

/**
 * `SCHED_RR` unless the environment says otherwise.
 *
 * node reads `NODE_CLUSTER_SCHED_POLICY` and accepts `rr` and `none`; anything else is
 * an error there rather than a default, and that is not implemented here.
 */
function schedulingPolicyFromEnvironment(): number {
  const named = environment("NODE_CLUSTER_SCHED_POLICY");
  if (named === "none") return SCHED_NONE;
  return SCHED_RR;
}

export let schedulingPolicy = schedulingPolicyFromEnvironment();

/**
 * One forked process, from the primary's side.
 *
 * `process` is the `ChildProcess` and the pair is deliberately not merged: node keeps
 * them apart so `worker.process.kill()` and `worker.kill()` can differ -- the second
 * asks the worker to leave and the first does not.
 */
export class Worker extends EventEmitter {
  id = 0;
  process!: ChildProcess;
  state = "none";
  exitedAfterDisconnect = false;
  /**
   * Whether this object is the worker the *current* process is, rather than a child the
   * primary forked. The two answer the same questions through different channels: a
   * primary asks the ChildProcess it holds, a worker asks its own process.
   */
  isSelf = false;

  /** Whether the channel is still open. `false` the moment `disconnect` begins. */
  isConnected(): boolean {
    if (this.isSelf) return nts_cluster_self_connected();
    return this.process.connected === true;
  }

  /** Whether the process is gone. */
  isDead(): boolean {
    if (this.isSelf) return false;
    return this.process.exitCode !== null || this.process.signalCode !== null;
  }

  send(message: unknown, handle?: unknown, callback?: unknown): boolean {
    if (this.isSelf) return nts_cluster_self_send(message);
    const send = this.process.send;
    if (send === undefined) return false;
    return send(message, handle, callback);
  }

  kill(signal?: string | number): void {
    this.destroy(signal);
  }

  /**
   * `kill` under its other name, and node's own comment says why both exist: `destroy`
   * was first and `kill` reads better beside `process.kill`.
   */
  destroy(signal?: string | number): void {
    this.exitedAfterDisconnect = true;
    if (this.isConnected()) {
      this.process.once("disconnect", (): void => {
        this.process.kill(signal);
      });
      this.disconnect();
      return;
    }
    this.process.kill(signal);
  }

  disconnect(): this {
    this.exitedAfterDisconnect = true;
    if (this.isSelf) {
      nts_cluster_self_disconnect();
      return this;
    }
    const disconnect = this.process.disconnect;
    if (disconnect !== undefined) disconnect();
    return this;
  }
}

class Cluster extends EventEmitter {
  readonly SCHED_NONE = SCHED_NONE;
  readonly SCHED_RR = SCHED_RR;
  readonly Worker = Worker;
  isPrimary = isPrimary;
  isMaster = isMaster;
  isWorker = isWorker;
  schedulingPolicy = schedulingPolicy;
  settings: ClusterSettings = {};
  workers: Record<string, Worker> = {};
  /** The worker this process *is*, present only in a worker. */
  worker: Worker | undefined = undefined;

  #nextId = 0;
  #seq = 0;
  readonly #distributions = new Map<string, Distribution>();

  setupPrimary(options?: ClusterSettings): void {
    const merged: ClusterSettings = { ...this.settings, ...(options ?? {}) };
    this.settings = merged;
    this.emit("setup", merged);
  }

  /** node kept the old spelling working and so does this. */
  setupMaster(options?: ClusterSettings): void {
    this.setupPrimary(options);
  }

  fork(env?: Record<string, string>): Worker {
    this.#nextId += 1;
    const id = this.#nextId;
    const worker = new Worker();
    worker.id = id;
    const settings = this.settings;
    // node defaults `exec` to `process.argv[1]`, so a fork with no settings re-runs the
    // file that forked it -- which is how every one of its own tests is written.
    const argv = nts_process_argv();
    const modulePath = settings.exec ?? (argv.length > 1 ? argv[1]! : argv[0]!);
    const child = forkChild(modulePath, (settings.args ?? []) as string[], {
      // `NODE_UNIQUE_ID` is how the child's copy of this module learns it is a worker,
      // and it has to be *this* id: the primary looks the worker up by it when the
      // handshake comes back.
      env: { ...inheritedEnvironment(), ...(env ?? {}), NODE_UNIQUE_ID: `${id}` },
      cwd: settings.cwd,
      silent: settings.silent,
      execArgv: settings.execArgv === undefined ? undefined : [...settings.execArgv],
      serialization: settings.serialization,
    });
    worker.process = child;
    this.workers[`${id}`] = worker;

    // The internal channel, not the ordinary one: everything below travels with a
    // `NODE_CLUSTER` command and must not reach a program's `message` listener.
    child.on("internalMessage", (message: unknown): void => {
      this.#onInternal(worker, message);
    });
    // The ordinary channel, re-emitted on the worker and on cluster itself. node does
    // both, and a program that only ever holds the `Worker` would otherwise have no way
    // to hear its own worker: `worker.on('message')` was silent.
    child.on("message", (message: unknown, handle?: unknown): void => {
      worker.emit("message", message, handle);
      this.emit("message", worker, message, handle);
    });
    child.on("exit", (code: number | null, signal: string | null): void => {
      worker.state = "dead";
      // **A listener outlives its last worker unless this runs.** A worker that leaves by
      // exiting rather than by closing its server never sends `close`, so the primary's
      // listening socket stays open, the event loop stays alive, and the process hangs
      // after the test has already passed -- which reads as "an exit handler failed" and
      // not as a leak. node removes a departing worker from every handle for the same
      // reason.
      this.#releaseWorker(worker);
      delete this.workers[`${id}`];
      worker.emit("exit", code, signal);
      this.emit("exit", worker, code, signal);
    });
    child.on("disconnect", (): void => {
      worker.state = "disconnected";
      worker.emit("disconnect");
      this.emit("disconnect", worker);
    });
    child.on("error", (error: Error): void => {
      worker.emit("error", error);
    });

    this.emit("fork", worker);
    return worker;
  }

  /**
   * One internal message from one worker.
   *
   * An acknowledgement is dispatched first, because a worker's reply to `newconn` carries
   * `ack` and no `act` -- reading `act` first would drop it. Then the acts this module
   * implements. Anything else is **answered** with ENOTSUP rather than ignored: node's
   * worker waits for the acknowledgement, so silence is a hang, and one unanswered
   * `queryServer` held a file for eighteen minutes before its per-file timeout.
   */
  #onInternal(worker: Worker, message: unknown): void {
    const ack = ackOf(message);
    if (ack !== undefined) {
      for (const distribution of this.#distributions.values()) {
        const pending = distribution.waiting.get(ack);
        if (pending === undefined) continue;
        distribution.waiting.delete(ack);
        if (acceptedOf(message)) {
          // The worker took it. Nothing to do but offer the next one.
        } else {
          // It is shutting down: put the connection back for somebody else.
          const socket = distribution.handedTo.get(ack);
          if (socket !== undefined) distribution.pending.unshift(socket);
        }
        distribution.handedTo.delete(ack);
        pending();
        return;
      }
      return;
    }

    const act = actOf(message);
    if (act === "online") {
      worker.state = "online";
      worker.emit("online");
      this.emit("online", worker);
      return;
    }
    if (act === "queryServer") {
      this.#queryServer(worker, message);
      return;
    }
    if (act === "listening") {
      worker.state = "listening";
      const address = addressOf(message);
      worker.emit("listening", address);
      this.emit("listening", worker, address);
      return;
    }
    if (act === "close") {
      this.#closeServer(worker, message);
      return;
    }
    if (act === "exitedAfterDisconnect") {
      worker.exitedAfterDisconnect = true;
      const seq = seqOf(message);
      if (seq !== undefined) worker.send({ cmd: "NODE_CLUSTER", ack: seq });
      return;
    }
    const seq = seqOf(message);
    if (seq !== undefined) {
      worker.send({ cmd: "NODE_CLUSTER", ack: seq, errno: "ENOTSUP" });
    }
  }

  /**
   * A worker wants to serve an address, and the primary binds it once.
   *
   * The key is node's: address, port, addressType and fd, with the worker's index added
   * when the port is 0 -- because port 0 means "any port" and two workers asking for it
   * want two different listeners rather than a share of one.
   */
  #queryServer(worker: Worker, message: unknown): void {
    if (worker.exitedAfterDisconnect) return;
    const seq = seqOf(message);
    const asked = message as {
      address?: unknown; port?: unknown; addressType?: unknown; fd?: unknown; index?: unknown;
    };
    const address = typeof asked.address === "string" ? asked.address : "";
    const port = typeof asked.port === "number" ? asked.port : -1;
    const addressType = asked.addressType;
    const fd = typeof asked.fd === "number" ? asked.fd : -1;
    const key = `${address}:${port}:${String(addressType)}:${fd}`
      + (port === 0 ? `:${String(asked.index)}` : "");

    // A datagram address is not shared out: there are no connections to distribute, which
    // is node's own reason for exempting udp4 and udp6 from round robin. This profile does
    // not implement the shared-descriptor path either, so it says so.
    if (addressType === "udp4" || addressType === "udp6" || fd >= 0) {
      if (seq !== undefined) {
        worker.send({ cmd: "NODE_CLUSTER", ack: seq, key, errno: "ENOTSUP" });
      }
      return;
    }

    let distribution = this.#distributions.get(key);
    if (distribution === undefined) {
      distribution = new Distribution(key);
      this.#distributions.set(key, distribution);
      const server = createServer((socket: Socket): void => {
        distribution!.pending.push(socket);
        this.#handoffNext(distribution!);
      });
      distribution.server = server;
      server.on("error", (error: Error & { code?: string }): void => {
        const errno = error.code ?? "EADDRINUSE";
        const waiting = distribution!.bound;
        distribution!.bound = [];
        this.#distributions.delete(key);
        for (const settle of waiting) settle(errno);
      });
      // A negative port means the address is a **path**, not a host: node's own
      // RoundRobinHandle branches the same way, `listen({ path })` against
      // `listen({ port, host })`. Listening on port -1 is what broke
      // test-cluster-listen-pipe-readable-writable, which had been passing on the ENOTSUP
      // that used to come back instead.
      const where = port < 0
        ? { path: address }
        : { port, host: address === "" ? undefined : address };
      server.listen(where, (): void => {
        distribution!.listening = true;
        const bound = server.address();
        if (bound !== null && typeof bound === "object") {
          distribution!.sockname = bound as { address: string; family: string; port: number };
        }
        const waiting = distribution!.bound;
        distribution!.bound = [];
        for (const settle of waiting) settle(undefined);
      });
    }

    const share = distribution;
    share.all.set(worker.id, worker);
    const reply = (errno: string | undefined): void => {
      if (seq === undefined) return;
      if (errno !== undefined) {
        worker.send({ cmd: "NODE_CLUSTER", ack: seq, key, errno });
        return;
      }
      worker.send({ cmd: "NODE_CLUSTER", ack: seq, key, sockname: share.sockname });
      // In case connections arrived while it was still binding.
      this.#handoff(share, worker);
    };
    if (share.listening) reply(undefined);
    else share.bound.push(reply);
  }

  /** Offer the oldest pending connection to the next free worker, if both exist. */
  #handoffNext(share: Distribution): void {
    const worker = share.free.shift();
    if (worker === undefined) return;
    this.#handoff(share, worker);
  }

  /**
   * Hand one connection to one worker, or park the worker as free.
   *
   * The socket is remembered against the sequence number so a refusal can put it back:
   * node does the same, because a worker shutting down must not take the connection with
   * it.
   */
  #handoff(share: Distribution, worker: Worker): void {
    if (!share.all.has(worker.id)) return;
    const socket = share.pending.shift();
    if (socket === undefined) {
      share.free.push(worker);
      return;
    }
    this.#seq += 1;
    const seq = this.#seq;
    share.handedTo.set(seq, socket);
    share.waiting.set(seq, (): void => {
      this.#handoff(share, worker);
    });
    worker.send({ cmd: "NODE_CLUSTER", act: "newconn", key: share.key, seq }, socket);
  }

  /** Drop a departed worker from every address, closing any listener left with none. */
  #releaseWorker(worker: Worker): void {
    for (const [key, share] of this.#distributions) {
      if (!share.all.delete(worker.id)) continue;
      share.free = share.free.filter((candidate) => candidate.id !== worker.id);
      if (share.all.size === 0) {
        // Anything still queued has nowhere to go.
        for (const socket of share.pending) socket.destroy();
        share.pending = [];
        share.server?.close();
        this.#distributions.delete(key);
      }
    }
  }

  /** A worker is done with an address; the listener closes when the last one leaves. */
  #closeServer(worker: Worker, message: unknown): void {
    const key = (message as { key?: unknown }).key;
    const seq = seqOf(message);
    if (typeof key === "string") {
      const share = this.#distributions.get(key);
      if (share !== undefined) {
        share.all.delete(worker.id);
        share.free = share.free.filter((candidate) => candidate.id !== worker.id);
        if (share.all.size === 0) {
          share.server?.close();
          this.#distributions.delete(key);
        }
      }
    }
    if (seq !== undefined) worker.send({ cmd: "NODE_CLUSTER", ack: seq });
  }

  /** Ask every worker to leave, and call back when the last one has. */
  disconnect(callback?: () => void): void {
    const ids = Object.keys(this.workers);
    let outstanding = ids.length;
    if (outstanding === 0) {
      if (callback !== undefined) callback();
      return;
    }
    for (const id of ids) {
      const worker = this.workers[id];
      if (worker === undefined) continue;
      worker.process.once("exit", (): void => {
        outstanding -= 1;
        if (outstanding === 0 && callback !== undefined) callback();
      });
      worker.disconnect();
    }
  }

  /**
   * The worker's request for a server handle, which is the half of `cluster` this
   * module does not implement.
   *
   * It answers rather than hanging: a worker that calls `listen()` gets an error naming
   * the gap instead of a server that never accepts. `round_robin_handle` and
   * `shared_handle` are what would go here.
   */
  _getServer(_self: unknown, _options: unknown, callback: (error: Error) => void): void {
    callback(new Error(
      "cluster handle distribution is not implemented in this profile: a worker cannot "
      + "obtain a server handle from the primary",
    ));
  }

  /** node's worker-side bootstrap, called by its own `child.js`. Nothing to do here. */
  _setupWorker(): void {}
}

declare function nts_process_argv(): string[];
declare function nts_process_env_keys(): string[];

/** The environment as a plain object, so a fork can extend rather than replace it. */
function inheritedEnvironment(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of nts_process_env_keys()) out[name] = nts_process_env(name);
  return out;
}

/**
 * One listening address, shared out to the workers that asked for it.
 *
 * This is node's `RoundRobinHandle` in the shape this profile can express. node takes the
 * server's internal handle and installs its own `onconnection`, which reaches past the
 * public surface; here the primary simply *accepts* the connection and forwards the
 * socket, which is the same division of labour -- the primary owns the listener, the
 * workers own the connections -- reached through `net.createServer`.
 *
 * A connection is never dropped for want of a worker: it waits in `pending` until one is
 * free, which is what `handles` is for in node's version.
 */
class Distribution {
  readonly key: string;
  server: Server | null = null;
  sockname: { address: string; family: string; port: number } | null = null;
  listening = false;
  /** Every worker sharing this address, by id. */
  readonly all = new Map<number, Worker>();
  /** Those waiting for a connection, oldest first. */
  free: Worker[] = [];
  /** Accepted and not yet handed to anyone. */
  pending: Socket[] = [];
  /** Replies owed by workers, by the sequence number they must quote back. */
  readonly waiting = new Map<number, () => void>();
  /** Callbacks to run once the address is bound, or its error reported. */
  bound: ((errno: string | undefined) => void)[] = [];
  /** The connection handed out under each sequence number, so a refusal can undo it. */
  readonly handedTo = new Map<number, Socket>();

  constructor(key: string) {
    this.key = key;
  }
}

/** The `seq` an acknowledgement has to quote back, or undefined if there is none. */
function seqOf(message: unknown): number | undefined {
  if (message === null || typeof message !== "object") return undefined;
  const seq = (message as { seq?: unknown }).seq;
  return typeof seq === "number" ? seq : undefined;
}

/** The sequence number an acknowledgement is quoting, if this message is one. */
function ackOf(message: unknown): number | undefined {
  if (message === null || typeof message !== "object") return undefined;
  const ack = (message as { ack?: unknown }).ack;
  return typeof ack === "number" ? ack : undefined;
}

/** Whether a worker's reply took the connection. */
function acceptedOf(message: unknown): boolean {
  if (message === null || typeof message !== "object") return false;
  return (message as { accepted?: unknown }).accepted === true;
}

/** The address a worker reports itself listening on. */
function addressOf(message: unknown): unknown {
  if (message === null || typeof message !== "object") return undefined;
  const shaped = message as { address?: unknown; port?: unknown; addressType?: unknown; fd?: unknown };
  return {
    address: shaped.address,
    port: shaped.port,
    addressType: shaped.addressType,
    fd: shaped.fd,
  };
}

/** The `act` of an internal cluster message, or undefined for anything else. */
function actOf(message: unknown): string | undefined {
  if (message === null || typeof message !== "object") return undefined;
  const shaped = message as { cmd?: unknown; act?: unknown };
  if (shaped.cmd !== "NODE_CLUSTER") return undefined;
  return typeof shaped.act === "string" ? shaped.act : undefined;
}

const cluster = new Cluster();

// A worker announces itself, and this is the whole of the handshake from its side. The
// `NODE_` prefix routes it to the primary's `internalMessage`.
if (isWorker) {
  const self = new Worker();
  self.id = Number(uniqueId);
  self.state = "online";
  self.isSelf = true;
  cluster.worker = self;
  // The announcement, which is the worker's whole half of the handshake. `NODE_CLUSTER`
  // is what puts it on the primary's `internalMessage` rather than its `message`.
  nts_cluster_self_send({ cmd: "NODE_CLUSTER", act: "online", seq: 0 });
}

export default cluster;
export const workers = cluster.workers;
export const settings = cluster.settings;
