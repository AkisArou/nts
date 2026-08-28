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
import { nextTick } from "../../internal/tick.ts";

export interface AgentOptions {
  /** Keep idle sockets for reuse. Off by default, as node's is. */
  keepAlive?: boolean | undefined;
  /** How long an idle socket is kept before being closed. */
  keepAliveMsecs?: number | undefined;
  maxSockets?: number | undefined;
  maxFreeSockets?: number | undefined;
  /** How long a request may wait for a socket. */
  timeout?: number | undefined;
  scheduling?: "fifo" | "lifo" | undefined;
}

interface Pending {
  options: { host: string; port: number };
  callback: (error: unknown, socket?: Socket) => void;
}

export class Agent extends EventEmitter {
  keepAlive: boolean;
  keepAliveMsecs: number;
  maxSockets: number;
  maxFreeSockets: number;
  scheduling: "fifo" | "lifo";
  options: AgentOptions;

  /** In use, by `host:port`. */
  sockets: Record<string, Socket[]> = Object.create(null) as Record<string, Socket[]>;
  /** Idle and reusable, by the same key. */
  freeSockets: Record<string, Socket[]> = Object.create(null) as Record<string, Socket[]>;
  /** Waiting for a socket because the host is at `maxSockets`. */
  requests: Record<string, Pending[]> = Object.create(null) as Record<string, Pending[]>;

  constructor(options: AgentOptions = {}) {
    super();
    this.options = { ...options };
    this.keepAlive = options.keepAlive ?? false;
    this.keepAliveMsecs = options.keepAliveMsecs ?? 1000;
    this.maxSockets = options.maxSockets ?? Infinity;
    this.maxFreeSockets = options.maxFreeSockets ?? 256;
    this.scheduling = options.scheduling ?? "lifo";
  }

  /**
   * The pool key.
   *
   * Host and port, and nothing else. Anything that changes what the connection
   * *is* -- a different local interface, a different TLS identity -- has to be
   * part of it, or a socket would be handed to a request that must not use it.
   */
  getName(options: { host?: string; port?: number; localAddress?: string }): string {
    let name = `${options.host ?? "localhost"}:${options.port ?? ""}`;
    if (options.localAddress) name += `:${options.localAddress}`;
    return name;
  }

  createConnection(options: { host: string; port: number }): Socket {
    return netConnect(options.port, options.host);
  }

  /** Give `request` a socket, now or when one comes free. */
  addRequest(
    request: { onSocket(socket: Socket): void },
    options: { host?: string; port?: number },
  ): void {
    const host = options.host ?? "localhost";
    const port = options.port ?? 80;
    const name = this.getName({ host, port });

    const free = this.freeSockets[name];
    if (free && free.length > 0) {
      // LIFO by default: the most recently used socket is the one most likely
      // to still be open at the other end, since an idle timeout kills the
      // oldest first.
      const socket = this.scheduling === "fifo" ? free.shift() : free.pop();
      if (free.length === 0) delete this.freeSockets[name];
      if (socket) {
        (this.sockets[name] ??= []).push(socket);
        nextTick(() => request.onSocket(socket));
        return;
      }
    }

    const inUse = this.sockets[name]?.length ?? 0;
    if (inUse >= this.maxSockets) {
      // Queued rather than refused: the caller asked for a request, not for a
      // socket, and a client that failed here would be failing for a reason
      // the program cannot see or act on.
      (this.requests[name] ??= []).push({
        options: { host, port },
        callback: (_error, socket) => {
          if (socket) request.onSocket(socket);
        },
      });
      return;
    }

    const socket = this.createConnection({ host, port });
    (this.sockets[name] ??= []).push(socket);
    socket.once("close", () => this.#release(name, socket, false));
    request.onSocket(socket);
  }

  /**
   * The request is done with this socket.
   *
   * Kept for reuse only if both ends agreed to it and the pool has room;
   * otherwise closed. A socket that is kept must be *idle* -- nothing left
   * unread -- which the caller decides, not this.
   */
  keepSocketAlive(socket: Socket): boolean {
    socket.setKeepAlive(true, this.keepAliveMsecs);
    socket.unref();
    return true;
  }

  reuseSocket(socket: Socket, _request: unknown): void {
    socket.ref();
  }

  release(name: string, socket: Socket, reusable: boolean): void {
    this.#release(name, socket, reusable);
  }

  #release(name: string, socket: Socket, reusable: boolean): void {
    const inUse = this.sockets[name];
    if (inUse) {
      const at = inUse.indexOf(socket);
      if (at !== -1) inUse.splice(at, 1);
      if (inUse.length === 0) delete this.sockets[name];
    }

    // Somebody is waiting: hand it straight on rather than putting it in the
    // free list and taking it out again.
    const waiting = this.requests[name];
    if (waiting && waiting.length > 0 && reusable && !socket.destroyed) {
      const next = waiting.shift() as Pending;
      if (waiting.length === 0) delete this.requests[name];
      (this.sockets[name] ??= []).push(socket);
      next.callback(null, socket);
      return;
    }

    if (waiting && waiting.length > 0) {
      const next = waiting.shift() as Pending;
      if (waiting.length === 0) delete this.requests[name];
      const replacement = this.createConnection(next.options);
      (this.sockets[name] ??= []).push(replacement);
      replacement.once("close", () => this.#release(name, replacement, false));
      next.callback(null, replacement);
      return;
    }

    if (!this.keepAlive || !reusable || socket.destroyed) {
      socket.destroy();
      return;
    }

    const free = (this.freeSockets[name] ??= []);
    if (free.length >= this.maxFreeSockets) {
      socket.destroy();
      return;
    }
    free.push(socket);
    this.keepSocketAlive(socket);
  }

  /** Close everything, in use and idle. */
  destroy(): void {
    for (const pool of [this.freeSockets, this.sockets]) {
      for (const key of Object.keys(pool)) {
        for (const socket of pool[key] as Socket[]) socket.destroy();
        delete pool[key];
      }
    }
  }
}

/** The agent `http.request` uses when the caller does not supply one. */
export const globalAgent = new Agent({ keepAlive: true, scheduling: "lifo" });
