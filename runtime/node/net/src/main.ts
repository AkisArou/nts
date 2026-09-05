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
import { getDefaultHighWaterMark } from "../../stream/src/state.ts";
import {
  addTrackedAbortListener,
  captureRejectionSymbol,
  EventEmitter,
} from "../../events/src/main.ts";
import type { EventName } from "../../events/src/main.ts";
import { nextTick } from "../../internal/tick.ts";
import {
  dnsException,
  exceptionWithHostPort,
  exceptionWithHostPortDescription,
  uvException,
} from "../../internal/uv.ts";
import {
  AbortError,
  ERR_INVALID_ADDRESS_FAMILY,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_HANDLE_TYPE,
  ERR_INVALID_IP_ADDRESS,
  ERR_IP_BLOCKED,
  ERR_MISSING_ARGS,
  ERR_OUT_OF_RANGE,
  ERR_SOCKET_BAD_PORT,
  ERR_SOCKET_CLOSED,
  ERR_SOCKET_CLOSED_BEFORE_CONNECTION,
  ERR_SOCKET_HANDLE_ADOPTED,
  ERR_STREAM_WRITE_AFTER_END,
} from "../../internal/errors.ts";
import {
  validateBoolean,
  validateFunction,
  validateInteger,
  validateNumber,
  validateString,
} from "../../internal/validators.ts";
import { isIP, isIPv4, isIPv6 } from "./address.ts";
import { BlockList, SocketAddress } from "./block-list.ts";
// This module's own timers, not an ambient global: the idle timeout wants a
// `Timeout` object it can `refresh()`, which is what makes resetting the clock
// on every byte one pointer write rather than a new timer per byte.
import { clearTimeout, getTimerDuration, setTimeout } from "../../timers/src/main.ts";
import type { Timeout } from "../../timers/src/main.ts";
import { AsyncContextFrame } from "../../internal/async-context.ts";
import type { AbortSignalLike } from "../../internal/abort.ts";
import {
  defaultTriggerAsyncIdScope,
  emitAfter,
  emitBefore,
  emitDestroy,
  emitInit,
  getDefaultTriggerAsyncId,
  initHooksExist,
  newAsyncId,
} from "../../internal/async-hooks.ts";

export { isIP, isIPv4, isIPv6 };
export { BlockList, SocketAddress };

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
  localAddress: string,
  localPort: number,
  callback: (errno: number) => void,
): number;
/** Connect a role-neutral handle that was already bound to its local endpoint. */
declare function nts_net_connect_bound(
  handle: number,
  host: string,
  port: number,
  path: string,
  callback: (errno: number) => void,
): number;

/** Bind without yet selecting the handle's listening or connecting role. */
declare function nts_net_bind(
  host: string,
  port: number,
  path: string,
  pipe: boolean,
  ipv6Only: boolean,
  reusePort: boolean,
): number;
declare function nts_net_bound_address_text(handle: number): string;
declare function nts_net_bound_address_numbers(handle: number): number[];
declare function nts_net_bound_fd(handle: number): number;
declare function nts_net_bound_close(handle: number): number;

/** Resolve one hostname to the address used for a connection. */
declare function nts_net_lookup(
  host: string,
  family: number,
  callback: (errno: number, address: string, family: number) => void,
): void;

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
): number;
/** Send `FIN`: nothing more will be written, but reading continues. */
declare function nts_net_shutdown(handle: number, callback: (errno: number) => void): void;
declare function nts_net_close(handle: number, callback: () => void): void;
/** Close a TCP connection with RST rather than the ordinary FIN handshake. */
declare function nts_net_reset(handle: number, callback: (errno: number) => void): void;
/** Address text and `[family, port]`, kept in separately typed native values. */
declare function nts_net_address_text(handle: number, remote: boolean): string;
declare function nts_net_address_numbers(handle: number, remote: boolean): number[];
declare function nts_net_set_no_delay(handle: number, enable: boolean): void;
declare function nts_net_set_keepalive(handle: number, enable: boolean, delay: number): void;
declare function nts_net_set_tos(handle: number, value: number): number;
declare function nts_net_get_tos(handle: number): number;
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
  ipv6Only: boolean,
  reusePort: boolean,
  readableAll: boolean,
  writableAll: boolean,
  fd: number,
  boundHandle: number,
  onListening: () => void,
  onConnection: (connection: number) => void,
  onError: (errno: number) => void,
): number;
declare function nts_net_server_address_text(handle: number): string;
declare function nts_net_server_address_numbers(handle: number): number[];
declare function nts_net_server_close(handle: number, callback: () => void): void;
declare function nts_net_server_ref(handle: number, keepProcessAlive: boolean): void;
declare function nts_net_default_auto_select_family(): boolean;
declare function nts_net_default_auto_select_family_attempt_timeout(): number;

let autoSelectFamilyDefault = nts_net_default_auto_select_family();
let autoSelectFamilyAttemptTimeoutDefault = nts_net_default_auto_select_family_attempt_timeout();

export interface SocketOptions {
  fd?: number | undefined;
  allowHalfOpen?: boolean | undefined;
  highWaterMark?: number | null | undefined;
  readableHighWaterMark?: number | null | undefined;
  writableHighWaterMark?: number | null | undefined;
  blockList?: BlockList | undefined;
  autoSelectFamily?: boolean | undefined;
  autoSelectFamilyAttemptTimeout?: number | undefined;
  readable?: boolean | undefined;
  writable?: boolean | undefined;
  signal?: AbortSignalLike | undefined;
  /** An already-connected handle, used when a server accepts. */
  handle?: number | BoundSocket | undefined;
  /** Native handle kind when a server hands an accepted connection down. */
  handleType?: "tcp" | "pipe" | undefined;
  /** Keep an accepted transport paused until its owner explicitly resumes it. */
  pauseOnCreate?: boolean | undefined;
  noDelay?: boolean | undefined;
  keepAlive?: boolean | undefined;
  keepAliveInitialDelay?: number | undefined;
  onread?: OnReadOptions | undefined;
}

export interface ConnectOptions {
  port?: number | string | undefined;
  host?: string | undefined;
  path?: string | undefined;
  localAddress?: string | undefined;
  localPort?: number | undefined;
  family?: number | undefined;
  hints?: number | undefined;
  lookup?: LookupFunction | undefined;
  timeout?: number | undefined;
  signal?: AbortSignalLike | undefined;
  noDelay?: boolean | undefined;
  keepAlive?: boolean | undefined;
  keepAliveInitialDelay?: number | undefined;
  allowHalfOpen?: boolean | undefined;
  highWaterMark?: number | null | undefined;
  readableHighWaterMark?: number | null | undefined;
  writableHighWaterMark?: number | null | undefined;
  blockList?: BlockList | undefined;
  autoSelectFamily?: boolean | undefined;
  autoSelectFamilyAttemptTimeout?: number | undefined;
  onread?: OnReadOptions | undefined;
}

export interface OnReadOptions {
  buffer: Uint8Array | (() => Uint8Array);
  callback: (this: Socket, bytesRead: number, buffer: Uint8Array) => boolean | void;
}

/** Options passed to a caller-supplied hostname resolver. */
export interface LookupOptions {
  family: number;
  hints: number;
  all?: boolean | undefined;
}

/** One address returned by a resolver operating in `all` mode. */
export interface LookupAddress {
  address: string;
  family: number;
}

export type LookupCallback = (
  error: Error | null,
  address: string | LookupAddress[] | undefined,
  family?: number,
) => void;

export type LookupFunction = (
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
) => void;

type ConnectArguments =
  | [options: ConnectOptions, callback?: () => void]
  | [port: number | string, host: string, callback?: () => void]
  | [portOrPath: number | string, callback?: () => void];

export interface AddressInfo {
  address: string;
  family: string;
  port: number;
}

function makeAddress(address: string, numbers: number[]): AddressInfo | undefined {
  const family = numbers[0];
  const port = numbers[1];
  if (address.length === 0 || family === undefined || port === undefined) return undefined;
  return {
    address,
    family: family === 6 ? "IPv6" : "IPv4",
    port,
  };
}

function validateSocketPort(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new ERR_INVALID_ARG_TYPE("options.port", ["number", "string"], value);
  }
  const port = Number(value);
  if (
    (typeof value === "string" && value.trim().length === 0) ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535
  ) {
    throw new ERR_SOCKET_BAD_PORT("Port", value);
  }
  return port;
}

function validateLookupHints(hints: number | undefined): void {
  if (hints === undefined) return;
  if (!Number.isInteger(hints) || hints < 0 || (hints & ~56) !== 0) {
    throw new ERR_INVALID_ARG_VALUE("hints", hints);
  }
}

type SocketProvider = "TCPWRAP" | "PIPEWRAP";
type ServerProvider = "TCPSERVERWRAP" | "PIPESERVERWRAP";
type RequestProvider =
  | "GETADDRINFOREQWRAP"
  | "TCPCONNECTWRAP"
  | "PIPECONNECTWRAP"
  | "WRITEWRAP"
  | "SHUTDOWNWRAP";

/** Server accounting attached only to sockets created by an accept. */
const acceptedSocketClosing = new WeakMap<Socket, () => void>();

