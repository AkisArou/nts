// `http.Agent`, from node v24.20.0 `lib/_http_agent.js`.
//
// A pool of sockets, keyed by where they go. It exists because opening a TCP
// connection costs a round trip before any request can be sent -- three for
// TLS -- and a client that talks to one host repeatedly pays that every time
// unless something keeps the connection.
//
// The two limits are what make it a pool rather than a cache. `maxSockets`
// bounds how many connections may be open to one host at once, so a burst of
// requests queues instead of opening a hundred sockets; `maxFreeSockets`
// bounds how many idle ones are kept, so a burst that has passed does not
// leave them held forever.
//
// The reuse rule that matters is not here but in the server: a connection
// whose previous message was not read to the end cannot be reused, because
// what is left of it is indistinguishable from the next response.

import { EventEmitter } from "../../events/src/main.ts";
import { Socket, connect as netConnect } from "../../net/src/main.ts";
import type { ConnectOptions } from "../../net/src/main.ts";
import { nextTick } from "../../internal/tick.ts";
import { AsyncResource } from "../../async_hooks/src/resource.ts";
import { validateNumberRange, validateOneOf } from "../../internal/validators.ts";
import { ERR_FEATURE_UNAVAILABLE_ON_PLATFORM } from "../../internal/errors.ts";
import type { HTTPDuplex } from "./outgoing.ts";
import { env as processEnvironment } from "../../process/src/env.ts";
import { ProxyConfig, proxyConfigFromEnvironment, selectProxy } from "./proxy.ts";
import type { ProxyEnvironment } from "./proxy.ts";

/** Internal fixed-layout field shared with the request rewriter. */
export const kProxyConfig = Symbol("http.proxyConfig");

export interface AgentConnectionOptions extends ConnectOptions {
  socketPath?: string | undefined;
}

interface SocketReceiver {
  readonly destroyed: boolean;
  reusedSocket: boolean;
  timeout?: number | undefined;
  onSocket(socket: HTTPDuplex | null, error?: unknown): void;
}

type CreateSocketCallback = (error: unknown | null, socket?: HTTPDuplex) => void;

export interface AgentOptions extends AgentConnectionOptions {
  /** Port used when a request through this agent does not name one. */
  defaultPort?: number | undefined;
  /** URL protocol accepted by this agent. */
  protocol?: string | undefined;
  /** Keep idle sockets for reuse. Off by default, as node's is. */
  keepAlive?: boolean | undefined;
  /** How long an idle socket is kept before being closed. */
  keepAliveMsecs?: number | undefined;
  agentKeepAliveTimeoutBuffer?: number | undefined;
  maxSockets?: number | undefined;
  maxTotalSockets?: number | undefined;
  maxFreeSockets?: number | undefined;
  /** How long a request may wait for a socket. */
  timeout?: number | undefined;
  scheduling?: "fifo" | "lifo" | undefined;
  /** Environment variables used by Node's built-in proxy routing. */
  proxyEnv?: ProxyEnvironment | undefined;
}

interface Pending {
  options: AgentConnectionOptions;
  request: SocketReceiver;
  resource: AsyncResource;
}

type SocketErrorListener = (error: unknown) => void;

interface ManagedSocketListeners {
  close: () => void;
  timeout: () => void;
  remove: () => void;
}

export class Agent extends EventEmitter {
  /** Node `_http_agent.js:291`, and settable: every agent built after reads it. */
  static defaultMaxSockets = Infinity;

  defaultPort: number;
  protocol: string;
  keepAlive: boolean;
  keepAliveMsecs: number;
  agentKeepAliveTimeoutBuffer: number;
  maxSockets: number;
  maxTotalSockets: number;
  maxFreeSockets: number;
  totalSocketCount = 0;
  scheduling: "fifo" | "lifo";
  options: AgentOptions;

  /** In use, by `host:port`. */
  sockets: Record<string, HTTPDuplex[]> = {};
  /** Idle and reusable, by the same key. */
  freeSockets: Record<string, HTTPDuplex[]> = {};
  /** Waiting for a socket because the host is at `maxSockets`. */
  requests: Record<string, Pending[]> = {};

