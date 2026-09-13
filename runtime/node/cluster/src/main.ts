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

/**
 * **The errno a `NODE_CLUSTER` reply carries is a number, and a negative one.**
 *
 * node's `internal/cluster/child.js` hands `message.errno` straight to
 * `util.getSystemErrorName`, which rejects anything else: *The "err" argument must be
 * of type number. Received type string ('EACCES')*. Six files failed on that one
 * sentence -- the two privileged-port ones, the two dgram ones, the relative-path
 * listen and the shared-handle bind error -- because this module replied with
 * `error.code`, which is the name.
 *
 * The negative spelling is libuv's and is what `getSystemErrorName` reads:
 * `getSystemErrorName(-95)` is `ENOTSUP`. Our own `net` already puts exactly that on a
 * bind error -- measured against node, `code=EACCES errno=-13` on both -- so the
 * error's own `errno` is preferred, and these two exist only for the replies that have
 * no error to read one from.
 */
const UV_ENOTSUP = -95;
const UV_EADDRINUSE = -98;

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
/**
 * **A handle the primary binds once and every worker then shares.**
 *
 * node's `SharedHandle` is the other half of `cluster`: `RoundRobinHandle` accepts in the
 * primary and hands sockets out, while a shared handle is *bound* in the primary and the
 * descriptor itself goes to each worker, which accepts on it directly. node picks it for
 * `udp4`/`udp6` -- a datagram address has no connections to distribute -- and for any
 * policy that is not `SCHED_RR`.
 *
 * It cannot be built from this side. What has to cross to a worker is a **host** handle,
 * because the worker is real node and `internal/cluster/child.js` hands what arrives
 * straight to its own `shared()`. So the stand-in calls node's own
 * `net._createServerHandle` or `dgram._createSocketHandle` and keeps the result; this
 * returns a positive id for it, or a **negative errno** exactly as node's `SharedHandle`
 * constructor does when the bind fails.
 */
declare function nts_cluster_shared_handle(
  address: string,
  port: number,
  addressType: string,
  fd: number,
  flags: number,
): number;
/**
 * Close a shared handle once the last worker holding it is gone.
 *
 * Without this the primary keeps a bound descriptor alive, its event loop never empties,
 * and the process hangs after the test has already made all its assertions -- which
 * reads as a timeout and not as a leak. It is the same trap `#releaseWorker` was written
 * for on the round-robin side, and `test-cluster-disconnect-unshared-udp` is the file
 * that names it.
 */