/** One native request made by a socket, with one completion callback. */
class SocketRequest {
  #asyncId: number;
  #triggerAsyncId: number;
  #contextFrame: AsyncContextFrame | undefined;

  constructor(type: RequestProvider, triggerAsyncId: number) {
    this.#asyncId = newAsyncId();
    this.#triggerAsyncId = triggerAsyncId;
    this.#contextFrame = AsyncContextFrame.current();
    if (initHooksExist()) {
      emitInit(this.#asyncId, type, triggerAsyncId, this);
    }
  }

  complete<Result>(callback: () => Result): Result {
    const prior = AsyncContextFrame.exchange(this.#contextFrame);
    emitBefore(this.#asyncId, this.#triggerAsyncId, this);
    try {
      return callback();
    } finally {
      emitAfter(this.#asyncId);
      emitDestroy(this.#asyncId);
      AsyncContextFrame.setCurrent(prior);
    }
  }
}

class MultipleConnectContext {
  readonly addresses: LookupAddress[];
  readonly options: ConnectOptions;
  readonly port: number;
  readonly handles: number[];
  readonly errors: Error[];
  nextIndex = 0;
  pending = 0;
  errorCount = 0;
  timer: Timeout<[Socket, MultipleConnectContext]> | null = null;

  constructor(addresses: LookupAddress[], port: number, options: ConnectOptions) {
    this.addresses = addresses;
    this.options = options;
    this.port = port;
    this.handles = new Array<number>(addresses.length);
    this.errors = new Array<Error>(addresses.length);
  }
}

export interface BoundSocketOptions {
  host?: string | null | undefined;
  port?: number | string | undefined;
  path?: string | undefined;
  ipv6Only?: boolean | undefined;
  reusePort?: boolean | undefined;
}

interface BoundSocketState {
  readonly handle: number;
  active: boolean;
  readonly address: AddressInfo | string;
  readonly pipe: boolean;
}

const boundSocketStates = new WeakMap<BoundSocket, BoundSocketState>();

/**
 * A local endpoint that has been bound but has not chosen a role yet.
 *
 * The native handle is transferred once, either to a `Server` or to a
 * connecting `Socket`. The WeakMap is an encapsulation boundary, not dynamic
 * dispatch: adoption is cold, one-shot setup and no hot read/write operation
 * performs a map lookup.
 */
export class BoundSocket {
  constructor(options: BoundSocketOptions = {}) {
    validateBoundSocketOptions(options);

    if (options.path !== undefined) {
      const handle = nts_net_bind("", 0, options.path, true, false, false);
      if (handle < 0) {
        throw exceptionWithHostPortDescription(handle, "bind", options.path);
      }
      boundSocketStates.set(this, {
        handle,
        active: true,
        address: options.path,
        pipe: true,
      });
      return;
    }

    const port = validateSocketPort(options.port ?? 0);
    const ipv6Only = options.ipv6Only ?? false;
    const reusePort = options.reusePort ?? false;
    validateBoolean(ipv6Only, "options.ipv6Only");
    validateBoolean(reusePort, "options.reusePort");

    const host = options.host ?? (ipv6Only ? "::" : "0.0.0.0");
    validateString(host, "options.host");
    if (isIP(host) === 0) {
      throw new ERR_INVALID_ARG_VALUE(
        "options.host",
        host,
        "must be a numeric IP address; net.BoundSocket does not perform DNS resolution",
      );
    }

    const handle = nts_net_bind(host, port, "", false, ipv6Only, reusePort);
    if (handle < 0) throw exceptionWithHostPort(handle, "bind", host, port);
    const address = makeAddress(
      nts_net_bound_address_text(handle),
      nts_net_bound_address_numbers(handle),
    );
    if (address === undefined) {
      nts_net_bound_close(handle);
      throw exceptionWithHostPort(-22, "bind", host, port);
    }
    boundSocketStates.set(this, { handle, active: true, address, pipe: false });
  }

  address(): AddressInfo | string {
    return activeBoundSocketState(this).address;
  }

  fd(): number {
    return nts_net_bound_fd(activeBoundSocketState(this).handle);
  }

  close(): void {
    const state = activeBoundSocketState(this);
    const handle = state.handle;
    state.active = false;
    const errno = nts_net_bound_close(handle);
    if (errno < 0) throw uvException(errno, "close");
  }

  get isPipe(): boolean {
    return boundSocketState(this).pipe;
  }
}

function boundSocketState(bound: BoundSocket): BoundSocketState {
  const state = boundSocketStates.get(bound);
  if (state === undefined) throw new ERR_SOCKET_HANDLE_ADOPTED();
  return state;
}

function activeBoundSocketState(bound: BoundSocket): BoundSocketState {
  const state = boundSocketState(bound);
  if (!state.active) throw new ERR_SOCKET_HANDLE_ADOPTED();
  return state;
}

function consumeBoundSocket(bound: BoundSocket): number {
  const state = activeBoundSocketState(bound);
  const handle = state.handle;
  state.active = false;
  return handle;
}

function validateBoundSocketOptions(options: unknown): asserts options is BoundSocketOptions {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new ERR_INVALID_ARG_TYPE("options", "Object", options);
  }
  if ("path" in options && options.path !== undefined) {
    if (
      ("host" in options && options.host !== undefined) ||
      ("port" in options && options.port !== undefined) ||
      ("ipv6Only" in options && options.ipv6Only !== undefined) ||
      ("reusePort" in options && options.reusePort !== undefined)
    ) {
      throw new ERR_INVALID_ARG_VALUE(
        "options",
        options,
        "path is mutually exclusive with host, port, ipv6Only, and reusePort",
      );
    }
    validateString(options.path, "options.path");
  }
}

export class Socket extends Duplex {
  /** The connection, once there is one. */
  _handle: number | null = null;

  connecting = false;
  pending = true;
  bytesRead = 0;
  /** The server that accepted this socket, or null for outgoing sockets. */
  server: Server | null = null;
  #dispatchedBytes = 0;
  #pendingBytes = 0;
  #readEndedByPeer = false;
  #resetOnDestroy = false;
  #typeOfService: number | undefined;
  #multipleConnect: MultipleConnectContext | null = null;
  #attemptedAddresses: string[] | undefined;
  #attemptedAddressCount = 0;

  /** The idle timeout, if one was set. */
  timeout: number | undefined;
  #timer: Timeout | null = null;

  #localAddress: AddressInfo | undefined;
  #remoteAddress: AddressInfo | undefined;
  #readingStarted = false;
  #onReadBuffer: Uint8Array | undefined;
  #onReadBufferFactory: (() => Uint8Array) | undefined;
  #onReadCallback: OnReadOptions["callback"] | undefined;
  #pendingReadBytes: number[] | undefined;
  #pendingReadOffset = 0;
  #pendingReadEnd = false;
  #destroyOnIdleData = false;
  #boundSource = false;
  #boundPipe = false;
  #boundPath: string | undefined;

  /** This socket's identity and the context in which it was acquired. */
  #asyncId = 0;
  #triggerAsyncId = 0;
  #contextFrame: AsyncContextFrame | undefined = undefined;
  #provider: SocketProvider = "TCPWRAP";
  #abortCleanup: (() => void) | undefined;

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
      highWaterMark: options.highWaterMark,
      readableHighWaterMark: options.readableHighWaterMark,
      writableHighWaterMark: options.writableHighWaterMark,
    });

    // One shared listener rather than one closure per socket. Besides being
    // observable through listenerCount(), this records why the writable side
    // ended so a later write can report EPIPE rather than the generic stream
    // "write after end" error.
    this.on("end", Socket.#onReadableEnd);

    if (options.onread !== undefined) this.#setOnRead(options.onread);

    if (options.signal !== undefined) this.#watchAbort(options.signal);

    if (options.handle instanceof BoundSocket) {
      const address = options.handle.address();
      this.#boundPipe = options.handle.isPipe;
      this.#boundPath = typeof address === "string" ? address : undefined;
      this.#localAddress = typeof address === "string" ? undefined : address;
      this.#provider = this.#boundPipe ? "PIPEWRAP" : "TCPWRAP";
      this.#resetAsyncIdentity(this.#provider);
      this._handle = consumeBoundSocket(options.handle);
      this.#boundSource = true;
      this.pending = true;
    } else if (options.handle !== undefined) {
      this.#provider = options.handleType === "pipe" ? "PIPEWRAP" : "TCPWRAP";
      // Before the handle is touched, because taking an existing one starts
      // reading and a read can complete before the constructor returns.
      this.#resetAsyncIdentity(this.#provider);
      this._handle = options.handle;
      this.pending = false;
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
      if (options.readable !== false) {
        if (options.pauseOnCreate) this.readableFlowing = false;
        else this.read(0);
      }
    }
  }

  /**
   * Give this socket a fresh identity and the context of whoever is asking.
   *
   * Called at construction, and again when a pooled socket is handed to a new
   * request. The second case is the point: a keep-alive connection reused for
   * a second request is doing new work for a new caller, and a hook that saw
   * the first request's id -- or a store that saw its context -- would
   * attribute the second request to the first.
   */
  asyncReset(): void {
    this.#resetAsyncIdentity(this.#provider);
  }

  /**
   * Arm or disarm the HTTP pool's guard against bytes arriving while no
   * response parser owns this socket. The check lives at the native read
   * boundary, so it adds no public `data` or `readable` listener that user
   * code could remove or observe.
   */
  setIdleReadGuard(enabled: boolean): void {
    this.#destroyOnIdleData = enabled;
    if (enabled && this.readableLength > 0) this.destroy();
  }

  /** The native handle identity used to parent protocol resources above it. */
  asyncId(): number {
    return this.#asyncId;
  }

  #resetAsyncIdentity(provider: SocketProvider): void {
    // The previous identity is finished before the new one begins. Without
    // this a pooled socket accumulates ids that nothing ever reports done, and
    // a leak hunter watching `init` against `destroy` sees a connection that
    // was reused fifty times as fifty resources still open.
    if (this.#asyncId > 0) emitDestroy(this.#asyncId);

    const asyncId = newAsyncId();
    const trigger = getDefaultTriggerAsyncId();
    this.#provider = provider;
    this.#asyncId = asyncId;
    this.#triggerAsyncId = trigger;
    this.#contextFrame = AsyncContextFrame.current();
    if (initHooksExist()) emitInit(asyncId, provider, trigger, this);
  }

  /**
   * Run `fn` as this socket's own asynchronous work.
   *
   * Every callback the runtime hands this socket goes through here. They
   * arrive from the loop with no context at all -- the code that opened the
   * connection returned long ago -- so the context is put back from what the
   * socket captured, and the ids are pushed so a hook can see which connection
   * the work belongs to.
   */
  #inScope<R>(fn: () => R): R {
    const asyncId = this.#asyncId;
    const prior = AsyncContextFrame.exchange(this.#contextFrame);
    emitBefore(asyncId, this.#triggerAsyncId, this);
    try {
      return fn();
    } finally {
      emitAfter(asyncId);
      AsyncContextFrame.setCurrent(prior);
    }
  }

  get localAddress(): string | undefined {
    return this.#boundPath ?? this.#localAddress?.address;
  }
  get localPort(): number | undefined {
    return this.#localAddress?.port;
  }
  get localFamily(): string | undefined {
    return this.#localAddress?.family;
  }
  get remoteAddress(): string | undefined {
    return this.#remoteAddress?.address;
  }
  get remotePort(): number | undefined {
    return this.#remoteAddress?.port;
  }
  get remoteFamily(): string | undefined {
    return this.#remoteAddress?.family;
  }

  /** The local end of the connection. Empty until there is one. */
  address(): AddressInfo | Record<string, never> {
    return this.#localAddress ?? {};
  }

  get bufferSize(): number {
    return this.writableLength ?? 0;
  }

  get readyState(): "opening" | "open" | "readOnly" | "writeOnly" | "closed" {
    if (this.connecting) return "opening";
    if (this.readable) return this.writable ? "open" : "readOnly";
    return this.writable ? "writeOnly" : "closed";
  }

  get autoSelectFamilyAttemptedAddresses(): string[] | undefined {
    return this.#attemptedAddresses?.slice(0, this.#attemptedAddressCount);
  }

  /** Bytes already handed to the transport plus writes still in our queue. */
  get bytesWritten(): number {
    let bytes = this.#dispatchedBytes + this.#pendingBytes;
    const buffered = this._writableState.getBuffer();
    for (let i = 0; i < buffered.length; i++) {
      const write = buffered[i];
      if (write !== undefined) bytes += socketChunkByteLength(write.chunk, write.encoding);
    }
    return bytes;
  }

  #capture(): void {
    if (this._handle === null) return;
    this.#localAddress = makeAddress(
      nts_net_address_text(this._handle, false),
      nts_net_address_numbers(this._handle, false),
    );
    this.#remoteAddress = makeAddress(
      nts_net_address_text(this._handle, true),
      nts_net_address_numbers(this._handle, true),
    );
  }