  /** The error guard installed only while a socket is idle in the pool. */
  #freeSocketErrors = new Map<HTTPDuplex, SocketErrorListener>();
  /** Every live socket created by this agent, independent of pool state. */
  #ownedSockets = new Set<HTTPDuplex>();
  /** Connection identity retained while a socket moves between pool states. */
  #socketOptions = new Map<HTTPDuplex, AgentConnectionOptions>();
  /** Server keep-alive hints waiting to be applied as a socket turns idle. */
  #keepAliveHints = new Map<HTTPDuplex, string>();
  /** Pool lifecycle listeners, retained so an upgraded socket can detach. */
  #socketListeners = new Map<HTTPDuplex, ManagedSocketListeners>();
  /** Parsed once at construction; ordinary agents pay only one null check. */
  readonly [kProxyConfig]: ProxyConfig | null;

  constructor(options: AgentOptions = {}) {
    super();
    this.options = { ...options };
    if (this.options.noDelay === undefined) this.options.noDelay = true;
    this.defaultPort = options.defaultPort || 80;
    this.protocol = options.protocol || "http:";
    this[kProxyConfig] =
      options.proxyEnv === undefined
        ? null
        : proxyConfigFromEnvironment(options.proxyEnv, this.protocol);
    this.keepAlive = options.keepAlive ?? false;
    this.keepAliveMsecs = options.keepAliveMsecs ?? 1000;
    const timeoutBuffer = options.agentKeepAliveTimeoutBuffer;
    this.agentKeepAliveTimeoutBuffer =
      typeof timeoutBuffer === "number" && timeoutBuffer >= 0 && Number.isFinite(timeoutBuffer)
        ? timeoutBuffer
        : 1000;
    // `||`, not `??`, and `Agent.defaultMaxSockets` rather than a literal --
    // node `_http_agent.js:174`. The static is settable, so a program that
    // assigns `http.Agent.defaultMaxSockets = 5` changes every agent built
    // afterwards; a literal here made that documented knob inert. `||` also
    // means `maxSockets: 0` takes the default, which is node's behaviour and
    // what `??` would have changed.
    this.maxSockets = options.maxSockets || Agent.defaultMaxSockets;
    if (options.maxTotalSockets !== undefined) {
      validateNumberRange(options.maxTotalSockets, "maxTotalSockets", 1);
    }
    this.maxTotalSockets = options.maxTotalSockets ?? Infinity;
    this.maxFreeSockets = options.maxFreeSockets ?? 256;
    this.scheduling = options.scheduling ?? "lifo";
    validateOneOf(this.scheduling, "scheduling", ["fifo", "lifo"] as const);
  }

  /**
   * The pool key.
   *
   * Host and port, and nothing else. Anything that changes what the connection
   * *is* -- a different local interface, a different TLS identity -- has to be
   * part of it, or a socket would be handed to a request that must not use it.
   */
  getName(options: AgentConnectionOptions = {}): string {
    let name = `${options.host || "localhost"}:${options.port || ""}:`;
    if (options.localAddress) name += options.localAddress;
    if (options.family === 4 || options.family === 6) name += `:${options.family}`;
    if (options.socketPath) name += `:${options.socketPath}`;
    return name;
  }

