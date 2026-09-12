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
      const act = actOf(message);
      if (act === "online") {
        worker.state = "online";
        worker.emit("online");
        this.emit("online", worker);
        return;
      }
      // **Everything else is answered, not ignored.** A worker asking for a server
      // handle blocks until the primary replies, so silence is a hang rather than a
      // missing feature: one unanswered `queryServer` held a test for eighteen minutes
      // before its per-file timeout. node's worker reads `errno` off the acknowledgement
      // and turns it into an error, so an act this profile does not implement gets
      // ENOTSUP and the worker finds out at once.
      const seq = seqOf(message);
      if (seq !== undefined) {
        worker.send({ cmd: "NODE_CLUSTER", ack: seq, errno: "ENOTSUP" });
      }
    });
    child.on("exit", (code: number | null, signal: string | null): void => {
      worker.state = "dead";
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

/** The `seq` an acknowledgement has to quote back, or undefined if there is none. */
function seqOf(message: unknown): number | undefined {
  if (message === null || typeof message !== "object") return undefined;
  const seq = (message as { seq?: unknown }).seq;
  return typeof seq === "number" ? seq : undefined;
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