  connect(...args: ConnectArguments): this {
    const { options, callback } = normaliseConnectArguments(args);

    if (this.destroyed) {
      this._undestroy();
      this._handle = null;
      this.#readingStarted = false;
      this.#localAddress = undefined;
      this.#remoteAddress = undefined;
      this.bytesRead = 0;
      this.#dispatchedBytes = 0;
      this.#pendingBytes = 0;
      this.#readEndedByPeer = false;
      this.#resetOnDestroy = false;
      this.#multipleConnect = null;
      this.#attemptedAddresses = undefined;
      this.#attemptedAddressCount = 0;
      this.#pendingReadBytes = undefined;
      this.#pendingReadOffset = 0;
      this.#pendingReadEnd = false;
      this.#destroyOnIdleData = false;
      this.#boundSource = false;
      this.#boundPipe = false;
      this.#boundPath = undefined;
    }

    if (callback !== undefined) this.once("connect", callback);
    if (options.allowHalfOpen !== undefined) {
      this.allowHalfOpen = options.allowHalfOpen;
    }

    this.connecting = true;

    if (options.port === undefined && options.path === undefined) {
      throw new ERR_MISSING_ARGS(["options", "port", "path"]);
    }

    const host = options.host ?? "localhost";
    const path = options.path ?? "";
    const isPipe = path !== "";
    const port = isPipe ? 0 : validateSocketPort(options.port);
    validateLookupHints(options.hints);
    if (options.lookup !== undefined) {
      validateFunction(options.lookup, "options.lookup");
    }
    if (
      this.#boundSource &&
      (options.localAddress !== undefined || options.localPort !== undefined)
    ) {
      throw new ERR_INVALID_ARG_VALUE(
        "options",
        options,
        "localAddress and localPort cannot be used with an adopted bound socket",
      );
    }
    if (options.signal !== undefined) this.#watchAbort(options.signal);
    if (options.onread !== undefined) this.#setOnRead(options.onread);
    const providerIsPipe = this.#boundSource ? this.#boundPipe : isPipe;
    this.#resetAsyncIdentity(providerIsPipe ? "PIPEWRAP" : "TCPWRAP");
    if (!providerIsPipe && isIP(host) === 0) {
      this.#lookupAndConnect(host, port, path, options);
    } else {
      this.#startConnect(host, port, path, options, providerIsPipe);
    }
    return this;
  }

  #lookupAndConnect(host: string, port: number, path: string, options: ConnectOptions): void {
    const useAutoSelectFamily =
      !this.#boundSource &&
      (options.autoSelectFamily ?? autoSelectFamilyDefault) &&
      options.family !== 4 &&
      options.family !== 6 &&
      options.localAddress === undefined;
    const request = new SocketRequest("GETADDRINFOREQWRAP", this.#asyncId);
    const complete = (
      error: Error | null,
      address: string | LookupAddress[] | undefined,
      family?: number,
    ): void =>
      request.complete(() => {
        if (!this.connecting) return;
        if (error !== null) {
          this.emit("lookup", error, undefined, undefined, host);
          nextTick(() => this.destroy(error));
          return;
        }
        if (Array.isArray(address)) {
          for (let index = 0; index < address.length; index++) {
            const current = address[index];
            if (current !== undefined) {
              this.emit("lookup", null, current.address, current.family, host);
            }
          }
          const ordered = orderLookupAddresses(address, options.blockList);
          if (ordered instanceof Error) {
            nextTick(() => this.destroy(ordered));
          } else if (ordered.length === 1) {
            const only = ordered[0];
            if (only !== undefined) this.#startConnect(only.address, port, path, options, false);
          } else {
            this.#startMultipleConnects(ordered, port, options);
          }
          return;
        }
        this.emit("lookup", null, address, family, host);
        if (typeof address !== "string" || isIP(address) === 0) {
          nextTick(() => this.destroy(new ERR_INVALID_IP_ADDRESS(address)));
          return;
        }
        if (family !== 4 && family !== 6) {
          const invalidFamily = new ERR_INVALID_ADDRESS_FAMILY(family, host, port);
          nextTick(() => this.destroy(invalidFamily));
          return;
        }
        this.#startConnect(address, port, path, options, false);
      });

    const customLookup = options.lookup;
    if (customLookup !== undefined) {
      const lookupOptions: LookupOptions = {
        family: options.family ?? 0,
        hints: options.hints ?? 0,
      };
      if (useAutoSelectFamily) lookupOptions.all = true;
      customLookup(host, lookupOptions, complete);
      return;
    }

    nts_net_lookup(host, options.family ?? 0, (errno, address, family) => {
      if (errno < 0) {
        complete(dnsException(errno, "getaddrinfo", host), undefined);
      } else {
        complete(null, address, family);
      }
    });
  }