  #connectionOptions(options: AgentConnectionOptions): AgentConnectionOptions {
    const merged: AgentConnectionOptions = { ...options, ...this.options };
    if (merged.socketPath !== undefined) merged.path = merged.socketPath;
    return merged;
  }

  createConnection(options: AgentConnectionOptions, callback?: CreateSocketCallback): HTTPDuplex {
    const proxy = selectProxy(this[kProxyConfig], options);
    if (proxy?.protocol === "https:") {
      throw new ERR_FEATURE_UNAVAILABLE_ON_PLATFORM("HTTPS proxy transport");
    }
    const socket = netConnect(proxy?.connectionOptions ?? options);
    if (callback !== undefined) socket.once("connect", () => callback(null, socket));
    return socket;
  }

  /**
   * The overridable connection-construction seam used by Node agents.
   *
   * A custom implementation may either return a socket immediately or invoke
   * the error-first callback later. Completion is guarded so an implementation
   * that does both still installs exactly one socket.
   */
  createSocket(
    request: SocketReceiver,
    options: AgentConnectionOptions,
    callback: CreateSocketCallback,
  ): void {
    const connectionOptions = this.#connectionOptions(options);
    const timeout = request.timeout || this.options.timeout;
    if (timeout !== undefined) connectionOptions.timeout = timeout;
    if (this.keepAlive) {
      connectionOptions.keepAlive = true;
      connectionOptions.keepAliveInitialDelay = this.keepAliveMsecs;
    }

    let completed = false;
    const onCreated: CreateSocketCallback = (error, socket) => {
      if (completed) return;
      completed = true;
      if (error !== null && error !== undefined) {
        callback(error);
      } else if (socket === undefined) {
        callback(new TypeError("createConnection did not provide a socket"));
      } else {
        callback(null, socket);
      }
    };

    let socket: HTTPDuplex | undefined;
    try {
      socket = this.createConnection(connectionOptions, onCreated);
    } catch (error) {
      onCreated(error);
      return;
    }
    // Completion belongs outside the construction catch. If the consumer's
    // callback rejects an otherwise valid transport, that exception is not a
    // second connection error and must never be swallowed here.
    if (socket !== undefined) onCreated(null, socket);
  }

  /** Give `request` a socket, now or when one comes free. */
  addRequest(request: SocketReceiver, options: AgentConnectionOptions): void;
  addRequest(request: SocketReceiver, host: string, port?: number, localAddress?: string): void;
  addRequest(
    request: SocketReceiver,
    optionsOrHost: AgentConnectionOptions | string,
    port?: number,
    localAddress?: string,
  ): void {
    const options: AgentConnectionOptions =
      typeof optionsOrHost === "string"
        ? { host: optionsOrHost, port, localAddress }
        : optionsOrHost;
    const connectionOptions = this.#connectionOptions(options);
    const name = this.getName(connectionOptions);

    const free = this.freeSockets[name];
    if (free !== undefined) {
      // Destruction and its close callback are asynchronous. A caller may
      // destroy an idle socket from its `free`/`timeout` listener and issue a
      // replacement request in the same turn, before accounting cleanup has
      // run. Never hand that visibly destroyed socket back out.
      while (free.length > 0 && free[0]?.destroyed) free.shift();
      if (free.length === 0) delete this.freeSockets[name];
    }
    if (free && free.length > 0) {
      // LIFO by default: the most recently used socket is the one most likely
      // to still be open at the other end, since an idle timeout kills the
      // oldest first.
      const socket = this.scheduling === "fifo" ? free.shift() : free.pop();
      if (free.length === 0) delete this.freeSockets[name];
      if (socket) {
        // A reused connection is doing new work for a new caller, so it gets a
        // new identity. Keeping the old one would attribute this request to
        // whichever request happened to release the socket.
        if (socket instanceof Socket) socket.asyncReset();
        this.reuseSocket(socket, request);
        (this.sockets[name] ??= []).push(socket);
        request.onSocket(socket);
        this.#setRequestSocketTimeout(socket, request);
        return;
      }
    }

    const inUse = this.sockets[name]?.length ?? 0;
    if (inUse >= this.maxSockets || this.totalSocketCount >= this.maxTotalSockets) {
      // Queued rather than refused: the caller asked for a request, not for a
      // socket, and a client that failed here would be failing for a reason
      // the program cannot see or act on.
      (this.requests[name] ??= []).push({
        options: connectionOptions,
        request,
        // The socket becomes available from a different request's callback.
        // This explicit resource carries the queuing request's identity and
        // AsyncLocalStorage frame across that gap.
        resource: new AsyncResource("QueuedRequest", { requireManualDestroy: true }),
      });
      return;
    }

    this.createSocket(request, connectionOptions, (error, socket) => {
      if (error !== null || socket === undefined) {
        nextTick(() => request.onSocket(null, error));
        return;
      }
      this.#assignCreatedSocket(name, socket, request, connectionOptions);
    });
  }

  /**
   * The request is done with this socket.
   *
   * Kept for reuse only if both ends agreed to it and the pool has room;
   * otherwise closed. A socket that is kept must be *idle* -- nothing left
   * unread -- which the caller decides, not this.
   */
  keepSocketAlive(socket: HTTPDuplex): boolean {
    socket.setKeepAlive?.(true, this.keepAliveMsecs);
    // Unrefed while idle: a pooled connection should not be the reason a
    // program cannot exit.
    socket.unref?.();

    let timeout = this.options.timeout ?? 0;
    const keepAlive = this.#keepAliveHints.get(socket);
    if (keepAlive !== undefined) {
      const match = /^timeout=(\d+)/.exec(keepAlive);
      const seconds = match === null ? undefined : Number(match[1]);
      if (seconds !== undefined) {
        const safeTimeout = seconds * 1000 - this.agentKeepAliveTimeoutBuffer;
        if (safeTimeout <= 0) return false;
        if (safeTimeout < timeout) timeout = safeTimeout;
      }
    }
    if (socket.setTimeout !== undefined && socket.timeout !== timeout) socket.setTimeout(timeout);
    return true;
  }

  reuseSocket(socket: HTTPDuplex, request: SocketReceiver): void {
    this.#removeFreeSocketError(socket);
    if (socket instanceof Socket) socket.setIdleReadGuard(false);
    socket.ref?.();
    request.reusedSocket = true;
  }

  release(name: string, socket: HTTPDuplex, reusable: boolean, keepAliveHint?: string): void {
    if (keepAliveHint !== undefined) this.#keepAliveHints.set(socket, keepAliveHint);
    this.#release(name, socket, reusable);
  }

  #release(requestedName: string, socket: HTTPDuplex, reusable: boolean): void {
    if (!this.#owns(socket)) return;
    // The pool key has to be the one this socket was filed under.
    //
    // Node captures one options object when it creates a socket and hands
    // that same object to `getName` at both ends -- acquisition, and again in
    // the `free` handler via `agent.emit('free', s, options)` -- so the two
    // keys agree by construction rather than by two computations happening to
    // match. Recomputing the key from a request's host and port drops every
    // other field `getName` reads, and `socketPath` is one of them: a
    // connection opened for a Unix socket was filed under a key no later
    // lookup could produce, so keep-alive reuse missed and each request
    // opened a new connection.
    const created = this.#socketOptions.get(socket);
    const name = created === undefined ? requestedName : this.getName(created);
    const inUse = this.sockets[name];
    if (inUse) {
      const at = inUse.indexOf(socket);
      if (at !== -1) inUse.splice(at, 1);
      if (inUse.length === 0) delete this.sockets[name];
    }

    // Somebody is waiting: hand it straight on rather than putting it in the
    // free list and taking it out again.
    const waiting = this.#pruneDestroyedRequests(name);
    if (waiting && waiting.length > 0 && reusable && !socket.destroyed) {
      const next = waiting.shift();
      if (next === undefined) return;
      if (waiting.length === 0) delete this.requests[name];
      try {
        next.resource.runInAsyncScope(() => {
          if (socket instanceof Socket) socket.asyncReset();
          (this.sockets[name] ??= []).push(socket);
          this.reuseSocket(socket, next.request);
          next.request.onSocket(socket);
          this.#setRequestSocketTimeout(socket, next.request);
        });
      } finally {
        next.resource.emitDestroy();
      }
      this.#emitFree(socket);
      return;
    }

    if (waiting && waiting.length > 0) {
      // A non-reusable connection must release its global slot before a
      // replacement is opened. The close path selects this origin first.
      this.#emitFree(socket);
      socket.destroy();
      return;
    }

    if (this.#hasWaitingOriginOtherThan(name)) {
      // A TCP connection cannot change origin. Retire this idle candidate so
      // the global maxTotalSockets slot can serve a queued origin.
      this.#emitFree(socket);
      socket.destroy();
      return;
    }

    if (!this.keepAlive || !reusable || socket.destroyed) {
      this.#emitFree(socket);
      socket.destroy();
      return;
    }

    let canKeepAlive = false;
    try {
      canKeepAlive = this.keepSocketAlive(socket);
    } finally {
      this.#keepAliveHints.delete(socket);
    }
    if (!canKeepAlive) {
      this.#emitFree(socket);
      socket.destroy();
      return;
    }

    if (socket instanceof Socket) {
      socket.setIdleReadGuard(true);
      if (socket.destroyed) {
        this.#emitFree(socket);
        return;
      }
    }

    const free = (this.freeSockets[name] ??= []);
    if (free.length >= this.maxFreeSockets) {
      this.#emitFree(socket);
      socket.destroy();
      return;
    }
    free.push(socket);
    // Idle in the pool, belonging to no request. The next acquisition calls
    // `asyncReset()` before handing it out, so no request observes stale
    // identity or context. Node's additional Symbol mirror is internal
    // metaobject state and is deliberately not part of the typed socket.
    this.#installFreeSocketError(socket);
    this.#emitFree(socket);
  }

  #assignCreatedSocket(
    name: string,
    socket: HTTPDuplex,
    request: SocketReceiver,
    options: AgentConnectionOptions,
  ): void {
    this.#ownedSockets.add(socket);
    this.#socketOptions.set(socket, options);
    this.totalSocketCount++;
    (this.sockets[name] ??= []).push(socket);
    socket.setTimeout?.(request.timeout || this.options.timeout || 0);

    const listeners: ManagedSocketListeners = {
      close: () => this.#socketClosed(name, socket),
      timeout: () => {
        if (this.#freeSocketErrors.has(socket)) socket.destroy();
      },
      remove: () => this.#socketRemoved(name, socket),
    };
    this.#socketListeners.set(socket, listeners);
    socket.on("timeout", listeners.timeout);
    socket.once("agentRemove", listeners.remove);

    request.onSocket(socket);
    // Request observers must see the connection as agent-owned while their
    // close/error handling runs. Register the accounting listener after the
    // request's own next-tick activation has installed its socket listeners,
    // so it runs later in that same close emission.
    nextTick(() => {
      if (this.#owns(socket)) socket.once("close", listeners.close);
    });
  }

  #forgetSocket(name: string, socket: HTTPDuplex): boolean {
    this.#removeFromPool(this.sockets, name, socket);
    this.#removeFromPool(this.freeSockets, name, socket);
    this.#removeFreeSocketError(socket);
    this.#keepAliveHints.delete(socket);
    if (socket instanceof Socket) socket.setIdleReadGuard(false);

    const listeners = this.#socketListeners.get(socket);
    if (listeners !== undefined) {
      socket.removeListener("close", listeners.close);
      socket.removeListener("timeout", listeners.timeout);
      socket.removeListener("agentRemove", listeners.remove);
      this.#socketListeners.delete(socket);
    }

    if (!this.#owns(socket)) return false;
    this.#ownedSockets.delete(socket);
    this.#socketOptions.delete(socket);
    this.totalSocketCount--;
    return true;
  }

  #owns(socket: HTTPDuplex): boolean {
    return this.#ownedSockets.has(socket);
  }

  #removeFromPool(pool: Record<string, HTTPDuplex[]>, name: string, socket: HTTPDuplex): void {
    const sockets = pool[name];
    if (sockets === undefined) return;
    const index = sockets.indexOf(socket);
    if (index !== -1) sockets.splice(index, 1);
    if (sockets.length === 0) delete pool[name];
  }

  #installFreeSocketError(socket: HTTPDuplex): void {
    // This callback is already handling the emitted error. Destroying with
    // that same error would schedule a second `error` after this once-listener
    // has removed itself, turning an idle reset into an unhandled exception.
    const onError: SocketErrorListener = (_error) => socket.destroy();
    this.#freeSocketErrors.set(socket, onError);
    socket.once("error", onError);
  }

  #removeFreeSocketError(socket: HTTPDuplex): void {
    const onError = this.#freeSocketErrors.get(socket);
    if (onError === undefined) return;
    this.#freeSocketErrors.delete(socket);
    socket.removeListener("error", onError);
  }

  #emitFree(socket: HTTPDuplex): void {
    socket.emit("free");
    this.emit("free", socket, this.#socketOptions.get(socket));
  }

  #hasWaitingOriginOtherThan(name: string): boolean {
    for (const key of Object.keys(this.requests)) {
      if (key !== name && this.#pruneDestroyedRequests(key) !== undefined) return true;
    }
    return false;
  }

  /** Restore a request-specific timeout after an idle socket is reused. */
  #setRequestSocketTimeout(socket: HTTPDuplex, request: SocketReceiver): void {
    const agentTimeout = this.options.timeout ?? 0;
    if (request.timeout !== undefined && request.timeout !== agentTimeout) {
      socket.setTimeout?.(request.timeout);
    }
  }

  /** Drop requests cancelled while they waited for an Agent socket. */
  #pruneDestroyedRequests(name: string): Pending[] | undefined {
    const requests = this.requests[name];
    if (requests === undefined) return undefined;
    while (requests.length > 0) {
      const first = requests[0];
      if (first === undefined) {
        throw new Error("non-empty HTTP agent queue had no first request");
      }
      if (!first.request.destroyed) return requests;
      requests.shift();
      first.resource.emitDestroy();
    }
    delete this.requests[name];
    return undefined;
  }

  #takePending(preferredName: string): { name: string; pending: Pending } | undefined {
    const preferred = this.#pruneDestroyedRequests(preferredName);
    if (preferred !== undefined) {
      const preferredPending = preferred.shift();
      if (preferredPending === undefined) {
        throw new Error("non-empty HTTP agent queue had no first request");
      }
      if (preferred.length === 0) delete this.requests[preferredName];
      return { name: preferredName, pending: preferredPending };
    }

    for (const name of Object.keys(this.requests)) {
      if ((this.sockets[name]?.length ?? 0) >= this.maxSockets) continue;
      const requests = this.#pruneDestroyedRequests(name);
      if (requests === undefined) continue;
      const pending = requests.shift();
      if (pending === undefined) {
        throw new Error("non-empty HTTP agent queue had no first request");
      }
      if (requests.length === 0) delete this.requests[name];
      return { name, pending };
    }
    return undefined;
  }

  #socketClosed(name: string, socket: HTTPDuplex): void {
    if (this.#forgetSocket(name, socket)) this.#openPending(name);
  }

  #socketRemoved(name: string, socket: HTTPDuplex): void {
    if (this.#forgetSocket(name, socket)) this.#openPending(name);
  }

  #openPending(preferredName: string): void {
    const next = this.#takePending(preferredName);
    if (next === undefined) return;

    const complete: CreateSocketCallback = (error, socket) => {
      try {
        next.pending.resource.runInAsyncScope(() => {
          if (error !== null || socket === undefined) {
            next.pending.request.onSocket(null, error);
            return;
          }
          this.#assignCreatedSocket(next.name, socket, next.pending.request, next.pending.options);
          this.#emitFree(socket);
        });
      } finally {
        next.pending.resource.emitDestroy();
      }
    };

    try {
      this.createSocket(next.pending.request, next.pending.options, complete);
    } catch (error) {
      complete(error);
    }
  }

  /** Close everything, in use and idle. */
  destroy(): void {
    for (const pool of [this.freeSockets, this.sockets]) {
      for (const key of Object.keys(pool)) {
        const sockets = pool[key];
        if (sockets === undefined) continue;
        for (const socket of sockets) socket.destroy();
        delete pool[key];
      }
    }
  }
}