declare function nts_cluster_shared_handle_close(id: number): void;
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
    // **Ask the worker to close its handles; it closes the channel when it is done.**
    //
    // Closing the channel from here looks like the same thing and is not. node sends
    // `{ act: 'disconnect' }` and the worker's own `child.js` closes every handle it
    // holds and *then* calls `process.disconnect()`. A worker told only that the channel
    // is gone keeps whatever it had bound, so its loop never empties and it never exits
    // -- `test-cluster-disconnect-unshared-udp` hangs exactly there, holding a datagram
    // socket, after every assertion it makes has already passed.
    //
    // The channel is still closed from here when the message cannot be sent, because a
    // worker with no channel cannot be asked anything.
    this.exitedAfterDisconnect = true;
    if (this.isSelf) {
      nts_cluster_self_disconnect();
      return this;
    }
    if (this.send({ cmd: "NODE_CLUSTER", act: "disconnect" }) !== true) {
      const disconnect = this.process.disconnect;
      if (disconnect !== undefined) disconnect();
    }
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
      this.#workerLeft();
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
      worker.send({ cmd: "NODE_CLUSTER", ack: seq, errno: UV_ENOTSUP });
    }
  }

  /**
   * A worker wants to serve an address, and the primary binds it once.
   *
   * The key is node's: address, port, addressType and fd, with the worker's index added
   * when the port is 0 -- because port 0 means "any port" and two workers asking for it
   * want two different listeners rather than a share of one.
   */
  /** Shared handles by node's key, and which workers hold each one. */
  #shared = new Map<string, { id: number; errno: number }>();
  #sharedWorkers = new Map<string, Map<number, Worker>>();

  #queryServer(worker: Worker, message: unknown): void {
    if (worker.exitedAfterDisconnect) return;
    const seq = seqOf(message);
    const asked = message as {
      address?: unknown; port?: unknown; addressType?: unknown; fd?: unknown;
      index?: unknown; flags?: unknown;
    };
    const address = typeof asked.address === "string" ? asked.address : "";
    const port = typeof asked.port === "number" ? asked.port : -1;
    const addressType = asked.addressType;
    const fd = typeof asked.fd === "number" ? asked.fd : -1;
    const key = `${address}:${port}:${String(addressType)}:${fd}`
      + (port === 0 ? `:${String(asked.index)}` : "");

    // **The shared path, which is node's choice for three cases and not a fallback.**
    //
    // A datagram address has no connections to distribute, so node binds it once in the
    // primary and gives every worker the descriptor; the same is true for a policy that is
    // not `SCHED_RR`, and for a caller that brought its own `fd`. `internal/cluster/child.js`
    // decides which half it is in by whether a **handle** arrived with the reply, so the
    // difference here is one extra argument to `send` and not a different message.
    if (addressType === "udp4" || addressType === "udp6" || fd >= 0
      || schedulingPolicy !== SCHED_RR) {
      if (seq === undefined) return;
      let shared = this.#shared.get(key);
      if (shared === undefined) {
        const flags = typeof asked.flags === "number" ? asked.flags : 0;
        const rval = nts_cluster_shared_handle(
          address, port, typeof addressType === "string" ? addressType : String(addressType),
          fd, flags,
        );
        // node's `SharedHandle` constructor keeps a negative return as `this.errno` and a
        // positive one as the handle. Reproduced rather than paraphrased, because the
        // worker reads the two differently: an errno makes `listen` fail with that code,
        // while a handle with errno 0 is a working socket.
        shared = rval < 0 ? { id: -1, errno: rval } : { id: rval, errno: 0 };
        this.#shared.set(key, shared);
      }
      const holders = this.#sharedWorkers.get(key) ?? new Map<number, Worker>();
      holders.set(worker.id, worker);
      this.#sharedWorkers.set(key, holders);
      if (shared.errno !== 0) {
        worker.send({ cmd: "NODE_CLUSTER", ack: seq, key, errno: shared.errno });
        return;
      }
      worker.send(
        { cmd: "NODE_CLUSTER", ack: seq, key, errno: 0 },
        { ntsClusterHandle: shared.id },
      );
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
      server.on("error", (error: Error & { code?: string; errno?: number }): void => {
        const errno = error.errno ?? UV_EADDRINUSE;
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
    const reply = (errno: number | undefined): void => {
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
    // **Settled by the workers map emptying, not by an `exit` listener per worker.**
    //
    // Waiting for each worker's `exit` looks equivalent and is not: by the time this runs
    // a worker may have exited already, and `once("exit")` on a dead child never fires, so
    // the count never reaches zero and the callback never comes. That is exactly the
    // sequence in `test-cluster-disconnect-unshared-udp` -- one worker is disconnected,
    // and `cluster.disconnect` is chained off *its* `disconnect` event, by which time it
    // is gone. node has the same shape for the same reason: it emits on an internal
    // emitter from wherever a worker leaves the map, rather than subscribing per worker.
    const ids = Object.keys(this.workers);
    if (callback !== undefined) {
      if (ids.length === 0) {
        nextTick(callback);
      } else {
        this.#onceEmpty.push(callback);
      }
    }
    for (const id of ids) {
      const worker = this.workers[id];
      if (worker !== undefined) worker.disconnect();
    }
  }

  /** Callbacks owed to `disconnect()` once the last worker has left `workers`. */
  #onceEmpty: (() => void)[] = [];

  /**
   * Called wherever a worker leaves `workers`. A departure is a departure however it
   * happened -- disconnected, killed, or exited on its own -- and the one place that can
   * say "there are none left" is here.
   */
  #workerLeft(): void {
    if (Object.keys(this.workers).length > 0) return;
    const owed = this.#onceEmpty;
    this.#onceEmpty = [];
    for (const settle of owed) settle();
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
  bound: ((errno: number | undefined) => void)[] = [];
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