  #startMultipleConnects(addresses: LookupAddress[], port: number, options: ConnectOptions): void {
    const context = new MultipleConnectContext(addresses, port, options);
    this.#multipleConnect = context;
    this.#attemptedAddresses = new Array<string>(addresses.length);
    this.#attemptedAddressCount = 0;
    this.#startNextConnectAttempt(context);
  }

  #startNextConnectAttempt(context: MultipleConnectContext): void {
    if (!this.connecting || this.#multipleConnect !== context) return;
    if (context.timer !== null) {
      clearTimeout(context.timer);
      context.timer = null;
    }
    const index = context.nextIndex++;
    const destination = context.addresses[index];
    if (destination === undefined) {
      if (context.pending === 0) this.#failMultipleConnects(context);
      return;
    }

    if (this.#attemptedAddresses !== undefined) {
      this.#attemptedAddresses[this.#attemptedAddressCount++] =
        `${destination.address}:${context.port}`;
    }
    this.emit("connectionAttempt", destination.address, context.port, destination.family);

    const request = new SocketRequest("TCPCONNECTWRAP", this.#asyncId);
    let handle = -1;
    const onConnected = (errno: number): void =>
      request.complete(() => {
        context.pending--;
        if (this.#multipleConnect !== context || !this.connecting) {
          if (handle >= 0) nts_net_close(handle, ignoreNativeClose);
          return;
        }
        if (errno >= 0) {
          this.#winMultipleConnect(context, handle);
          return;
        }

        if (handle >= 0) nts_net_close(handle, ignoreNativeClose);
        const error = exceptionWithHostPort(errno, "connect", destination.address, context.port);
        this.emit(
          "connectionAttemptFailed",
          destination.address,
          context.port,
          destination.family,
          error,
        );
        context.errors[context.errorCount++] = error;
        if (context.nextIndex < context.addresses.length) {
          this.#startNextConnectAttempt(context);
        } else if (context.pending === 0) {
          this.#failMultipleConnects(context);
        }
      });

    context.pending++;
    handle = nts_net_connect(
      destination.address,
      context.port,
      "",
      context.options.localAddress ?? "",
      context.options.localPort ?? 0,
      onConnected,
    );
    if (handle < 0) {
      nextTick(onConnected, handle);
      return;
    }
    context.handles[index] = handle;
    this._handle = handle;

    if (context.nextIndex < context.addresses.length) {
      const socket: Socket = this;
      const timer = setTimeout(
        Socket.#startTimedConnectAttempt,
        context.options.autoSelectFamilyAttemptTimeout ?? autoSelectFamilyAttemptTimeoutDefault,
        socket,
        context,
      );
      context.timer = timer;
      timer.unref();
    }
  }

  static #startTimedConnectAttempt(socket: Socket, context: MultipleConnectContext): void {
    context.timer = null;
    const timed = context.addresses[context.nextIndex - 1];
    if (timed !== undefined) {
      socket.emit("connectionAttemptTimeout", timed.address, context.port, timed.family);
    }
    socket.#startNextConnectAttempt(context);
  }

  #winMultipleConnect(context: MultipleConnectContext, winner: number): void {
    if (context.timer !== null) clearTimeout(context.timer);
    context.timer = null;
    this.#multipleConnect = null;
    for (let index = 0; index < context.nextIndex; index++) {
      const handle = context.handles[index];
      if (handle !== undefined && handle !== winner) {
        nts_net_close(handle, ignoreNativeClose);
      }
    }
    this._handle = winner;
    this.#completeConnection(context.options);
  }

  #failMultipleConnects(context: MultipleConnectContext): void {
    if (context.timer !== null) clearTimeout(context.timer);
    context.timer = null;
    this.#multipleConnect = null;
    this._handle = null;
    this.connecting = false;
    const errors = context.errors.slice(0, context.errorCount);
    this.destroy(errors.length === 1 ? errors[0] : new AggregateError(errors));
  }

  #startConnect(
    host: string,
    port: number,
    path: string,
    options: ConnectOptions,
    isPipe: boolean,
  ): void {
    const request = new SocketRequest(isPipe ? "PIPECONNECTWRAP" : "TCPCONNECTWRAP", this.#asyncId);

    if (!isPipe && options.blockList?.check(host, isIPv6(host) ? "ipv6" : "ipv4")) {
      nextTick(() => this.destroy(new ERR_IP_BLOCKED(host)));
      return;
    }

    const onConnected = (errno: number): void =>
      request.complete(() => {
        if (errno < 0) {
          this.connecting = false;
          this.destroy(
            exceptionWithHostPort(
              errno,
              "connect",
              path || host,
              path.length === 0 ? port : undefined,
            ),
          );
          return;
        }
        this.#completeConnection(options);
      });
    let handle: number;
    if (this.#boundSource && this._handle !== null) {
      handle = this._handle;
      const errno = nts_net_connect_bound(handle, host, port, path, onConnected);
      this.#boundSource = false;
      // bind(2) and connect(2) have both run by the time the native call
      // returns. Even though completion remains asynchronous, the concrete
      // source endpoint is already observable in this turn.
      this.#capture();
      if (errno < 0) nextTick(onConnected, errno);
      return;
    }

    handle = nts_net_connect(
      host,
      port,
      path,
      options.localAddress ?? "",
      options.localPort ?? 0,
      onConnected,
    );

    if (handle < 0) nextTick(onConnected, handle);
    else this._handle = handle;
  }

  #completeConnection(options: ConnectOptions): void {
    this.connecting = false;
    this.pending = false;
    this.#capture();
    if (options.noDelay) this.setNoDelay(true);
    if (options.keepAlive) {
      this.setKeepAlive(true, options.keepAliveInitialDelay ?? 0);
    }
    if (this.#typeOfService !== undefined) {
      this.#setTypeOfServiceOnHandle(this.#typeOfService);
    }
    this.emit("connect");
    this.emit("ready");
    // The same first read as above, for the same reason.
    if (!this.isPaused()) this.read(0);
  }

  #maybeStartReading(): void {
    if (this.#readingStarted || this._handle === null) return;
    this.#readingStarted = true;

    nts_net_read_start(
      this._handle,
      (bytes: number[]) =>
        this.#inScope(() => {
          this.#refreshTimeout();
          if (this.#destroyOnIdleData && bytes.length > 0) {
            this.destroy();
            return;
          }
          if (this.#onReadCallback !== undefined) {
            this.#deliverOnReadBytes(bytes, 0);
            return;
          }
          this.bytesRead += bytes.length;
          // `push` returning false is the socket's backpressure: stop reading
          // from the kernel until the consumer catches up, or the buffer grows
          // without bound.
          if (!this.push(Buffer.from(bytes)) && this._handle !== null) {
            nts_net_read_stop(this._handle);
            this.#readingStarted = false;
          }
        }),
      () =>
        this.#inScope(() => {
          // `FIN` from the other end: no more data is coming, but this end may
          // still write.
          //
          // The `read(0)` is not redundant. `push(null)` records the end; it
          // does not *deliver* it, and a readable with no consumer never asks
          // again on its own -- so `end` and `close` would never be emitted on
          // a socket nobody reads, which is most of the sockets in a server
          // that only writes. Node does the same two calls in the same order.
          if (this.#pendingReadBytes !== undefined) this.#pendingReadEnd = true;
          else this.#finishReadSide();
        }),
      (errno: number) =>
        this.#inScope(() => {
          this.destroy(exceptionWithHostPort(errno, "read"));
        }),
    );
  }

  #setOnRead(options: OnReadOptions): void {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new ERR_INVALID_ARG_TYPE("options.onread", "Object", options);
    }
    if (!("buffer" in options)) {
      throw new ERR_INVALID_ARG_TYPE(
        "options.onread.buffer",
        ["Buffer", "Uint8Array", "Function"],
        undefined,
      );
    }
    const source = options.buffer;
    if (typeof source === "function") {
      this.#onReadBufferFactory = source;
      this.#onReadBuffer = this.#nextOnReadBuffer();
    } else if (source instanceof Uint8Array) {
      if (source.byteLength === 0) {
        throw new ERR_INVALID_ARG_VALUE("options.onread.buffer", source, "must not be empty");
      }
      this.#onReadBufferFactory = undefined;
      this.#onReadBuffer = source;
    } else {
      throw new ERR_INVALID_ARG_TYPE(
        "options.onread.buffer",
        ["Buffer", "Uint8Array", "Function"],
        source,
      );
    }
    if (!("callback" in options)) {
      throw new ERR_INVALID_ARG_TYPE("options.onread.callback", "Function", undefined);
    }
    validateFunction(options.callback, "options.onread.callback");
    this.#onReadCallback = options.callback;
  }

  #nextOnReadBuffer(): Uint8Array {
    const generated = this.#onReadBufferFactory?.();
    if (!(generated instanceof Uint8Array)) {
      throw new ERR_INVALID_ARG_TYPE(
        "options.onread.buffer()",
        ["Buffer", "Uint8Array"],
        generated,
      );
    }
    if (generated.byteLength === 0) {
      throw new ERR_INVALID_ARG_VALUE("options.onread.buffer()", generated, "must not be empty");
    }
    return generated;
  }

  #deliverOnReadBytes(bytes: number[], start: number): void {
    if (this.#onReadCallback === undefined) return;
    let offset = start;
    while (offset < bytes.length) {
      const buffer = this.#onReadBuffer;
      if (buffer === undefined) return;
      const count = Math.min(buffer.byteLength, bytes.length - offset);
      for (let index = 0; index < count; index++) {
        const byte = bytes[offset + index];
        if (byte !== undefined) buffer[index] = byte;
      }
      offset += count;
      this.bytesRead += count;
      const keepReading = this.#invokeOnReadCallback(count, buffer);
      if (this.#onReadBufferFactory !== undefined) {
        this.#onReadBuffer = this.#nextOnReadBuffer();
      }
      if (!keepReading) this.pause();
      if (this.isPaused()) {
        if (offset < bytes.length) {
          this.#pendingReadBytes = bytes;
          this.#pendingReadOffset = offset;
        } else {
          this.#pendingReadBytes = undefined;
          this.#pendingReadOffset = 0;
        }
        return;
      }
    }
    this.#pendingReadBytes = undefined;
    this.#pendingReadOffset = 0;
    if (this.#pendingReadEnd) {
      this.#pendingReadEnd = false;
      this.#finishReadSide();
    }
  }

  #invokeOnReadCallback(bytesRead: number, buffer: Uint8Array): boolean {
    if (this.#onReadCallback === undefined) return false;
    return this.#onReadCallback(bytesRead, buffer) !== false;
  }

  #finishReadSide(): void {
    this.push(null);
    this.read(0);
  }

  override _read(): void {
    // Deferred rather than dropped. Returning here would leave the readable's
    // `reading` flag set with nothing on the way to clear it, so the *next*
    // `read` would decline as redundant and the socket would never start --
    // which is what happens to any consumer that attaches a `data` listener
    // before the connection is established, as an HTTP client does.
    if (this.connecting || this._handle === null) {
      this.once("connect", () => this._read());
      return;
    }
    this.#maybeStartReading();
  }

  override pause(): this {
    super.pause();
    if (this._handle !== null && this.#readingStarted) {
      nts_net_read_stop(this._handle);
      this.#readingStarted = false;
    }
    return this;
  }

  override resume(): this {
    super.resume();
    const pending = this.#pendingReadBytes;
    if (pending !== undefined) {
      this.#deliverOnReadBytes(pending, this.#pendingReadOffset);
    }
    if (!this.isPaused()) {
      if (this.#pendingReadEnd && this.#pendingReadBytes === undefined) {
        this.#pendingReadEnd = false;
        this.#finishReadSide();
      } else {
        this.#maybeStartReading();
      }
    }
    return this;
  }

  override _write(chunk: unknown, encoding: string, callback: (error?: unknown) => void): void {
    let buffer: Buffer;
    if (typeof chunk === "string") {
      buffer = Buffer.from(chunk, encoding);
    } else if (chunk instanceof Uint8Array) {
      buffer = Buffer.from(chunk);
    } else {
      callback(new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "Uint8Array"], chunk));
      return;
    }

    if (this._handle === null) {
      if (this.connecting) {
        this.#pendingBytes = buffer.length;
        const cleanup = (): void => {
          this.removeListener("connect", onConnect);
          this.removeListener("close", onClose);
        };
        const onConnect = (): void => {
          cleanup();
          this.#pendingBytes = 0;
          this._write(buffer, "buffer", callback);
        };
        const onClose = (): void => {
          cleanup();
          this.#pendingBytes = 0;
          callback(new ERR_SOCKET_CLOSED_BEFORE_CONNECTION());
        };
        this.once("connect", onConnect);
        this.once("close", onClose);
        return;
      }
      callback(new ERR_SOCKET_CLOSED());
      return;
    }
    this.#refreshTimeout();
    // A native handle counts a write when it accepts it, not when its
    // completion callback runs. Failures remain asynchronous.
    this.#dispatchedBytes += buffer.length;

    let request: SocketRequest | undefined;
    const onWritten = (errno: number): void => {
      const finish = (): void => {
        if (errno < 0) {
          callback(uvException(errno, "write"));
          return;
        }
        callback();
      };
      if (request === undefined) finish();
      else request.complete(finish);
    };
    const queued = nts_net_write(this._handle, Array.from(buffer), onWritten);
    if (queued > 0) {
      request = new SocketRequest("WRITEWRAP", this.#asyncId);
    }
  }

  override _writeAfterEndError(): Error {
    return this.#readEndedByPeer ? new SocketPeerEndedError() : new ERR_STREAM_WRITE_AFTER_END();
  }

  override _final(callback: (error?: unknown) => void): void {
    if (this._handle === null) {
      if (this.connecting) {
        const cleanup = (): void => {
          this.removeListener("connect", onConnect);
          this.removeListener("error", onError);
        };
        const onConnect = (): void => {
          cleanup();
          this._final(callback);
        };
        const onError = (error: unknown): void => {
          cleanup();
          callback(error);
        };
        this.once("connect", onConnect);
        this.once("error", onError);
        return;
      }
      callback();
      return;
    }
    // A shutdown rather than a close: the read side stays open, which is what
    // makes a half-open connection possible at all.
    const request = new SocketRequest("SHUTDOWNWRAP", this.#asyncId);
    nts_net_shutdown(this._handle, (errno) =>
      request.complete(() => {
        callback(errno < 0 ? uvException(errno, "shutdown") : undefined);
      }),
    );
  }

  override _destroy(error: unknown, callback: (error?: unknown) => void): void {
    this.#clearTimeout();
    this.#clearAbort();
    this.connecting = false;

    const multiple = this.#multipleConnect;
    if (multiple !== null) {
      this.#multipleConnect = null;
      if (multiple.timer !== null) clearTimeout(multiple.timer);
      multiple.timer = null;
      for (let index = 0; index < multiple.nextIndex; index++) {
        const attempt = multiple.handles[index];
        if (attempt !== undefined && attempt !== this._handle) {
          nts_net_close(attempt, ignoreNativeClose);
        }
      }
    }

    // Node removes an accepted connection from its server when socket
    // teardown starts. The native handle's close callback is a later
    // TCPWRAP/PIPEWRAP activity. Keeping those two moments separate makes a
    // server's close callback run before the handle's final async callback,
    // and also means `getConnections()` never counts a socket already being
    // destroyed.
    const notifyServer = acceptedSocketClosing.get(this);
    if (notifyServer !== undefined) {
      acceptedSocketClosing.delete(this);
      notifyServer();
    }

    const finish = (finalError: unknown = error): void => {
      callback(finalError);
      // `close` carries whether the socket is being closed because of an
      // error, which a listener needs in order to know whether to reconnect.
      // The stream destroy callback schedules `error` first. Queueing our
      // socket-specific close after it preserves Node's error-before-close
      // guarantee and lets callers attach listeners after `destroy()`.
      nextTick(emitSocketClose, this, Boolean(finalError));
      // The native close callback is the handle's final callback. Its `after`
      // is emitted by `#inScope`; destroy is queued here and therefore cannot
      // overtake it.
      emitDestroy(this.#asyncId);
      this.#asyncId = 0;
      this.#triggerAsyncId = 0;
      this.#contextFrame = undefined;
    };

    if (this._handle === null) {
      finish();
      return;
    }
    const handle = this._handle;
    this._handle = null;
    if (this.#boundSource) {
      this.#boundSource = false;
      const errno = nts_net_bound_close(handle);
      finish(errno < 0 ? uvException(errno, "close") : error);
    } else if (this.#resetOnDestroy) {
      this.#resetOnDestroy = false;
      nts_net_reset(handle, (errno) =>
        this.#inScope(() => {
          if (errno < 0) finish(exceptionWithHostPort(errno, "reset"));
          else finish();
        }),
      );
    } else {
      nts_net_close(handle, () => this.#inScope(finish));
    }
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

  setTypeOfService(value: number): this {
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new ERR_INVALID_ARG_TYPE("tos", "number", value);
    }
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new ERR_OUT_OF_RANGE("tos", ">= 0 and <= 255", value);
    }
    this.#typeOfService = value;
    if (this._handle !== null) this.#setTypeOfServiceOnHandle(value);
    return this;
  }

  getTypeOfService(): number {
    if (this._handle === null) return this.#typeOfService ?? 0;
    const result = nts_net_get_tos(this._handle);
    if (result < 0) throw exceptionWithHostPort(result, "getTypeOfService");
    return result;
  }

  #setTypeOfServiceOnHandle(value: number): void {
    if (this._handle === null) return;
    const result = nts_net_set_tos(this._handle, value);
    if (result < 0) throw exceptionWithHostPort(result, "setTypeOfService");
  }

  /**
   * Emit `timeout` after `msecs` of no activity.
   *
   * It does *not* close the socket. Node emits and leaves the decision to the
   * program, because "nothing has happened for a while" means different things
   * to a request and to an idle keep-alive connection.
   */
  setTimeout(msecs: number, callback?: () => void): this {
    const duration = getTimerDuration(msecs, "msecs");
    this.#clearTimeout();
    this.timeout = duration;

    if (duration > 0) {
      this.#timer = setTimeout(() => {
        this.emit("timeout");
      }, duration);
      this.#timer.unref();
      if (callback) this.once("timeout", callback);
    } else if (callback !== undefined) {
      this.removeListener("timeout", callback);
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

  #watchAbort(signal: AbortSignalLike): void {
    this.#clearAbort();
    const onAbort = (): void => {
      this.destroy(new AbortError(undefined, { cause: signal.reason }));
    };
    if (signal.aborted) {
      nextTick(onAbort);
      return;
    }
    this.#abortCleanup = addTrackedAbortListener(signal, onAbort);
  }

  #clearAbort(): void {
    this.#abortCleanup?.();
    this.#abortCleanup = undefined;
  }

  static #onReadableEnd(this: Socket): void {
    this.#readEndedByPeer = true;
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

  /** Legacy spelling retained as an ordinary statically dispatched getter. */
  get _connecting(): boolean {
    return this.connecting;
  }

  /** Close a TCP connection immediately by sending RST to its peer. */
  resetAndDestroy(): this {
    if (this._handle === null) {
      this.destroy(new ERR_SOCKET_CLOSED());
      return this;
    }
    if (this.#provider !== "TCPWRAP") throw new ERR_INVALID_HANDLE_TYPE();
    if (this.connecting) this.once("connect", Socket.#resetConnectedSocket);
    else this.#reset();
    return this;
  }

  #reset(): void {
    this.#resetOnDestroy = true;
    this.destroy();
  }

  static #resetConnectedSocket(this: Socket): void {
    this.#reset();
  }

  /** End the socket once everything queued has been written. */
  destroySoon(): void {
    if (this.writable) this.end();
    if (this.writableFinished) this.destroy();
    else this.once("finish", () => this.destroy());
  }
}

