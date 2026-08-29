// `node:net`, from node v24.20.0 `lib/net.js`.
//
// A TCP socket is a `Duplex` whose two halves are genuinely independent: the
// direction you write and the direction you read are separate streams over one
// connection, and either can end without the other. That is what `FIN` means
// on the wire, and it is why `allowHalfOpen` exists — sending `FIN` says "I
// have nothing more to send", not "stop sending to me". Node's default is to
// close anyway, because most programs do not want the half-open state and the
// ones that do know they want it.
//
// The seam is a handle per connection and per listener. Everything above it —
// the stream integration, the timeouts, the address handling, the connection
// events — is here.

import { Buffer } from "../../buffer/src/main.ts";
import { Duplex } from "../../stream/src/duplex.ts";
import { EventEmitter } from "../../events/src/main.ts";
import { nextTick } from "../../internal/tick.ts";
import { uvException } from "../../internal/uv.ts";
import {
  ERR_INVALID_ARG_TYPE,
  ERR_SOCKET_CLOSED,
} from "../../internal/errors.ts";
import { validateFunction, validateNumber, validateString } from "../../internal/validators.ts";
import { isIP, isIPv4, isIPv6 } from "./address.ts";
// This module's own timers, not an ambient global: the idle timeout wants a
// `Timeout` object it can `refresh()`, which is what makes resetting the clock
// on every byte one pointer write rather than a new timer per byte.
import { clearTimeout, setTimeout } from "../../timers/src/main.ts";
import type { Timeout } from "../../timers/src/main.ts";

export { isIP, isIPv4, isIPv6 };

/**
 * Open a connection. The handle is negative on immediate failure.
 *
 * The callback reports the outcome: a connection is not established when
 * `connect` returns, and everything above this seam is written around that.
 */
declare function nts_net_connect(
  host: string,
  port: number,
  path: string,
  callback: (errno: number) => void,
): number;

/** Start delivering incoming bytes. Nothing arrives before this is called. */
declare function nts_net_read_start(
  handle: number,
  onData: (bytes: number[]) => void,
  onEnd: () => void,
  onError: (errno: number) => void,
): void;
declare function nts_net_read_stop(handle: number): void;
declare function nts_net_write(
  handle: number,
  bytes: number[],
  callback: (errno: number) => void,
): void;
/** Send `FIN`: nothing more will be written, but reading continues. */
declare function nts_net_shutdown(handle: number, callback: (errno: number) => void): void;
declare function nts_net_close(handle: number): void;
/** `[address, family, port]`, family as 4 or 6. */
declare function nts_net_address(handle: number, remote: boolean): (string | number)[];
declare function nts_net_set_no_delay(handle: number, enable: boolean): void;
declare function nts_net_set_keepalive(handle: number, enable: boolean, delay: number): void;
/**
 * Whether this connection should keep the process alive.
 *
 * Separate from whether it is open. An unrefed socket still works -- it can be
 * read and written and will deliver events -- it just stops counting as a
 * reason for the loop to keep running. That distinction is what lets a server
 * hold keep-alive connections open without preventing the program from ever
 * exiting.
 */
declare function nts_net_ref(handle: number, keepProcessAlive: boolean): void;

/**
 * Start listening. Binding is not complete when this returns.
 *
 * `onListening` rather than a synchronous answer, because a bind can fail for
 * reasons only the kernel knows -- an address that is not local, a port
 * already taken -- and reporting success before it has succeeded means
 * emitting `listening` on a server that never will.
 */
declare function nts_net_listen(
  host: string,
  port: number,
  path: string,
  backlog: number,
  onListening: () => void,
  onConnection: (connection: number) => void,
  onError: (errno: number) => void,
): number;
declare function nts_net_server_address(handle: number): (string | number)[];
declare function nts_net_server_close(handle: number, callback: () => void): void;
declare function nts_net_server_ref(handle: number, keepProcessAlive: boolean): void;

export interface SocketOptions {
  fd?: number | undefined;
  allowHalfOpen?: boolean | undefined;
  readable?: boolean | undefined;
  writable?: boolean | undefined;
  signal?: never;
  /** An already-connected handle, used when a server accepts. */
  handle?: number | undefined;
  noDelay?: boolean | undefined;
  keepAlive?: boolean | undefined;
  keepAliveInitialDelay?: number | undefined;
}