/** Construct Node's keep-alive default, optionally with environment proxy routing. */
export function createGlobalAgent(proxyEnv?: ProxyEnvironment): Agent {
  return new Agent({ keepAlive: true, scheduling: "lifo", timeout: 5000, proxyEnv });
}

/**
 * Whether the global agent routes through the environment's proxy.
 *
 * Node reads one normalized option, `--use-env-proxy`, once and only when the
 * global agent is constructed (`lib/_http_agent.js`). That option is fed from
 * two places: the command-line flag, and `NODE_USE_ENV_PROXY`, which
 * `src/node_options.cc` normalizes with an exact comparison against `"1"` --
 * so `NODE_USE_ENV_PROXY=true` does not enable it and neither does `=0`.
 *
 * Only the environment half is visible from here. This profile has no
 * normalized startup-option state, so the command-line flag cannot be
 * observed; a test that passes `--use-env-proxy` rather than the variable is
 * a genuine runtime gap and is recorded as one rather than approximated by
 * scanning `execArgv`, which would report the flag as present in cases where
 * node's own normalization would have rejected it.
 */
function useEnvironmentProxy(): boolean {
  return processEnvironment.NODE_USE_ENV_PROXY === "1";
}

/** The agent `http.request` uses when the caller does not supply one. */
export let globalAgent = createGlobalAgent(useEnvironmentProxy() ? processEnvironment : undefined);

/** Read the live binding when constructing Node's writable CommonJS facade. */
export function readGlobalAgentBinding(): Agent {
  return globalAgent;
}

/** Update the live binding through Node's writable CommonJS facade. */
export function writeGlobalAgentBinding(agent: Agent): void {
  globalAgent = agent;
}