function emitSocketClose(socket: Socket, hadError: boolean): void {
  socket.emit("close", hadError);
}

/** The socket-specific error for writing after a received FIN. */
class SocketPeerEndedError extends Error {
  readonly code = "EPIPE";

  constructor() {
    super("This socket has been ended by the other party");
    this.name = "Error";
  }
}

function socketChunkByteLength(chunk: unknown, encoding: string | undefined): number {
  if (typeof chunk === "string") return Buffer.byteLength(chunk, encoding);
  if (chunk instanceof Uint8Array) return chunk.byteLength;
  // Socket writable state is never in object mode, so `writeInternal` rejects
  // every other shape before it can enter this queue.
  return 0;
}

export interface ServerOptions {
  allowHalfOpen?: boolean | undefined;
  pauseOnConnect?: boolean | undefined;
  noDelay?: boolean | undefined;
  keepAlive?: boolean | undefined;
  keepAliveInitialDelay?: number | undefined;
  highWaterMark?: number | undefined;
  blockList?: BlockList | undefined;
}

export class Server extends EventEmitter {
  private static dispatchCapturedRejection(
    this: Server,
    error: unknown,
    event: EventName,
    ...args: unknown[]
  ): void {
    this.handleCapturedRejection(error, event, args);
  }

  override [captureRejectionSymbol] = Server.dispatchCapturedRejection;