export interface ConnectOptions {
  port?: number | undefined;
  host?: string | undefined;
  path?: string | undefined;
  localAddress?: string | undefined;
  localPort?: number | undefined;
  family?: number | undefined;
  noDelay?: boolean | undefined;
  keepAlive?: boolean | undefined;
  keepAliveInitialDelay?: number | undefined;
  allowHalfOpen?: boolean | undefined;
}

export interface AddressInfo {
  address: string;
  family: string;
  port: number;
}

function asAddress(columns: (string | number)[]): AddressInfo | Record<string, never> {
  if (columns.length === 0) return {};
  return {
    address: columns[0] as string,
    family: (columns[1] as number) === 6 ? "IPv6" : "IPv4",
    port: columns[2] as number,
  };
}

export class Socket extends Duplex {
  /** The connection, once there is one. */
  _handle: number | null = null;

  connecting = false;
  pending = true;
  readyState: "opening" | "open" | "readOnly" | "writeOnly" | "closed" = "closed";
  bytesRead = 0;
  bytesWritten = 0;

  /** The idle timeout, if one was set. */
  timeout: number | undefined;
  #timer: Timeout | null = null;

  #localAddress: AddressInfo | Record<string, never> = {};
  #remoteAddress: AddressInfo | Record<string, never> = {};
  #readingStarted = false;

  constructor(options: SocketOptions = {}) {
    super({
      // A socket carries bytes. Object mode would be a category error and node
      // does not offer it.
      objectMode: false,
      // Node's default is to close both halves when either ends, because most
      // programs do not want the half-open state and the ones that do ask.
      allowHalfOpen: options.allowHalfOpen ?? false,
      // Destroyed once both halves are done. Node keeps this off and manages
      // destruction by hand, for reasons of its own history; the duplex's own
      // rule is the same rule -- a socket whose read side ended and whose
      // write side finished has nothing left -- and letting it apply means one
      // implementation rather than two.
      autoDestroy: true,
      // The stream's own `close` carries no argument; a socket's carries
      // whether it is closing because of an error, which is what a listener
      // needs in order to decide whether to reconnect. So the stream's is
      // turned off and this class emits its own, as node does.
      emitClose: false,
      readable: options.readable ?? true,
      writable: options.writable ?? true,
    });

    if (options.handle !== undefined) {
      this._handle = options.handle;
      this.pending = false;
      this.readyState = "open";
      this.#capture();
      if (options.noDelay) this.setNoDelay(true);
      if (options.keepAlive) {
        this.setKeepAlive(true, options.keepAliveInitialDelay ?? 0);
      }
      // Start the first read, or take an immediate end-of-file. It consumes
      // nothing -- the length is zero -- but it arms the readable machinery,
      // and without it a socket that is never read never learns that the
      // other end has gone: the `FIN` arrives, `push(null)` records it, and
      // nothing ever asks, so `end` and `close` are never emitted.
      if (options.readable !== false) this.read(0);
    }
  }

