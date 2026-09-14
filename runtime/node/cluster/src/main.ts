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
import { nextTick } from "../../internal/tick.ts";
import { relative as pathRelative } from "../../path/src/posix.ts";
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
/**
 * The bit `flags` carries for `ipv6Only`, which is the only one node's `net` honours there.
 * Measured from `internalBinding('tcp_wrap').constants` on this platform: 1, beside
 * `UV_TCP_REUSEPORT` at 2. Named rather than inlined because the neighbouring value is
 * what a future reader would otherwise guess at.
 */
const UV_TCP_IPV6ONLY = 1;

/** @ntsAbi managed */
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
/** @ntsAbi managed */
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
  /** Extra stdio slots for every worker; see the forwarding in `fork`. */
  stdio?: readonly unknown[] | undefined;
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
  /**
   * **`undefined` until something decides, not `false`.**
   *
   * node writes `this.exitedAfterDisconnect = undefined` in the constructor and
   * `test-cluster-worker-constructor` asserts exactly that, twice. The distinction is
   * node's own: `false` would say "this worker did not exit after a disconnect", which is
   * a claim about a worker that has not exited at all. Every reader here tests it for
   * truthiness, so widening the type changes no behaviour.
   */
  exitedAfterDisconnect: boolean | undefined = undefined;

  /**
   * node's `Worker` takes an options bag -- `{ id, state, process }` -- and its own test
   * constructs one directly to check each field lands. `fork` does not use it; it builds a
   * bare worker and fills the fields in, which is why this went unnoticed.
   *
   * `options.id | 0` rather than `?? 0` is node's coercion, so `new Worker({ id: '3' })`
   * is 3 and `new Worker({})` is 0.
   */
  constructor(options?: { id?: unknown; state?: unknown; process?: unknown }) {
    super();
    if (options === null || typeof options !== "object") return;
    if (typeof options.state === "string" && options.state !== "") this.state = options.state;
    this.id = Number(options.id) | 0;
    if (options.process !== undefined && options.process !== null) {
      this.process = options.process as ChildProcess;
      // node forwards both from the process it was handed, so a `Worker` built around an
      // existing child is as observable as one `fork` made.
      this.process.on("error", (code: unknown, signal: unknown): void => {
        this.emit("error", code, signal);
      });
      this.process.on("message", (message: unknown, handle?: unknown): void => {
        this.emit("message", message, handle);
      });
    }
  }
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
    // **node has two `destroy`s and this class is both roles, so it needs both.**
    //
    // `internal/cluster/primary.js` is three lines -- default the signal, kill the process
    // -- and `internal/cluster/child.js` is the disconnect dance. This had only the child's
    // version, applied in the primary, which is why `test-cluster-worker-kill-signal` saw
    // neither the `disconnect` nor the `exit` it waits for: `kill('SIGKILL')` went through a
    // graceful disconnect instead of a signal, and `exitedAfterDisconnect` was set to `true`
    // where the test asserts `false`.
    //
    // A primary killing a worker is not a worker retiring itself, and the flag is the tell:
    // the primary sets nothing, because being killed is not exiting after a disconnect.
    if (!this.isSelf) {
      this.process.kill(signal ?? "SIGTERM");
      return;
    }
    // The worker's own, from `child.js`: announce the intent, disconnect, exit when the
    // channel goes. `state` guards re-entry there and here.
    if (this.state === "destroying") return;
    this.exitedAfterDisconnect = true;
    if (!this.isConnected()) {
      nts_cluster_self_disconnect();
      return;
    }
    this.state = "destroying";
    this.send({ cmd: "NODE_CLUSTER", act: "exitedAfterDisconnect" });
    nts_cluster_self_disconnect();
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
  /**
   * **The three node assigns as properties are bound, because a property has no receiver.**
   *
   * `lib/internal/cluster/primary.js` writes `cluster.setupPrimary = function (...)`,
   * `cluster.fork = function (...)` and `cluster.disconnect = function (...)` over a
   * closed-over `cluster`, so all three work detached -- and node's own tests detach every
   * one of them, deliberately:
   *
   *     const fork = cluster.fork;
   *     fork();  // `cluster.fork` to test that `this` is not used
   *
   *     unbound.on('disconnect', cluster.disconnect);
   *     worker.on('disconnect', common.mustCall(cluster.disconnect));
   *
   * A class method loses its receiver there. The failures name the private field it
   * reached for and nothing else -- *Cannot read properties of undefined (reading
   * '#nextId')* for `fork`, *Cannot convert undefined or null to object* for `disconnect`
   * -- so neither points at the call site or at the binding. Binding here reproduces
   * node's shape without giving up the class.
   *
   * `setupMaster` forwards to `setupPrimary` and is bound with them, since node kept the
   * old spelling as its own property too.
   */
  constructor() {
    super();
    this.setupPrimary = this.setupPrimary.bind(this);
    this.setupMaster = this.setupMaster.bind(this);
    this.fork = this.fork.bind(this);
    this.disconnect = this.disconnect.bind(this);
  }

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

  #initialized = false;
  #nextId = 0;
  #seq = 0;
  readonly #distributions = new Map<string, Distribution>();

  setupPrimary(options?: ClusterSettings): void {
    // **Defaults, then what is already there, then the caller -- in that order.**
    //
    // node builds the object exactly this way, and the order is what makes repeated calls
    // cumulative: `setupPrimary({ exec: 'x' })` then `setupPrimary({ args: [...] })` keeps
    // the `exec`, which `test-cluster-setup-primary-cumulative` asserts four times over.
    // Merging only `settings` and `options`, as this did, left `args` and `exec` undefined
    // forever -- and `cluster.settings.args[args.length - 1]` is then *Cannot read
    // properties of undefined*, a message that names neither `setupPrimary` nor `args`.
    //
    // The defaults are read **at call time**, not once: `test-cluster-setup-primary-argv`
    // pushes onto `process.argv` and then calls this, and expects the last of
    // `settings.args` to be the last of `process.argv`.
    const argv = nts_process_argv();
    const merged: ClusterSettings = {
      args: argv.slice(2),
      exec: argv.length > 1 ? argv[1] : undefined,
      execArgv: nts_process_exec_argv(),
      silent: false,
      ...this.settings,
      ...(options ?? {}),
    };
    this.settings = merged;
    // **The policy is frozen here, from the public field, on the first call only.**
    //
    // `cluster.schedulingPolicy` is what a caller assigns -- `test-cluster-shared-leak` and
    // three others do exactly that -- and the value `#queryServer` branches on is a module
    // variable. node reconciles them by re-reading the field once, at first `setupPrimary`,
    // with the comment `// Freeze policy.`; later calls leave it alone, so a policy change
    // after the first fork is ignored rather than honoured half-way.
    //
    // Without this, assigning `SCHED_NONE` changed an instance field nothing read, every
    // address went round-robin, and the shared-handle path was unreachable from a test. It
    // failed as a **timeout**, because a round-robin listener the primary never closes
    // keeps its loop alive -- which is the shape of a leak, not of a wrong branch.
    if (!this.#initialized) {
      this.#initialized = true;
      const chosen = this.schedulingPolicy;
      if (chosen !== SCHED_NONE && chosen !== SCHED_RR) {
        throw new Error(`Bad cluster.schedulingPolicy: ${chosen}`);
      }
      schedulingPolicy = chosen;
    }
    // **On a next tick, because node emits it from `setupSettingsNT`.** Both
    // `test-cluster-setup-primary` and `test-cluster-setup-primary-argv` register their
    // listener *after* calling this, so a synchronous emit is a `setup` event nobody
    // hears -- the same shape as the `disconnect` event two commits ago.
    nextTick((): void => { this.emit("setup", merged); });
  }

  /** node kept the old spelling working and so does this. */
  setupMaster(options?: ClusterSettings): void {
    this.setupPrimary(options);
  }

  fork(env?: Record<string, string>): Worker {
    // node's `fork` opens with `cluster.setupPrimary()`, which is what freezes the
    // scheduling policy. A `fork` that skipped it would read a policy nobody had committed.
    if (!this.#initialized) this.setupPrimary();
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
      // **`stdio` from the settings, which node forwards and this did not.**
      //
      // `cluster.setupPrimary({ stdio: ['pipe','pipe','pipe','ipc','pipe'] })` is how a
      // caller asks its workers for extra streams, and `test-cluster-fork-stdio` then
      // reads `worker.process.stdio[4]`. Dropped, the slot is `undefined` and the
      // failure is *Cannot read properties of undefined (reading 'setEncoding')* -- a
      // message about the stream, from a test about `stdio`, caused by a settings key.
      stdio: settings.stdio,
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
      // **node coerces the flag the moment the worker leaves, and that is the transition
      // from `undefined` to `false`.** `!!worker.exitedAfterDisconnect` sits at both of
      // node's sites for the same reason: until a worker goes, "did it exit after a
      // disconnect" has no answer, and once it has gone the answer is a boolean.
      // `test-cluster-worker-exit` and `test-cluster-worker-kill` both assert `false` after
      // an exit that had no disconnect, and both broke the moment the constructor started
      // the field at `undefined` -- which is the correct start.
      worker.exitedAfterDisconnect = worker.exitedAfterDisconnect === true;
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
      worker.exitedAfterDisconnect = worker.exitedAfterDisconnect === true;
      worker.state = "disconnected";
      worker.emit("disconnect");
      this.emit("disconnect", worker);
    });
    child.on("error", (error: Error): void => {
      worker.emit("error", error);
    });

    // **On a next tick, because `fork` returns the worker the handler wants to compare.**
    //
    // node calls `process.nextTick(emitForkNT, worker)` here, and the reason is visible in
    // its own test: `test-cluster-basic` keeps `const worker = cluster.fork()` and its
    // `cluster.on('fork')` handler asserts `worker === arguments[0]`. Emitting inside the
    // call runs that handler before the `const` is initialised -- *Cannot access 'worker'
    // before initialization*, thrown from the test and pointing at the test.
    //
    // Fourth event in this module that fired inside the call producing it, after
    // `disconnect`, `send`'s callback and `setup`. The others -- `online`, `listening`,
    // `exit`, `message` -- arrive from the channel and are already a tick late by
    // construction, which is why only these four were wrong.
    nextTick((): void => { this.emit("fork", worker); });
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
          // **A refusal goes to the back of the queue and to a *free* worker, not to the
          // front and back to the worker that just refused.**
          //
          // The earlier comment here said "it is shutting down", and that is only one of the
          // two reasons node answers `accepted: false`. The other is `maxConnections`, and it
          // is checked *before* the acknowledgement, in node's own `child.js`:
          //
          //     let accepted = server !== undefined;
          //     if (accepted && server[owner_symbol]) {
          //       const self = server[owner_symbol];
          //       if (self.maxConnections != null &&
          //           self._connections >= self.maxConnections &&
          //           !self.dropMaxConnection) {
          //         accepted = false;
          //       }
          //     }
          //
          // So a refusal is ordinary traffic on a healthy worker, not an end-of-life signal,
          // and what happens next decides whether the connection is served at all.
          // `round_robin_handle.js`:
          //
          //     if (reply.accepted) handle.close();
          //     else this.distribute(0, handle);
          //     this.handoff(worker);
          //
          // and `distribute` **appends** and then offers it to whoever is free:
          //
          //     append(this.handles, handle);
          //     const [ workerEntry ] = this.free;
          //     if (ArrayIsArray(workerEntry)) { ...; this.handoff(worker); }
          //
          // `unshift` put it back at the head, where the very next `#handoff` to this same
          // worker picked up the identical socket and was refused again. A worker with
          // `maxConnections: 0` refuses everything, so it sat on the front of the queue
          // trading one connection back and forth while the rest were distributed around it.
          const socket = distribution.handedTo.get(ack);
          if (socket !== undefined) {
            distribution.pending.push(socket);
            this.#handoffNext(distribution);
          }
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
      index?: unknown; flags?: unknown; backlog?: unknown;
      readableAll?: unknown; writableAll?: unknown;
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
    // node's condition exactly, and `fd` is **not** in it: under `SCHED_RR` a
    // caller-supplied descriptor goes to `RoundRobinHandle`, which listens on `{ fd,
    // backlog }`. Sending it to the shared path instead is a divergence I introduced with
    // `SharedHandle` and it is what `test-listen-fd-cluster` reports as an internal
    // assertion.
    if (addressType === "udp4" || addressType === "udp6"
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

    // **The shortest spelling of a unix socket path, which is node's own reason.**
    //
    //     // Find shortest path for unix sockets because of the ~100 byte limit
    //     address = path.relative(process.cwd(), address);
    //     if (message.address.length < address.length) address = message.address;
    //
    // A worker resolves a relative pipe name against **its** cwd before sending, so what
    // arrives here is absolute and can exceed `sockaddr_un`'s 108 bytes. The primary then
    // re-expresses it relative to its own cwd and keeps whichever is shorter.
    //
    // Measured on node, instrumenting `net.Server.prototype.listen` in its primary:
    // the worker's cwd is `<tmpdir>/unix-socket-dir`, the primary's is `<tmpdir>`, and what
    // node binds is `{"path":"unix-socket-dir/AAAA…","backlog":0}` -- 100 bytes, where the
    // absolute form is 157 and fails. `test-cluster-net-listen-relative-path` exists for
    // exactly this and reported `bind EINVAL AAAA…`, naming the socket and not the length.
    let bindAddress = address;
    if (port < 0 && address !== "") {
      const nearer = pathRelative(nts_process_cwd(), address);
      bindAddress = address.length < nearer.length ? address : nearer;
    }

    let distribution = this.#distributions.get(key);
    if (distribution === undefined) {
      distribution = new Distribution(key);
      this.#distributions.set(key, distribution);
      // **`pauseOnConnect`, or the primary eats the first bytes of every connection.**
      //
      // node never builds a `Socket` here at all: `RoundRobinHandle` steals the listening
      // handle and installs its own `onconnection`, so an accepted connection is a raw handle
      // that nothing has read from. This accepts into a real `Socket`, and an accepted socket
      // resumes -- `if (!this.#options.pauseOnConnect) socket.resume()` in `net` -- which arms
      // the read. The handoff to a worker then costs an IPC round trip, and anything the client
      // sent in the meantime has already been consumed **here**, into a stream in the primary
      // that nobody will ever read.
      //
      // A client that writes on `connect` therefore loses its first write, which is every HTTP
      // client there is. Measured with one fixture in three arms, same handoff each time:
      //
      //     worker only writes                            served, data flows
      //     worker reads, client writes on connect         `connection`, `end`, and no data
      //     worker reads, client writes 300ms later        `worker read "ping"`
      //
      // The third arm is the proof: the descriptor is fine and the read direction works. Only
      // the timing was wrong, and `test-listen-fd-cluster` and `test-cluster-http-pipe` both
      // fail on it because node's `http` server must read a request before it can answer.
      //
      // `pauseOnConnect` reaches `pauseOnCreate` on the accepted socket, which is the flag that
      // skips `read(0)` in the constructor, so the bytes stay in the kernel where the worker's
      // descriptor can still see them. That is node's behaviour reproduced through the option
      // node's own `net` provides for it, rather than a second accept path here.
      const server = createServer({ pauseOnConnect: true }, (socket: Socket): void => {
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
      // **node's three listen branches, with every option it forwards.**
      //
      // `RoundRobinHandle` reads `{ port, fd, flags, backlog, readableAll, writableAll }`
      // off the worker's message and listens one of three ways: `{ fd, backlog }`,
      // `{ port, host, ipv6Only, backlog }`, or `{ path, backlog, readableAll,
      // writableAll }`. This forwarded none of them, and each absence is its own test:
      //
      //   backlog     `test-cluster-net-listen-backlog` patches
      //               `net.Server.prototype.listen` in the primary and asserts the option
      //               arrives. `assert(options.backlog, 127)` is a truthiness check whose
      //               *message* is 127, which is why the failure read `AssertionError: 127`
      //               and named no option at all.
      //   ipv6Only    carried in `flags`, bit `UV_TCP_IPV6ONLY` -- measured as 1 from
      //               `internalBinding('tcp_wrap').constants` on this platform, beside
      //               `UV_TCP_REUSEPORT` at 2.
      //   readableAll/writableAll   the pipe permissions, path case only.
      //
      // A negative port means the address is a **path** rather than a host, which is node's
      // own branch: listening on port -1 is what broke
      // test-cluster-listen-pipe-readable-writable.
      const backlog = typeof asked.backlog === "number" ? asked.backlog : undefined;
      // node's first branch, and it comes before the other two: a caller-supplied
      // descriptor is listened on directly, with no address of any kind. Documented here
      // two commits ago and not implemented, so `test-listen-fd-cluster` -- a worker
      // listening on a descriptor the primary owns, which is this branch and nothing else
      // -- fell through to the port case and bound port -1.
      const where = fd >= 0
        ? { fd, backlog }
        : port < 0
        ? {
          path: bindAddress,
          backlog,
          readableAll: asked.readableAll === true,
          writableAll: asked.writableAll === true,
        }
        : {
          port,
          host: address === "" ? undefined : address,
          ipv6Only: (typeof asked.flags === "number" ? asked.flags : 0) & UV_TCP_IPV6ONLY
            ? true
            : false,
          backlog,
        };
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
    // **The raw handle, not the socket.** node's `RoundRobinHandle` intercepts at the
    // handle level -- `this.handle.onconnection = (err, handle) => this.distribute(err,
    // handle)` -- and sends that handle, which crosses as `net.Native`. The worker's
    // `child.js` then does `server.onconnection(0, handle)` and node's `net` builds
    // `new Socket({ handle })`, expecting something with `close`.
    //
    // Sending a *socket* instead crosses as `net.Socket`, so the worker reconstructs a
    // `net.Socket` and `new Socket({ handle: aSocket })` reaches for `_handle.close` on it:
    // *self._handle.close is not a function*, at `closeSocketHandle (node:net:360)` by way
    // of `Object.onconnection (node:net:2735)`, in the worker, naming nothing here.
    //
    // A plain `send(message, socket)` is different and stays a socket -- node's own
    // `process.send(msg, socket)` delivers a socket. This case is not that case.
    worker.send(
      { cmd: "NODE_CLUSTER", act: "newconn", key: share.key, seq },
      // `net`'s `_handle` is an object now -- node's is too -- so the id comes from inside it.
      // Reading the object itself here sent a `NetNativeHandle` where a number was wanted and
      // the resolver would have missed, falling through to a socket node cannot send.
      {
        ntsRawHandleOf:
          (socket as unknown as { _handle: { identifier: number } | null })._handle?.identifier
            ?? -1,
      },
    );
  }

  /** Drop a departed worker from every address, closing any listener left with none. */
  /**
   * The shared half of `#releaseWorker`: a descriptor the **primary** bound outlives every
   * worker unless somebody closes it, and then the primary's loop never empties and it
   * hangs after the test has made all its assertions.
   *
   * `test-cluster-shared-leak` is the file. Traced, both workers exit 0 and the workers map
   * reaches zero -- and the primary sits there holding a bound socket nobody owns. Same
   * trap `#releaseWorker` was written for on the round-robin side, one handle kind over.
   */
  #releaseShared(worker: Worker): void {
    for (const [key, holders] of this.#sharedWorkers) {
      if (!holders.delete(worker.id)) continue;
      if (holders.size > 0) continue;
      this.#sharedWorkers.delete(key);
      const shared = this.#shared.get(key);
      this.#shared.delete(key);
      if (shared !== undefined && shared.id >= 0) nts_cluster_shared_handle_close(shared.id);
    }
  }


  #releaseWorker(worker: Worker): void {
    this.#releaseShared(worker);
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
      // **node's guard, and it is load-bearing.** `worker.disconnect()` on a worker whose
      // channel has already gone emits `error` with ERR_IPC_DISCONNECTED, and nothing is
      // listening, so it throws as an unhandled `error` event. A worker stays in `workers`
      // until it *exits*, and its `disconnect` fires first -- which is precisely when the
      // three tests that chain `cluster.disconnect` off a `disconnect` event call this.
      if (worker !== undefined && worker.isConnected()) worker.disconnect();
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
    // **No workers left means no shared descriptor has an owner.**
    //
    // `#releaseShared` closes a shared handle when its own holder set empties, and that set only
    // ever gains a worker that actually reached `queryServer`. `test-cluster-shared-leak`
    // disconnects its second worker before that worker's `listen` completes, so the set for that
    // key holds one worker and the release path waits on a departure that has already happened
    // elsewhere. The primary then sits on a bound socket with nobody to serve, which reads as a
    // timeout rather than as a leak.
    //
    // node closes a handle from `removeWorker` when no workers remain, which is this condition
    // rather than the per-key one. Both are kept: the per-key close frees a descriptor as soon
    // as its last holder goes, and this frees anything still held when the cluster is empty.
    for (const [key, shared] of this.#shared) {
      if (shared.id >= 0) nts_cluster_shared_handle_close(shared.id);
      this.#sharedWorkers.delete(key);
    }
    this.#shared.clear();
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

/** @ntsAbi managed */
declare function nts_process_argv(): string[];
/** @ntsAbi managed */
declare function nts_process_exec_argv(): string[];
/** @ntsAbi managed */
declare function nts_process_cwd(): string;
/** @ntsAbi managed */
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