  _handle: number | null = null;
  listening = false;
  maxConnections = Infinity;
  highWaterMark: number;

  #connections = 0;
  #options: ServerOptions;
  #handleClosed = true;
  #closeEmitted = false;

  #asyncId = 0;
  #triggerAsyncId = 0;
  #contextFrame: AsyncContextFrame | undefined;
  #keepProcessAlive = true;
  #abortCleanup: (() => void) | undefined;

  constructor(
    options?: ServerOptions | ((socket: Socket) => void),
    connectionListener?: (socket: Socket) => void,
  ) {
    super();
    if (typeof options === "function") {
      connectionListener = options;
      options = {};
    } else if (
      options !== undefined &&
      (options === null || typeof options !== "object" || Array.isArray(options))
    ) {
      throw new ERR_INVALID_ARG_TYPE("options", "Object", options);
    }
    this.#options = options ?? {};
    const configuredHighWaterMark = this.#options.highWaterMark;
    if (configuredHighWaterMark !== undefined) {
      validateNumber(configuredHighWaterMark, "options.highWaterMark");
    }
    this.highWaterMark =
      configuredHighWaterMark === undefined || configuredHighWaterMark < 0
        ? getDefaultHighWaterMark(false)
        : configuredHighWaterMark;
    if (connectionListener) this.on("connection", connectionListener);
  }

  /** Route rejected async listeners through the resource that owns the event. */
  protected handleCapturedRejection(
    error: unknown,
    event: EventName,
    args: readonly unknown[],
  ): void {
    if (event === "connection") {
      const socket = args[0];
      if (socket instanceof Socket) {
        socket.destroy(error);
        return;
      }
    }
    this.emit("error", error);
  }

  /** Build the transport object exposed for one accepted native handle. */
  protected createAcceptedSocket(options: SocketOptions): Socket {
    return new Socket(options);
  }

  /**
   * Run `fn` as this server's own asynchronous work.
   *
   * Accepting a connection is the server's work, not the connection's: the
   * socket does not exist yet when the callback starts. So a hook watching a
   * server sees its accepts, and a store set before `listen` is readable
   * inside them -- which is how an accepted connection inherits the context
   * the server was started in.
   */
  #inScope<R>(fn: () => R): R {
    const asyncId = this.#asyncId;
    const prior = AsyncContextFrame.exchange(this.#contextFrame);
    emitBefore(asyncId, this.#triggerAsyncId, this);
    try {
      return fn();
    } finally {
      emitAfter(asyncId);
      AsyncContextFrame.setCurrent(prior);
    }
  }

  #resetAsyncIdentity(provider: ServerProvider): void {
    if (this.#asyncId > 0) emitDestroy(this.#asyncId);
    this.#asyncId = newAsyncId();
    this.#triggerAsyncId = getDefaultTriggerAsyncId();
    this.#contextFrame = AsyncContextFrame.current();
    if (initHooksExist()) {
      emitInit(this.#asyncId, provider, this.#triggerAsyncId, this);
    }
  }

  #scheduleListening(): void {
    const prior = AsyncContextFrame.exchange(this.#contextFrame);
    try {
      defaultTriggerAsyncIdScope(this.#asyncId, nextTick, emitServerListening, this);
    } finally {
      AsyncContextFrame.setCurrent(prior);
    }
  }

  listen(...args: ListenArguments): this {
    const { options, callback } = normaliseListenArguments(args);
    if (callback) this.once("listening", callback);

    const boundSocket = options.boundSocket;
    const boundAddress = boundSocket?.address();
    const path = typeof boundAddress === "string" ? boundAddress : options.path;
    const host = typeof boundAddress === "object" ? boundAddress.address : (options.host ?? "::");
    const port =
      typeof boundAddress === "object"
        ? boundAddress.port
        : options.port === undefined
          ? 0
          : validateSocketPort(options.port);
    const isPipe = boundSocket?.isPipe ?? (path !== undefined && path !== "");
    const boundHandle = boundSocket === undefined ? -1 : consumeBoundSocket(boundSocket);
    this.#handleClosed = false;
    this.#closeEmitted = false;
    this.#resetAsyncIdentity(isPipe ? "PIPESERVERWRAP" : "TCPSERVERWRAP");

    if (options.signal?.aborted) {
      this.#handleClosed = true;
      nextTick(() => this.#maybeEmitClose());
      return this;
    }

    const handle = nts_net_listen(
      host,
      port,
      path ?? "",
      options.backlog ?? 511,
      options.ipv6Only ?? false,
      options.reusePort ?? false,
      options.readableAll ?? false,
      options.writableAll ?? false,
      options.fd ?? -1,
      boundHandle,
      () => this.#scheduleListening(),
      (connection: number) =>
        this.#inScope(() => {
          const socket = this.createAcceptedSocket({
            handle: connection,
            handleType: isPipe ? "pipe" : "tcp",
            allowHalfOpen: this.#options.allowHalfOpen,
            pauseOnCreate: this.#options.pauseOnConnect,
            noDelay: this.#options.noDelay,
            keepAlive: this.#options.keepAlive,
            keepAliveInitialDelay: this.#options.keepAliveInitialDelay,
            readableHighWaterMark: this.highWaterMark,
            writableHighWaterMark: this.highWaterMark,
          });
          socket.server = this;

          const remoteAddress = socket.remoteAddress;
          if (
            remoteAddress !== undefined &&
            this.#options.blockList?.check(
              remoteAddress,
              socket.remoteFamily === "IPv6" ? "ipv6" : "ipv4",
            )
          ) {
            socket.destroy();
            return;
          }

          // Over the limit: accepted and closed immediately, because refusing
          // to accept leaves the connection in the kernel's backlog where the
          // client sees a hang rather than a refusal.
          if (this.#connections >= this.maxConnections) {
            this.emit("drop", {
              localAddress: socket.localAddress,
              localPort: socket.localPort,
              localFamily: socket.localFamily,
              remoteAddress: socket.remoteAddress,
              remotePort: socket.remotePort,
              remoteFamily: socket.remoteFamily,
            });
            socket.destroy();
            return;
          }

          this.#connections++;
          acceptedSocketClosing.set(socket, () => {
            this.#connections--;
            this.#maybeEmitClose();
          });

          if (!this.#options.pauseOnConnect) socket.resume();
          this.emit("connection", socket);
        }),
      (errno: number) =>
        this.#inScope(() => {
          this.listening = false;
          this.emit("error", listenError(errno, host, port, path));
        }),
    );

    if (handle < 0) {
      nextTick(() => this.emit("error", listenError(handle, host, port, path)));
      return this;
    }

    this._handle = handle;
    if (!this.#keepProcessAlive) nts_net_server_ref(handle, false);
    if (options.signal !== undefined) this.#watchAbort(options.signal);
    return this;
  }

  address(): AddressInfo | Record<string, never> | string {
    if (this._handle === null) return {};
    const address = nts_net_server_address_text(this._handle);
    const numbers = nts_net_server_address_numbers(this._handle);
    // A unix socket has no family/port columns; its address is its path.
    if (numbers.length === 0) return address.length === 0 ? {} : address;
    return makeAddress(address, numbers) ?? {};
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
    if (typeof callback === "function") {
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
        this.#handleClosed = true;
        emitDestroy(this.#asyncId);
        this.#asyncId = 0;
        this.#triggerAsyncId = 0;
        this.#contextFrame = undefined;
        this.#maybeEmitClose();
      });
    }
    return this;
  }