  get localAddress(): string | undefined {
    return (this.#localAddress as AddressInfo).address;
  }
  get localPort(): number | undefined {
    return (this.#localAddress as AddressInfo).port;
  }
  get localFamily(): string | undefined {
    return (this.#localAddress as AddressInfo).family;
  }
  get remoteAddress(): string | undefined {
    return (this.#remoteAddress as AddressInfo).address;
  }
  get remotePort(): number | undefined {
    return (this.#remoteAddress as AddressInfo).port;
  }
  get remoteFamily(): string | undefined {
    return (this.#remoteAddress as AddressInfo).family;
  }

  /** The local end of the connection. Empty until there is one. */
  address(): AddressInfo | Record<string, never> {
    return this.#localAddress;
  }

  get bufferSize(): number {
    return this.writableLength ?? 0;
  }

  #capture(): void {
    if (this._handle === null) return;
    this.#localAddress = asAddress(nts_net_address(this._handle, false));
    this.#remoteAddress = asAddress(nts_net_address(this._handle, true));
  }

  connect(...args: unknown[]): this {
    const { options, callback } = normaliseConnectArguments(args);

    if (callback !== undefined) this.once("connect", callback as never);

    this.connecting = true;
    this.readyState = "opening";

    const host = options.host ?? "localhost";
    const port = options.port ?? 0;
    const path = options.path ?? "";

    const handle = nts_net_connect(host, port, path, (errno) => {
      this.connecting = false;
      if (errno < 0) {
        this.destroy(uvException(errno, "connect", path || `${host}:${port}`));
        return;
      }
      this.pending = false;
      this.readyState = "open";
      this.#capture();
      if (options.noDelay) this.setNoDelay(true);
      if (options.keepAlive) {
        this.setKeepAlive(true, options.keepAliveInitialDelay ?? 0);
      }
      this.emit("connect");
      this.emit("ready");
      // The same first read as above, for the same reason.
      if (!this.isPaused()) this.read(0);
    });

    if (handle < 0) {
      nextTick(() => this.destroy(uvException(handle, "connect", path || `${host}:${port}`)));
      return this;
    }

    this._handle = handle;
    return this;
  }

  #maybeStartReading(): void {
    if (this.#readingStarted || this._handle === null) return;
    this.#readingStarted = true;

    nts_net_read_start(
      this._handle,
      (bytes: number[]) => {
        this.bytesRead += bytes.length;
        this.#refreshTimeout();
        // `push` returning false is the socket's backpressure: stop reading
        // from the kernel until the consumer catches up, or the buffer grows
        // without bound.
        if (!this.push(Buffer.from(bytes)) && this._handle !== null) {
          nts_net_read_stop(this._handle);
          this.#readingStarted = false;
        }
      },
      () => {
        // `FIN` from the other end: no more data is coming, but this end may
        // still write.
        //
        // The `read(0)` is not redundant. `push(null)` records the end; it
        // does not *deliver* it, and a readable with no consumer never asks
        // again on its own -- so `end` and `close` would never be emitted on
        // a socket nobody reads, which is most of the sockets in a server
        // that only writes. Node does the same two calls in the same order.
        this.push(null);
        this.read(0);
      },
      (errno: number) => {
        this.destroy(uvException(errno, "read"));
      },
    );
  }

  override _read(): void {
    // Deferred rather than dropped. Returning here would leave the readable's
    // `reading` flag set with nothing on the way to clear it, so the *next*
    // `read` would decline as redundant and the socket would never start --
    // which is what happens to any consumer that attaches a `data` listener
    // before the connection is established, as an HTTP client does.
    if (this.connecting || this._handle === null) {
      this.once("connect", (() => this._read()) as never);
      return;
    }
    this.#maybeStartReading();
  }

  override _write(chunk: unknown, encoding: string, callback: (error?: unknown) => void): void {
    if (this._handle === null) {
      callback(new ERR_SOCKET_CLOSED());
      return;
    }
    const buffer = typeof chunk === "string" ? Buffer.from(chunk, encoding) : (chunk as Buffer);
    this.#refreshTimeout();

    nts_net_write(this._handle, Array.from(buffer) as number[], (errno) => {
      if (errno < 0) {
        callback(uvException(errno, "write"));
        return;
      }
      this.bytesWritten += buffer.length;
      callback();
    });
  }

  override _final(callback: (error?: unknown) => void): void {
    if (this._handle === null) {
      callback();
      return;
    }
    // A shutdown rather than a close: the read side stays open, which is what
    // makes a half-open connection possible at all.
    nts_net_shutdown(this._handle, (errno) => {
      callback(errno < 0 ? uvException(errno, "shutdown") : undefined);
    });
  }

  override _destroy(error: unknown, callback: (error?: unknown) => void): void {
    this.#clearTimeout();
    if (this._handle !== null) {
      nts_net_close(this._handle);
      this._handle = null;
    }
    this.connecting = false;
    this.readyState = "closed";
    callback(error);
    // `close` carries whether the socket is being closed because of an error,
    // which a listener needs in order to know whether to reconnect.
    this.emit("close", Boolean(error));
  }

  /**
   * Disable Nagle's algorithm.
   *
   * Nagle coalesces small writes to avoid sending a packet per byte, at the
   * cost of up to a round trip of latency. For a request/response protocol
   * that is exactly the wrong trade, which is why almost every such protocol
   * turns it off.
   */
  setNoDelay(enable = true): this {
    if (this._handle !== null) nts_net_set_no_delay(this._handle, enable);
    return this;
  }

  setKeepAlive(enable = true, initialDelay = 0): this {
    if (this._handle !== null) {
      nts_net_set_keepalive(this._handle, enable, Math.floor(initialDelay / 1000));
    }
    return this;
  }

  /**
   * Emit `timeout` after `msecs` of no activity.
   *
   * It does *not* close the socket. Node emits and leaves the decision to the
   * program, because "nothing has happened for a while" means different things
   * to a request and to an idle keep-alive connection.
   */
  setTimeout(msecs: number, callback?: () => void): this {
    validateNumber(msecs, "msecs");
    this.#clearTimeout();
    this.timeout = msecs;

    if (msecs > 0) {
      this.#timer = setTimeout(() => {
        this.emit("timeout");
      }, msecs);
      if (callback) this.once("timeout", callback as never);
    }
    return this;
  }

  #refreshTimeout(): void {
    if (this.#timer) this.#timer.refresh();
  }

  #clearTimeout(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * Let this connection keep the process alive again.
   *
   * The pair is not decoration. An HTTP server holding keep-alive connections
   * open has, by design, sockets that nothing is waiting on -- and a process
   * whose only remaining work is a connection nobody will speak on again
   * should exit. `unref` is how a socket stays usable without being a reason
   * to keep running, and a no-op version of it is why such a program hangs.
   */
  ref(): this {
    if (this._handle !== null) nts_net_ref(this._handle, true);
    return this;
  }

  unref(): this {
    if (this._handle !== null) nts_net_ref(this._handle, false);
    return this;
  }

  /** End the socket once everything queued has been written. */
  destroySoon(): void {
    if (this.writable) this.end();
    if (this.writableFinished) this.destroy();
    else this.once("finish", () => this.destroy());
  }
}

export interface ServerOptions {
  allowHalfOpen?: boolean | undefined;
  pauseOnConnect?: boolean | undefined;
  noDelay?: boolean | undefined;
  keepAlive?: boolean | undefined;
  keepAliveInitialDelay?: number | undefined;
}

export class Server extends EventEmitter {
  _handle: number | null = null;
  listening = false;
  maxConnections = Infinity;

  #connections = 0;
  #options: ServerOptions;

  constructor(
    options?: ServerOptions | ((socket: Socket) => void),
    connectionListener?: (socket: Socket) => void,
  ) {
    super();
    if (typeof options === "function") {
      connectionListener = options;
      options = {};
    }
    this.#options = options ?? {};
    if (connectionListener) this.on("connection", connectionListener as never);
  }

  listen(...args: unknown[]): this {
    const { options, callback } = normaliseListenArguments(args);
    if (callback) this.once("listening", callback as never);

    const host = options.host ?? "::";
    const port = options.port ?? 0;

    const handle = nts_net_listen(
      host,
      port,
      options.path ?? "",
      options.backlog ?? 511,
      () => {
        this.listening = true;
        this.emit("listening");
      },
      (connection: number) => {
        const socket = new Socket({
          handle: connection,
          allowHalfOpen: this.#options.allowHalfOpen,
          noDelay: this.#options.noDelay,
          keepAlive: this.#options.keepAlive,
          keepAliveInitialDelay: this.#options.keepAliveInitialDelay,
        });

        // Over the limit: accepted and closed immediately, because refusing
        // to accept leaves the connection in the kernel's backlog where the
        // client sees a hang rather than a refusal.
        if (this.#connections >= this.maxConnections) {
          socket.destroy();
          return;
        }

        this.#connections++;
        socket.once("close", () => {
          this.#connections--;
          if (!this.listening && this.#connections === 0) this.emit("close");
        });

        if (!this.#options.pauseOnConnect) socket.resume();
        this.emit("connection", socket);
      },
      (errno: number) => {
        this.listening = false;
        this.emit("error", listenError(errno, host, port, options.path));
      },
    );

    if (handle < 0) {
      nextTick(() => this.emit("error", listenError(handle, host, port, options.path)));
      return this;
    }

    this._handle = handle;
    return this;
  }

  address(): AddressInfo | Record<string, never> | string {
    if (this._handle === null) return {};
    const columns = nts_net_server_address(this._handle);
    // A unix socket's address is its path, not a host and port.
    if (columns.length === 1) return columns[0] as string;
    return asAddress(columns);
  }

  getConnections(callback: (error: unknown, count: number) => void): this {
    validateFunction(callback, "cb");
    const count = this.#connections;
    nextTick(() => callback(null, count));
    return this;
  }

  /**
   * Stop accepting, and close when the last connection goes.
   *
   * Not immediate: existing connections keep working. A server that dropped
   * them on `close` would make a graceful shutdown impossible, which is the
   * main reason to call it.
   */
  close(callback?: (error?: unknown) => void): this {
    if (callback) {
      if (this._handle === null) {
        nextTick(() => callback(new ERR_SERVER_NOT_RUNNING()));
      } else {
        this.once("close", () => callback());
      }
    }

    if (this._handle !== null) {
      const handle = this._handle;
      this._handle = null;
      this.listening = false;
      nts_net_server_close(handle, () => {
        if (this.#connections === 0) this.emit("close");
      });
    }
    return this;
  }

  ref(): this {
    if (this._handle !== null) nts_net_server_ref(this._handle, true);
    return this;
  }

  unref(): this {
    if (this._handle !== null) nts_net_server_ref(this._handle, false);
    return this;
  }

  /** Overridden by `http.Server`, which knows which connections are idle. */
  closeIdleConnections(): void {}
}

/**
 * A failed bind, carrying where it was trying to bind.
 *
 * The address and port are on the error because that is the only useful thing
 * to say: "EADDRINUSE" alone does not tell a program which of its several
 * listeners collided.
 */
function listenError(errno: number, host: string, port: number, path?: string): Error {
  const error = uvException(errno, "listen", path) as Error & {
    address?: string;
    port?: number;
  };
  if (path === undefined || path === "") {
    error.address = host;
    error.port = port;
  }
  return error;
}

/** `Server.close` on a server that was not listening. */
class ERR_SERVER_NOT_RUNNING extends Error {
  code = "ERR_SERVER_NOT_RUNNING";

  constructor() {
    super("Server is not running.");
    this.name = "Error";
  }
}

/**
 * `connect(port[, host][, cb])`, `connect(path[, cb])`, `connect(options[, cb])`.
 *
 * Three shapes because the API predates options objects and kept working.
 * Written out rather than guessed at, because the ambiguous case -- a single
 * number versus a single string -- is the difference between a TCP port and a
 * unix socket path.
 */
function normaliseConnectArguments(args: unknown[]): {
  options: ConnectOptions;
  callback: (() => void) | undefined;
} {
  let options: ConnectOptions = {};
  let callback: (() => void) | undefined;

  const first = args[0];
  if (typeof first === "object" && first !== null) {
    options = { ...(first as ConnectOptions) };
  } else if (typeof first === "string" && isIP(first) === 0 && Number.isNaN(Number(first))) {
    // A string that is neither an address nor a number is a path.
    options = { path: first };
  } else {
    options = { port: Number(first) };
    if (typeof args[1] === "string") options.host = args[1];
  }

  const last = args[args.length - 1];
  if (typeof last === "function") callback = last as () => void;

  return { options, callback };
}

interface ListenOptions {
  port?: number;
  host?: string;
  path?: string;
  backlog?: number;
}

function normaliseListenArguments(args: unknown[]): {
  options: ListenOptions;
  callback: (() => void) | undefined;
} {
  let options: ListenOptions = {};
  let callback: (() => void) | undefined;

  const first = args[0];
  if (typeof first === "object" && first !== null) {
    options = { ...(first as ListenOptions) };
  } else if (typeof first === "string" && Number.isNaN(Number(first))) {
    options = { path: first };
  } else if (first !== undefined) {
    options = { port: Number(first) };
    if (typeof args[1] === "string") options.host = args[1];
    if (typeof args[1] === "number") options.backlog = args[1];
    if (typeof args[2] === "number") options.backlog = args[2];
  }

  const last = args[args.length - 1];
  if (typeof last === "function") callback = last as () => void;

  return { options, callback };
}

export function createServer(
  options?: ServerOptions | ((socket: Socket) => void),
  connectionListener?: (socket: Socket) => void,
): Server {
  return new Server(options, connectionListener);
}

export function connect(...args: unknown[]): Socket {
  const socket = new Socket();
  return socket.connect(...args);
}

export const createConnection = connect;

export { Socket as Stream };