  #maybeEmitClose(): void {
    if (!this.#closeEmitted && !this.listening && this.#handleClosed && this.#connections === 0) {
      this.#closeEmitted = true;
      this.#clearAbort();
      this.emit("close");
    }
  }

  #watchAbort(signal: AbortSignalLike): void {
    this.#clearAbort();
    const onAbort = (): void => {
      this.close();
    };
    if (signal.aborted) {
      nextTick(onAbort);
      return;
    }
    this.#abortCleanup = addTrackedAbortListener(signal, onAbort);
  }

  #clearAbort(): void {
    this.#abortCleanup?.();
    this.#abortCleanup = undefined;
  }

  ref(): this {
    this.#keepProcessAlive = true;
    if (this._handle !== null) nts_net_server_ref(this._handle, true);
    return this;
  }

  unref(): this {
    this.#keepProcessAlive = false;
    if (this._handle !== null) nts_net_server_ref(this._handle, false);
    return this;
  }

  /** Overridden by `http.Server`, which knows which connections are idle. */
  closeIdleConnections(): void {}
}

function emitServerListening(server: Server): void {
  if (server._handle === null) return;
  server.listening = true;
  server.emit("listening");
}

/**
 * A failed bind, carrying where it was trying to bind.
 *
 * The address and port are on the error because that is the only useful thing
 * to say: "EADDRINUSE" alone does not tell a program which of its several
 * listeners collided.
 */
function listenError(errno: number, host: string, port: number, path?: string): Error {
  return path === undefined || path === ""
    ? exceptionWithHostPort(errno, "listen", host, port)
    : exceptionWithHostPortDescription(errno, "listen", path);
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
function normaliseConnectArguments(args: readonly unknown[]): {
  options: ConnectOptions;
  callback: (() => void) | undefined;
} {
  let options: ConnectOptions = {};
  let callback: (() => void) | undefined;

  const first = args[0];
  if (typeof first === "object" && first !== null) {
    options = readConnectOptions(first);
  } else if (typeof first === "string" && isIP(first) === 0 && Number.isNaN(Number(first))) {
    // A string that is neither an address nor a number is a path.
    options = { path: first };
  } else {
    if (first !== undefined) {
      if (typeof first !== "number" && typeof first !== "string") {
        throw new ERR_INVALID_ARG_TYPE("options", ["Object", "number", "string"], first);
      }
      options = { port: first };
    }
    if (typeof args[1] === "string") options.host = args[1];
  }

  const last = args[args.length - 1];
  if (isConnectionCallback(last)) callback = last;

  return { options, callback };
}

function isConnectionCallback(value: unknown): value is () => void {
  return typeof value === "function";
}

/** Narrow the untyped JavaScript options object exactly once. */
function readConnectOptions(input: object): ConnectOptions {
  const options: ConnectOptions = {};

  if ("objectMode" in input) {
    throw new ERR_INVALID_ARG_VALUE("options.objectMode", input.objectMode, "is not supported");
  }
  if ("readableObjectMode" in input) {
    throw new ERR_INVALID_ARG_VALUE(
      "options.readableObjectMode",
      input.readableObjectMode,
      "is not supported",
    );
  }
  if ("writableObjectMode" in input) {
    throw new ERR_INVALID_ARG_VALUE(
      "options.writableObjectMode",
      input.writableObjectMode,
      "is not supported",
    );
  }

  if ("port" in input && input.port !== undefined) {
    if (typeof input.port !== "number" && typeof input.port !== "string") {
      throw new ERR_INVALID_ARG_TYPE("options.port", ["number", "string"], input.port);
    }
    options.port = input.port;
  }

  if ("path" in input && input.path !== undefined && input.path !== null) {
    validateString(input.path, "options.path");
    options.path = input.path;
  }

  if ("host" in input && input.host !== undefined) {
    validateString(input.host, "options.host");
    if (input.host.includes("\0")) {
      throw new ERR_INVALID_ARG_VALUE(
        "options.host",
        input.host,
        "must be a string without null bytes",
      );
    }
    options.host = input.host;
  }

  if ("localAddress" in input && input.localAddress !== undefined) {
    validateString(input.localAddress, "options.localAddress");
    if (input.localAddress.length > 0 && isIP(input.localAddress) === 0) {
      throw new ERR_INVALID_IP_ADDRESS(input.localAddress);
    }
    options.localAddress = input.localAddress;
  }

  if ("localPort" in input && input.localPort !== undefined) {
    validateNumber(input.localPort, "options.localPort");
    options.localPort = validateSocketPort(input.localPort);
  }

  if ("family" in input && input.family !== undefined) {
    if (input.family === "IPv4") options.family = 4;
    else if (input.family === "IPv6") options.family = 6;
    else {
      validateNumber(input.family, "options.family");
      if (input.family !== 0 && input.family !== 4 && input.family !== 6) {
        throw new ERR_INVALID_ARG_VALUE("options.family", input.family, "must be one of: 0, 4, 6");
      }
      options.family = input.family;
    }
  }
  if ("hints" in input && input.hints !== undefined) {
    validateNumber(input.hints, "options.hints");
    options.hints = input.hints;
  }
  if ("lookup" in input && input.lookup !== undefined) {
    validateFunction(input.lookup, "options.lookup");
    options.lookup = input.lookup;
  }
  if ("timeout" in input && input.timeout !== undefined) {
    validateNumber(input.timeout, "options.timeout");
    options.timeout = input.timeout;
  }
  if ("signal" in input && input.signal !== undefined) {
    if (!isAbortSignalLike(input.signal)) {
      throw new ERR_INVALID_ARG_TYPE("options.signal", "AbortSignal", input.signal);
    }
    options.signal = input.signal;
  }
  if ("allowHalfOpen" in input && input.allowHalfOpen !== undefined) {
    options.allowHalfOpen = Boolean(input.allowHalfOpen);
  }
  if ("highWaterMark" in input && input.highWaterMark !== undefined) {
    const highWaterMark = input.highWaterMark;
    if (highWaterMark !== null && typeof highWaterMark !== "number") {
      throw new ERR_INVALID_ARG_VALUE("options.highWaterMark", highWaterMark);
    }
    options.highWaterMark = highWaterMark;
  }
  if ("readableHighWaterMark" in input && input.readableHighWaterMark !== undefined) {
    const highWaterMark = input.readableHighWaterMark;
    if (highWaterMark !== null && typeof highWaterMark !== "number") {
      throw new ERR_INVALID_ARG_VALUE("options.readableHighWaterMark", highWaterMark);
    }
    options.readableHighWaterMark = highWaterMark;
  }
  if ("writableHighWaterMark" in input && input.writableHighWaterMark !== undefined) {
    const highWaterMark = input.writableHighWaterMark;
    if (highWaterMark !== null && typeof highWaterMark !== "number") {
      throw new ERR_INVALID_ARG_VALUE("options.writableHighWaterMark", highWaterMark);
    }
    options.writableHighWaterMark = highWaterMark;
  }
  if ("noDelay" in input && input.noDelay !== undefined) {
    options.noDelay = Boolean(input.noDelay);
  }
  if ("keepAlive" in input && input.keepAlive !== undefined) {
    options.keepAlive = Boolean(input.keepAlive);
  }
  if ("keepAliveInitialDelay" in input && input.keepAliveInitialDelay !== undefined) {
    validateNumber(input.keepAliveInitialDelay, "options.keepAliveInitialDelay");
    options.keepAliveInitialDelay = input.keepAliveInitialDelay;
  }
  if ("blockList" in input && input.blockList !== undefined) {
    if (!BlockList.isBlockList(input.blockList)) {
      throw new ERR_INVALID_ARG_TYPE("options.blockList", "net.BlockList", input.blockList);
    }
    options.blockList = input.blockList;
  }
  if ("autoSelectFamily" in input && input.autoSelectFamily !== undefined) {
    validateBoolean(input.autoSelectFamily, "options.autoSelectFamily");
    options.autoSelectFamily = input.autoSelectFamily;
  }
  if (
    "autoSelectFamilyAttemptTimeout" in input &&
    input.autoSelectFamilyAttemptTimeout !== undefined
  ) {
    validateInteger(
      input.autoSelectFamilyAttemptTimeout,
      "options.autoSelectFamilyAttemptTimeout",
      1,
      2_147_483_647,
    );
    options.autoSelectFamilyAttemptTimeout = Math.max(10, input.autoSelectFamilyAttemptTimeout);
  }
  if ("onread" in input && input.onread !== undefined) {
    if (!isOnReadOptions(input.onread)) {
      throw new ERR_INVALID_ARG_TYPE("options.onread", "Object", input.onread);
    }
    options.onread = input.onread;
  }

  return options;
}

interface ListenOptions {
  port?: number | string;
  host?: string;
  path?: string;
  backlog?: number;
  exclusive?: boolean;
  ipv6Only?: boolean;
  reusePort?: boolean;
  readableAll?: boolean;
  writableAll?: boolean;
  fd?: number;
  boundSocket?: BoundSocket;
  signal?: AbortSignalLike;
}

type ListenArguments =
  | [boundSocket: BoundSocket, backlog?: number, callback?: () => void]
  | [options: ListenOptions, callback?: () => void]
  | [port: number | string, host: string, backlog?: number, callback?: () => void]
  | [port: number | string, backlog: number, callback?: () => void]
  | [portOrPath: number | string, callback?: () => void]
  | [callback?: () => void];

function normaliseListenArguments(args: readonly unknown[]): {
  options: ListenOptions;
  callback: (() => void) | undefined;
} {
  let options: ListenOptions = {};
  let callback: (() => void) | undefined;

  const first = args[0];
  if (first instanceof BoundSocket) {
    options = { boundSocket: first };
    if (typeof args[1] === "number") options.backlog = args[1];
  } else if (typeof first === "object" && first !== null) {
    options = readListenOptions(first);
  } else if (typeof first === "string" && Number.isNaN(Number(first))) {
    options = { path: first };
  } else if (first === undefined || first === null || typeof first === "function") {
    options = { port: 0 };
  } else if (typeof first === "number" || typeof first === "string") {
    options = { port: first };
    if (typeof args[1] === "string") options.host = args[1];
    if (typeof args[1] === "number") options.backlog = args[1];
    if (typeof args[2] === "number") options.backlog = args[2];
  } else {
    throw new ERR_INVALID_ARG_VALUE("options", first);
  }

  const last = args[args.length - 1];
  if (isConnectionCallback(last)) callback = last;

  return { options, callback };
}

function readListenOptions(input: object): ListenOptions {
  const hasPort = "port" in input;
  const hasPath = "path" in input;
  const fd: unknown = "fd" in input ? input.fd : undefined;
  const hasValidFd = typeof fd === "number" && fd >= 0;
  const hasBoundSocket = "handle" in input && input.handle instanceof BoundSocket;
  if (!hasPort && !hasPath && !hasValidFd && !hasBoundSocket) {
    throw new ERR_INVALID_ARG_VALUE("options", input, 'must have the property "port" or "path"');
  }

  const options: ListenOptions = {};
  if ("handle" in input && input.handle instanceof BoundSocket) {
    options.boundSocket = input.handle;
  } else if (hasPort) {
    if (
      input.port !== undefined &&
      input.port !== null &&
      typeof input.port !== "number" &&
      typeof input.port !== "string"
    ) {
      throw new ERR_INVALID_ARG_VALUE("options", input);
    }
    options.port = input.port === null || input.port === undefined ? 0 : input.port;
  } else if (hasPath) {
    if (typeof input.path !== "string") {
      throw new ERR_INVALID_ARG_VALUE("options", input);
    }
    options.path = input.path;
  } else if (hasValidFd) {
    validateInteger(fd, "fd", 0, 2_147_483_647);
    options.fd = fd;
  }

  if ("host" in input && input.host !== undefined) {
    validateString(input.host, "options.host");
    options.host = input.host;
  }
  if ("backlog" in input && input.backlog !== undefined) {
    validateNumber(input.backlog, "options.backlog");
    options.backlog = input.backlog;
  }
  if ("exclusive" in input && input.exclusive !== undefined) {
    options.exclusive = Boolean(input.exclusive);
  }
  if ("ipv6Only" in input && input.ipv6Only !== undefined) {
    options.ipv6Only = Boolean(input.ipv6Only);
  }
  if ("reusePort" in input && input.reusePort !== undefined) {
    options.reusePort = Boolean(input.reusePort);
  }
  if ("readableAll" in input && input.readableAll !== undefined) {
    options.readableAll = Boolean(input.readableAll);
  }
  if ("writableAll" in input && input.writableAll !== undefined) {
    options.writableAll = Boolean(input.writableAll);
  }
  if ("signal" in input && input.signal !== undefined) {
    if (!isAbortSignalLike(input.signal)) {
      throw new ERR_INVALID_ARG_TYPE("options.signal", "AbortSignal", input.signal);
    }
    options.signal = input.signal;
  }
  return options;
}

function isAbortSignalLike(value: unknown): value is AbortSignalLike {
  return (
    value !== null &&
    typeof value === "object" &&
    "aborted" in value &&
    typeof value.aborted === "boolean" &&
    "reason" in value &&
    "addEventListener" in value &&
    typeof value.addEventListener === "function" &&
    "removeEventListener" in value &&
    typeof value.removeEventListener === "function"
  );
}

function isOnReadOptions(value: unknown): value is OnReadOptions {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (!("buffer" in value) || !("callback" in value)) return false;
  return (
    (value.buffer instanceof Uint8Array || typeof value.buffer === "function") &&
    typeof value.callback === "function"
  );
}

export function createServer(
  options?: ServerOptions | ((socket: Socket) => void),
  connectionListener?: (socket: Socket) => void,
): Server {
  return new Server(options, connectionListener);
}

export function connect(...args: ConnectArguments): Socket {
  const { options } = normaliseConnectArguments(args);
  const socket = new Socket(options);
  if (options.timeout) socket.setTimeout(options.timeout);
  return socket.connect(...args);
}

export const createConnection = connect;

export function getDefaultAutoSelectFamily(): boolean {
  return autoSelectFamilyDefault;
}

export function setDefaultAutoSelectFamily(value: boolean): void {
  validateBoolean(value, "value");
  autoSelectFamilyDefault = value;
}

export function getDefaultAutoSelectFamilyAttemptTimeout(): number {
  return autoSelectFamilyAttemptTimeoutDefault;
}

export function setDefaultAutoSelectFamilyAttemptTimeout(value: number): void {
  validateInteger(value, "value", 1, 2_147_483_647);
  autoSelectFamilyAttemptTimeoutDefault = Math.max(10, value);
}

export { Socket as Stream };

function ignoreNativeClose(): void {}

function orderLookupAddresses(
  input: LookupAddress[],
  blockList: BlockList | undefined,
): LookupAddress[] | Error {
  if (input.length === 0) return new ERR_INVALID_IP_ADDRESS(undefined);

  let firstFamily = 0;
  let ipv4Count = 0;
  let ipv6Count = 0;
  let firstBlockedAddress: string | undefined;
  for (let index = 0; index < input.length; index++) {
    const candidate = input[index];
    if (candidate === undefined) continue;
    const actualFamily = isIP(candidate.address);
    if (
      actualFamily === 0 ||
      (candidate.family !== 4 && candidate.family !== 6) ||
      !lookupAddressIsUnique(input, index)
    ) {
      continue;
    }
    const familyName = candidate.family === 6 ? "ipv6" : "ipv4";
    if (blockList?.check(candidate.address, familyName)) {
      firstBlockedAddress ??= candidate.address;
      continue;
    }
    if (firstFamily === 0) firstFamily = candidate.family;
    if (candidate.family === 4) ipv4Count++;
    else ipv6Count++;
  }

  if (ipv4Count + ipv6Count === 0) {
    if (firstBlockedAddress !== undefined) return new ERR_IP_BLOCKED(firstBlockedAddress);
    const first = input[0];
    if (first === undefined || typeof first.address !== "string" || isIP(first.address) === 0) {
      return new ERR_INVALID_IP_ADDRESS(first?.address);
    }
    return new ERR_INVALID_ADDRESS_FAMILY(first.family, "", 0);
  }

  const ipv4 = new Array<LookupAddress>(ipv4Count);
  const ipv6 = new Array<LookupAddress>(ipv6Count);
  let ipv4Index = 0;
  let ipv6Index = 0;
  for (let index = 0; index < input.length; index++) {
    const candidate = input[index];
    if (
      candidate === undefined ||
      isIP(candidate.address) === 0 ||
      (candidate.family !== 4 && candidate.family !== 6) ||
      !lookupAddressIsUnique(input, index) ||
      blockList?.check(candidate.address, candidate.family === 6 ? "ipv6" : "ipv4")
    ) {
      continue;
    }
    if (candidate.family === 4) ipv4[ipv4Index++] = candidate;
    else ipv6[ipv6Index++] = candidate;
  }

  const preferred = firstFamily === 6 ? ipv6 : ipv4;
  const alternate = firstFamily === 6 ? ipv4 : ipv6;
  const ordered = new Array<LookupAddress>(preferred.length + alternate.length);
  let output = 0;
  const rounds = Math.max(preferred.length, alternate.length);
  for (let index = 0; index < rounds; index++) {
    const first = preferred[index];
    if (first !== undefined) ordered[output++] = first;
    const second = alternate[index];
    if (second !== undefined) ordered[output++] = second;
  }
  return ordered;
}

function lookupAddressIsUnique(input: LookupAddress[], candidateIndex: number): boolean {
  const candidate = input[candidateIndex];
  if (candidate === undefined) return false;
  for (let index = 0; index < candidateIndex; index++) {
    const prior = input[index];
    if (
      prior !== undefined &&
      prior.family === candidate.family &&
      prior.address === candidate.address
    ) {
      return false;
    }
  }
  return true;
}
