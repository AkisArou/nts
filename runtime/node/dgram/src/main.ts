// `node:dgram`, from node v24.20.0 `lib/dgram.js`.
//
// UDP, which is a different shape from TCP rather than a simpler one. There is
// no connection, so there is nothing to accept and nothing to end; a socket is
// bound to a port and receives whatever arrives at it, from anyone. That is why
// `message` carries the sender's address as a second argument where `data` on a
// TCP socket carries nothing: on a connection the peer is a property of the
// socket, and here it is a property of each packet.
//
// The consequences run through the whole class. `send` takes an address every
// time, unless the socket has been `connect`ed -- which for a datagram socket
// means only "remember this address and refuse the others", not a handshake.
// A packet is delivered whole or not at all, so there is no stream, no
// backpressure and no `end`. And because binding is asynchronous while `send`
// is not, a `send` on an unbound socket binds it first and queues the packet,
// which is the one piece of buffering in the module.

import { EventEmitter } from "../../events/src/main.ts";
import { Buffer } from "../../buffer/src/main.ts";
import { AsyncContextFrame } from "../../internal/async-context.ts";
import {
  emitAfter,
  emitBefore,
  emitDestroy,
  emitInit,
  getDefaultTriggerAsyncId,
  initHooksExist,
  newAsyncId,
} from "../../internal/async-hooks.ts";
import { nextTick } from "../../internal/tick.ts";
import {
  ERR_BUFFER_OUT_OF_BOUNDS,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_IP_BLOCKED,
  ERR_MISSING_ARGS,
  ERR_SOCKET_ALREADY_BOUND,
  ERR_SOCKET_BAD_BUFFER_SIZE,
  ERR_SOCKET_BAD_PORT,
  ERR_SOCKET_BAD_TYPE,
  ERR_SOCKET_DGRAM_IS_CONNECTED,
  ERR_SOCKET_DGRAM_NOT_CONNECTED,
  ERR_SOCKET_DGRAM_NOT_RUNNING,
} from "../../internal/errors.ts";
import {
  dnsException,
  exceptionWithHostPort,
  socketBufferError,
} from "../../internal/uv.ts";
import {
  validateNumber,
  validateObject,
  validateString,
  validateUint32,
} from "../../internal/validators.ts";
import type { AbortSignalLike } from "../../internal/abort.ts";
import type { AddressInfo } from "../../net/src/main.ts";
import { isIP } from "../../net/src/address.ts";
import { BlockList, type IPFamily } from "../../net/src/block-list.ts";
import { channel } from "../../diagnostics_channel/src/main.ts";

export type { AddressInfo } from "../../net/src/main.ts";

/** Open a datagram socket. `type` is `udp4` or `udp6`. */
declare function nts_udp_new(
  type: string,
  reuseAddr: boolean,
  reusePort: boolean,
  ipv6Only: boolean,
): number;
/**
 * Bind, and call back when the socket actually has the port.
 *
 * A callback and not a return code, because binding is asynchronous: the name
 * may need resolving and the port is not assigned until the kernel says so.
 * Reporting success synchronously would let `address()` be called on a socket
 * that does not have one yet, which is exactly the failure it caused.
 */
declare function nts_udp_bind_sync(handle: number, address: string, port: number): number;
declare function nts_udp_close(handle: number): void;
/**
 * `[address, family, port]`, or `[errno]` when there is none.
 *
 * The errno rather than a flag, because the reason is the message: a socket
 * that was never bound fails this with `EBADF`, and node's tests match on that
 * word. A stand-in error said `EPERM`, which is a different and wrong story.
 */
declare function nts_udp_address(handle: number, remote: boolean): (string | number)[];
declare function nts_udp_send(
  handle: number,
  chunks: Uint8Array[],
  port: number,
  address: string,
  callback: (errno: number, sent: number) => void,
): number;
declare function nts_udp_recv_start(
  handle: number,
  onMessage: (bytes: Uint8Array, address: string, family: string, port: number) => void,
  onError: (errno: number) => void,
): number;
declare function nts_udp_recv_stop(handle: number): number;
declare function nts_udp_connect_sync(handle: number, address: string, port: number): number;
declare function nts_udp_lookup(
  hostname: string,
  family: number,
  callback: (errno: number, address: string, family: number) => void,
): void;
declare function nts_udp_disconnect(handle: number): number;
declare function nts_udp_set_broadcast(handle: number, on: boolean): number;
declare function nts_udp_set_ttl(handle: number, ttl: number): number;
declare function nts_udp_set_multicast_ttl(handle: number, ttl: number): number;
declare function nts_udp_set_multicast_loopback(handle: number, on: boolean): number;
declare function nts_udp_set_multicast_interface(handle: number, address: string): number;
declare function nts_udp_membership(
  handle: number,
  address: string,
  iface: string,
  join: boolean,
): number;
declare function nts_udp_source_membership(
  handle: number,
  source: string,
  group: string,
  iface: string,
  join: boolean,
): number;
declare function nts_udp_buffer_size(handle: number, size: number, receive: boolean): number;
declare function nts_udp_send_queue_size(handle: number): number;
declare function nts_udp_send_queue_count(handle: number): number;
declare function nts_udp_ref(handle: number, keepProcessAlive: boolean): void;

/**
 * Binding is asynchronous and `send` is not, so a socket can be asked to send
 * before it has a port. Node holds those calls in a queue on the socket and
 * runs them when `listening` arrives; the states exist to tell "not bound yet"
 * from "bound, so a second bind is an error".
 */
const UNBOUND = 0;
const BINDING = 1;
const BOUND = 2;

const DISCONNECTED = 0;
const CONNECTING = 1;
const CONNECTED = 2;

const udpSocketChannel = channel("udp.socket");

class QueuedOperation {
  readonly callback: () => void;
  next: QueuedOperation | null = null;

  constructor(callback: () => void) {
    this.callback = callback;
  }
}

export interface RemoteInfo {
  address: string;
  family: "IPv4" | "IPv6";
  port: number;
  size: number;
}

export interface SocketOptions {
  type: "udp4" | "udp6";
  reuseAddr?: boolean | undefined;
  reusePort?: boolean | undefined;
  ipv6Only?: boolean | undefined;
  recvBufferSize?: number | undefined;
  sendBufferSize?: number | undefined;
  lookup?: LookupFunction | undefined;
  receiveBlockList?: BlockList | undefined;
  sendBlockList?: BlockList | undefined;
  signal?: AbortSignalLike | undefined;
}

export interface BindOptions {
  port?: number | undefined;
  address?: string | undefined;
  exclusive?: boolean | undefined;
}

type SendCallback = (error: Error | null, bytes?: number) => void;
type ConnectCallback = (error?: Error) => void;
type LookupCallback = (error: Error | null, address: string, family: number) => void;
export type LookupFunction = (
  hostname: string,
  family: number,
  callback: LookupCallback,
) => void;
type DatagramChunk = string | ArrayBufferView;
type DatagramData = DatagramChunk | readonly DatagramChunk[];

function isVoidCallback(value: unknown): value is () => void {
  return typeof value === "function";
}

function isSendCallback(value: unknown): value is SendCallback {
  return typeof value === "function";
}

function isLookupFunction(value: unknown): value is LookupFunction {
  return typeof value === "function";
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function toUint32(value: unknown): number {
  if (typeof value === "bigint") {
    throw new TypeError("Cannot mix BigInt and other types, use explicit conversions");
  }
  return Number(value) >>> 0;
}

function bufferFromView(view: ArrayBufferView): Buffer {
  const backing = view.buffer;
  if (!(backing instanceof ArrayBuffer)) {
    throw new ERR_INVALID_ARG_TYPE("buffer", "non-shared ArrayBuffer view", view);
  }
  return Buffer.from(backing, view.byteOffset, view.byteLength);
}

function udpFamily(value: string): RemoteInfo["family"] {
  if (value !== "IPv4" && value !== "IPv6") {
    throw new Error(`native UDP returned invalid address family ${value}`);
  }
  return value;
}

function blockListFamily(family: RemoteInfo["family"]): IPFamily {
  return family === "IPv4" ? "ipv4" : "ipv6";
}

function defaultLookup(
  hostname: string,
  family: number,
  callback: LookupCallback,
): void {
  if (isIP(hostname) === family) {
    nextTick(callback, null, hostname, family);
    return;
  }
  nts_udp_lookup(hostname, family, (errno, address, resolvedFamily) => {
    const error = errno < 0 ? dnsException(errno, "getaddrinfo", hostname) : null;
    callback(error, address, resolvedFamily);
  });
}

function addressInfo(columns: (string | number)[], operation: string): AddressInfo {
  const address = columns[0];
  const family = columns[1];
  const port = columns[2];
  if (typeof address !== "string" || typeof family !== "string" || typeof port !== "number") {
    const errno = typeof address === "number" ? address : -1;
    throw exceptionWithHostPort(errno, operation);
  }
  return { address, family, port };
}

/**
 * A port, as `bind` and `send` accept one.
 *
 * `allowZero` is the difference between the two: binding to zero asks the
 * operating system for any free port, which is useful, and sending to port
 * zero is not a thing.
 */
function validatePort(port: unknown, name: string, allowZero: boolean): number {
  const value = typeof port === "string" && port.trim() !== "" ? Number(port) : port;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 65535 ||
    (!allowZero && value === 0)
  ) {
    throw new ERR_SOCKET_BAD_PORT(name, port, allowZero);
  }
  return value;
}

export class Socket extends EventEmitter {
  type: "udp4" | "udp6";

  #handle: number | null = null;
  #bindState = UNBOUND;
  #connectState = DISCONNECTED;
  #receiving = false;
  /** Calls made before the socket was bound, in insertion order. */
  #queueHead: QueuedOperation | null = null;
  #queueTail: QueuedOperation | null = null;
  #recvBufferSize: number | undefined;
  #sendBufferSize: number | undefined;
  #lookup: LookupFunction;
  #receiveBlockList: BlockList | undefined;
  #sendBlockList: BlockList | undefined;
  #asyncId: number;
  #triggerAsyncId: number;
  #contextFrame: AsyncContextFrame | undefined;

  constructor(type: "udp4" | "udp6", listener?: (msg: Buffer, rinfo: RemoteInfo) => void);
  constructor(type: SocketOptions, listener?: (msg: Buffer, rinfo: RemoteInfo) => void);
  constructor(
    type: SocketOptions | "udp4" | "udp6",
    listener?: (msg: Buffer, rinfo: RemoteInfo) => void,
  ) {
    super();

    let options: SocketOptions | undefined;
    let kind: unknown = type;
    if (type !== null && typeof type === "object") {
      options = type;
      kind = options.type;
    }

    const recvBufferSize = options?.recvBufferSize;
    const sendBufferSize = options?.sendBufferSize;
    if (recvBufferSize) validateUint32(recvBufferSize, "options.recvBufferSize");
    if (sendBufferSize) validateUint32(sendBufferSize, "options.sendBufferSize");
    const receiveBlockList = options?.receiveBlockList;
    const sendBlockList = options?.sendBlockList;
    const lookup: unknown = options?.lookup;
    if (receiveBlockList && !BlockList.isBlockList(receiveBlockList)) {
      throw new ERR_INVALID_ARG_TYPE(
        "options.receiveBlockList",
        "net.BlockList",
        receiveBlockList,
      );
    }
    if (sendBlockList && !BlockList.isBlockList(sendBlockList)) {
      throw new ERR_INVALID_ARG_TYPE("options.sendBlockList", "net.BlockList", sendBlockList);
    }
    if (lookup !== undefined && !isLookupFunction(lookup)) {
      throw new ERR_INVALID_ARG_TYPE("lookup", "Function", lookup);
    }

    if (kind !== "udp4" && kind !== "udp6") throw new ERR_SOCKET_BAD_TYPE();
    this.type = kind;
    this.#recvBufferSize = recvBufferSize;
    this.#sendBufferSize = sendBufferSize;
    this.#receiveBlockList = receiveBlockList;
    this.#sendBlockList = sendBlockList;
    this.#lookup = lookup ?? defaultLookup;
    this.#handle = nts_udp_new(
      kind,
      !!options?.reuseAddr,
      !!options?.reusePort,
      !!options?.ipv6Only,
    );
    this.#asyncId = newAsyncId();
    this.#triggerAsyncId = getDefaultTriggerAsyncId();
    this.#contextFrame = AsyncContextFrame.current();
    if (initHooksExist()) {
      emitInit(this.#asyncId, "UDPWRAP", this.#triggerAsyncId, this);
    }

    if (typeof listener === "function") this.on("message", listener);

    const signal = options?.signal;
    if (signal !== undefined && signal !== null) {
      if (typeof signal.addEventListener !== "function") {
        throw new ERR_INVALID_ARG_TYPE("options.signal", "AbortSignal", signal);
      }
      const onAborted = (): void => {
        if (this.#handle !== null) this.close();
      };
      if (signal.aborted) {
        onAborted();
      } else {
        signal.addEventListener("abort", onAborted, { once: true });
        this.once("close", () => signal.removeEventListener("abort", onAborted));
      }
    }

    if (udpSocketChannel.hasSubscribers) {
      udpSocketChannel.publish({ socket: this });
    }
  }

  /** Throws if the socket has been closed, as every operation must. */
  #healthCheck(): number {
    if (this.#handle === null) throw new ERR_SOCKET_DGRAM_NOT_RUNNING();
    return this.#handle;
  }

  /** Run a native UDP callback under this socket's resource identity. */
  #inScope<Result>(callback: () => Result): Result {
    const prior = AsyncContextFrame.exchange(this.#contextFrame);
    emitBefore(this.#asyncId, this.#triggerAsyncId, this);
    try {
      return callback();
    } finally {
      emitAfter(this.#asyncId);
      AsyncContextFrame.setCurrent(prior);
    }
  }

  /**
   * Start delivering packets.
   *
   * Separate from binding because a socket that nobody reads from should not
   * be asking the operating system for packets: `recvStart` is what makes the
   * kernel copy them to us, and until then they are dropped at the socket
   * buffer, which is the correct place for them to be dropped.
   */
  #startReceiving(): void {
    if (this.#receiving) return;
    const handle = this.#healthCheck();
    this.#receiving = true;
    nts_udp_recv_start(
      handle,
      (bytes: Uint8Array, address: string, family: string, port: number) => {
        this.#inScope(() => {
          const remoteFamily = udpFamily(family);
          if (this.#receiveBlockList?.check(address, blockListFamily(remoteFamily))) return;
          const message = bufferFromView(bytes);
          // The sender travels with the packet, not with the socket -- there is
          // no connection for it to be a property of.
          const remote: RemoteInfo = {
            address,
            family: remoteFamily,
            port,
            size: message.length,
          };
          this.emit("message", message, remote);
        });
      },
      (errno: number) => {
        this.#inScope(() => {
          this.emit("error", exceptionWithHostPort(errno, "recvmsg"));
        });
      },
    );
  }

  #stopReceiving(): void {
    if (!this.#receiving || this.#handle === null) return;
    nts_udp_recv_stop(this.#handle);
    this.#receiving = false;
  }

  /**
   * Take a port, and start receiving on it.
   *
   * Asynchronous even when nothing has to be looked up, because the address
   * may need resolving and a `bind` that was sometimes synchronous would make
   * `listening` sometimes arrive before the caller could listen for it.
   */
  bind(port?: number, address?: string, callback?: () => void): this;
  bind(port?: number, callback?: () => void): this;
  bind(callback?: () => void): this;
  bind(options: BindOptions, callback?: () => void): this;
  bind(...args: unknown[]): this {
    this.#healthCheck();
    if (this.#bindState !== UNBOUND) throw new ERR_SOCKET_ALREADY_BOUND();
    this.#bindState = BINDING;

    const last = args.at(-1);
    const callback = isVoidCallback(last) ? last : undefined;
    if (callback) {
      // Removed on either outcome, so a socket that failed and was rebuilt
      // does not call an old callback on its next success.
      const onListening = (): void => {
        this.removeListener("error", cleanup);
        callback.call(this);
      };
      const cleanup = (): void => {
        this.removeListener("error", cleanup);
        this.removeListener("listening", onListening);
      };
      this.on("error", cleanup);
      this.on("listening", onListening);
    }

    // A function in first position is the callback, not a port. `bind(cb)`
    // means "any free port, tell me when you have it", and reading it as a
    // port produced "Port should be >= 0 and < 65536. Received [Function]".
    let port: unknown = typeof args[0] === "function" ? undefined : args[0];
    let address: string | undefined;

    if (port !== null && port !== undefined && typeof port === "object") {
      const options = port;
      const optionAddress = "address" in options ? options.address : undefined;
      if (optionAddress !== undefined && typeof optionAddress !== "string") {
        throw new ERR_INVALID_ARG_TYPE("options.address", "string", optionAddress);
      }
      address = optionAddress || "";
      port = "port" in options ? options.port : undefined;
    } else {
      const givenAddress = args[1];
      if (givenAddress === undefined || isVoidCallback(givenAddress)) {
        address = "";
      } else {
        validateString(givenAddress, "address");
        address = givenAddress;
      }
    }

    // The unspecified address, which means "every interface". Different in the
    // two families, and not interchangeable: an `udp6` socket bound to
    // `0.0.0.0` is an error rather than a socket on every interface.
    const bindAddress = address || (this.type === "udp4" ? "0.0.0.0" : "::");

    const bindPort = port === undefined || port === null ? 0 : validatePort(port, "Port", true);

    const family = this.type === "udp4" ? 4 : 6;
    this.#lookup(bindAddress, family, (lookupError, resolvedAddress) => {
      if (this.#handle === null) return;
      if (lookupError) {
        this.#bindState = UNBOUND;
        this.#clearQueue();
        this.emit("error", lookupError);
        return;
      }
      const errno = nts_udp_bind_sync(this.#handle, resolvedAddress, bindPort);
      if (errno !== 0) {
        this.#bindState = UNBOUND;
        this.#clearQueue();
        this.emit(
          "error",
          exceptionWithHostPort(errno, "bind", resolvedAddress, bindPort),
        );
        return;
      }
      this.#bindState = BOUND;
      if (this.#recvBufferSize) {
        nts_udp_buffer_size(this.#handle, this.#recvBufferSize, true);
      }
      if (this.#sendBufferSize) {
        nts_udp_buffer_size(this.#handle, this.#sendBufferSize, false);
      }
      this.#startReceiving();
      this.emit("listening");
      this.#drainQueue();
    });

    return this;
  }

  /**
   * Bind without name resolution, upstream `lib/dgram.js:438`.
   *
   * The kernel's bind operation is local and non-blocking. Only DNS makes the
   * ordinary method asynchronous, so this form accepts numeric addresses and
   * leaves message delivery asynchronous.
   */
  bindSync(options?: BindOptions): AddressInfo {
    const handle = this.#healthCheck();
    const given: unknown = options === undefined ? {} : options;
    validateObject(given, "options");
    if (this.#bindState !== UNBOUND) throw new ERR_SOCKET_ALREADY_BOUND();

    const rawPort = "port" in given ? given.port : undefined;
    const port = validatePort(rawPort ?? 0, "options.port", true);
    const rawAddress = "address" in given ? given.address : undefined;
    let address: string;
    if (!rawAddress) {
      address = this.type === "udp4" ? "0.0.0.0" : "::";
    } else {
      validateString(rawAddress, "options.address");
      if (isIP(rawAddress) === 0) {
        throw new ERR_INVALID_ARG_VALUE(
          "options.address",
          rawAddress,
          "must be a numeric IP address; bindSync does not perform DNS resolution",
        );
      }
      address = rawAddress;
    }

    this.#bindState = BINDING;
    const err = nts_udp_bind_sync(handle, address, port);
    if (err !== 0) {
      this.#bindState = UNBOUND;
      throw exceptionWithHostPort(err, "bind", address, port);
    }

    this.#bindState = BOUND;
    if (this.#recvBufferSize) {
      nts_udp_buffer_size(handle, this.#recvBufferSize, true);
    }
    if (this.#sendBufferSize) {
      nts_udp_buffer_size(handle, this.#sendBufferSize, false);
    }
    this.#startReceiving();
    nextTick(() => {
      if (this.#handle !== null) this.emit("listening");
    });
    return this.address();
  }

  /** Run whatever was asked for while the bind was in flight. */
  #drainQueue(): void {
    let operation = this.#queueHead;
    this.#clearQueue();
    while (operation !== null) {
      const next = operation.next;
      operation.callback();
      operation = next;
    }
  }

  #clearQueue(): void {
    this.#queueHead = null;
    this.#queueTail = null;
  }

  #enqueue(callback: () => void): void {
    const operation = new QueuedOperation(callback);
    const tail = this.#queueTail;
    if (tail === null) {
      this.#queueHead = operation;
    } else {
      tail.next = operation;
    }
    this.#queueTail = operation;
  }

  /**
   * Remember a peer, and refuse the others.
   *
   * Not a handshake -- UDP has none. It sets a default destination so `send`
   * needs no address, and makes the socket ignore packets from anyone else,
   * which is the only part the kernel is involved in.
   */
  connect(
    port: number,
    address?: string | ConnectCallback,
    callback?: ConnectCallback,
  ): void {
    const targetPort = validatePort(port, "Port", false);
    if (typeof address === "function") {
      callback = address;
      address = undefined;
    }
    const rawAddress: unknown = address ?? "";
    validateString(rawAddress, "address");
    if (this.#connectState !== DISCONNECTED) throw new ERR_SOCKET_DGRAM_IS_CONNECTED();

    const target = rawAddress || (this.type === "udp4" ? "127.0.0.1" : "::1");
    this.#connectState = CONNECTING;
    if (callback) this.once("connect", callback);

    const fail = (error: Error): void => {
      this.#connectState = DISCONNECTED;
      if (callback !== undefined) {
        this.removeListener("connect", callback);
        nextTick(callback, error);
      } else {
        nextTick(() => {
          if (this.#handle !== null) this.emit("error", error);
        });
      }
    };

    const run = (): void => {
      if (this.#handle === null) return;
      const family = this.type === "udp4" ? 4 : 6;
      this.#lookup(target, family, (lookupError, resolvedAddress) => {
        if (this.#handle === null) return;
        if (lookupError) {
          fail(lookupError);
          return;
        }
        const resolvedFamily = isIP(resolvedAddress);
        if (
          resolvedFamily !== 0 &&
          this.#sendBlockList?.check(
            resolvedAddress,
            resolvedFamily === 4 ? "ipv4" : "ipv6",
          )
        ) {
          fail(new ERR_IP_BLOCKED(resolvedAddress));
          return;
        }
        const errno = nts_udp_connect_sync(this.#handle, resolvedAddress, targetPort);
        if (errno !== 0) {
          fail(exceptionWithHostPort(errno, "connect", target, targetPort));
          return;
        }
        this.#connectState = CONNECTED;
        nextTick(() => {
          if (this.#handle !== null) this.emit("connect");
        });
      });
    };

    // A connect before the socket has a port has to wait for one, for the same
    // reason a send does.
    if (this.#bindState === UNBOUND) {
      this.bind({ port: 0, exclusive: true });
      this.#enqueue(run);
      return;
    }
    if (this.#bindState === BINDING) {
      this.#enqueue(run);
      return;
    }
    run();
  }

  /** Synchronous numeric-address counterpart of `connect`. */
  connectSync(port: number, address?: string): void;
  connectSync(port: unknown, address?: unknown): void {
    const handle = this.#healthCheck();
    const targetPort = validatePort(port, "Port", false);
    if (this.#connectState !== DISCONNECTED) {
      throw new ERR_SOCKET_DGRAM_IS_CONNECTED();
    }

    let target: string;
    if (address === undefined || address === null || address === "") {
      target = this.type === "udp4" ? "127.0.0.1" : "::1";
    } else {
      validateString(address, "address");
      if (isIP(address) === 0) {
        throw new ERR_INVALID_ARG_VALUE(
          "address",
          address,
          "must be a numeric IP address; connectSync does not perform DNS resolution",
        );
      }
      target = address;
    }

    if (this.#bindState === UNBOUND) {
      this.bindSync();
    } else if (this.#bindState !== BOUND) {
      throw new ERR_SOCKET_ALREADY_BOUND();
    }

    const family = isIP(target) === 4 ? "ipv4" : "ipv6";
    if (this.#sendBlockList?.check(target, family)) {
      throw new ERR_IP_BLOCKED(target);
    }

    this.#connectState = CONNECTING;
    const err = nts_udp_connect_sync(handle, target, targetPort);
    if (err !== 0) {
      this.#connectState = DISCONNECTED;
      throw exceptionWithHostPort(err, "connect", target, targetPort);
    }
    this.#connectState = CONNECTED;
    nextTick(() => {
      if (this.#handle !== null) this.emit("connect");
    });
  }

  disconnect(): void {
    if (this.#connectState !== CONNECTED) throw new ERR_SOCKET_DGRAM_NOT_CONNECTED();
    const handle = this.#healthCheck();
    const err = nts_udp_disconnect(handle);
    if (err !== 0) throw exceptionWithHostPort(err, "connect");
    this.#connectState = DISCONNECTED;
  }

  /**
   * Send one packet.
   *
   * Six overlapping signatures, because the buffer may be sliced or not and
   * the destination is absent on a connected socket. Node accepts all of them
   * and so does this; the untangling is the first half of the method and it is
   * the whole of why the method is long.
   */
  send(
    buffer: DatagramData,
    port?: number | string,
    address?: string,
    callback?: SendCallback,
  ): void;
  send(buffer: DatagramData, port?: number | string, callback?: SendCallback): void;
  send(buffer: DatagramData, callback?: SendCallback): void;
  send(
    buffer: DatagramChunk,
    offset: number,
    length: number,
    port?: number | string,
    address?: string,
    callback?: SendCallback,
  ): void;
  send(
    buffer: DatagramChunk,
    offset: number,
    length: number,
    port?: number | string,
    callback?: SendCallback,
  ): void;
  send(buffer: DatagramChunk, offset: number, length: number, callback?: SendCallback): void;
  send(
    buffer: unknown,
    first?: unknown,
    second?: unknown,
    third?: unknown,
    fourth?: unknown,
    fifth?: unknown,
  ): void {
    const connected = this.#connectState === CONNECTED;
    let data: unknown = buffer;
    let rawPort: unknown = third;
    let rawAddress: unknown = fourth;
    let rawCallback: unknown = fifth;
    let sendPort = 0;
    let target = "";

    if (!connected) {
      if (fourth || (third && typeof third !== "function")) {
        data = sliceBuffer(buffer, first, second);
      } else {
        rawCallback = third;
        rawPort = first;
        rawAddress = second;
      }
    } else {
      if (typeof second === "number") {
        data = sliceBuffer(buffer, first, second);
        if (typeof third === "function") {
          rawCallback = third;
          rawPort = null;
        }
      } else {
        rawCallback = first;
      }
      if (rawPort || rawAddress) throw new ERR_SOCKET_DGRAM_IS_CONNECTED();
    }

    const list = toBufferList(data);

    if (!connected) sendPort = validatePort(rawPort, "Port", false);

    let done = isSendCallback(rawCallback) ? rawCallback : undefined;
    if (isSendCallback(rawAddress)) {
      done = rawAddress;
    } else if (rawAddress !== undefined && rawAddress !== null) {
      validateString(rawAddress, "address");
      target = rawAddress;
    }
    if (!connected && target === "") {
      target = this.type === "udp4" ? "127.0.0.1" : "::1";
    }

    this.#healthCheck();

    const onSent = done;

    const sendResolved = (resolvedTarget: string): void => {
      if (this.#handle === null) return;
      const family = isIP(resolvedTarget);
      if (
        family !== 0 &&
        this.#sendBlockList?.check(resolvedTarget, family === 4 ? "ipv4" : "ipv6")
      ) {
        if (onSent !== undefined) nextTick(onSent, new ERR_IP_BLOCKED(resolvedTarget));
        return;
      }
      const asyncId = newAsyncId();
      // Node creates the SendWrap inside a default-trigger scope owned by the
      // socket. DNS may resume from a TickObject, but that tick did not cause
      // the send: the socket did. Recording the id directly is the same
      // contract without a process-global scope mutation.
      const triggerAsyncId = this.#asyncId;
      const contextFrame = AsyncContextFrame.current();
      const resource = { socket: this };
      if (initHooksExist()) {
        emitInit(asyncId, "UDPSENDWRAP", triggerAsyncId, resource);
      }

      const complete = (error: Error | null, sent: number): void => {
        const prior = AsyncContextFrame.exchange(contextFrame);
        emitBefore(asyncId, triggerAsyncId, resource);
        try {
          if (onSent !== undefined) {
            if (error === null) onSent(null, sent);
            else onSent(error);
          }
        } finally {
          emitAfter(asyncId);
          emitDestroy(asyncId);
          AsyncContextFrame.setCurrent(prior);
        }
      };

      const err = nts_udp_send(
        this.#handle,
        list,
        sendPort,
        resolvedTarget,
        (errno: number, sent: number): void => {
          const error = errno < 0
            ? exceptionWithHostPort(errno, "send", target, sendPort)
            : null;
          complete(error, sent);
        },
      );
      if (err !== 0) {
        nextTick(complete, exceptionWithHostPort(err, "send", target, sendPort), 0);
      }
    };

    const run = (): void => {
      if (connected) {
        sendResolved("");
        return;
      }
      const family = this.type === "udp4" ? 4 : 6;
      this.#lookup(target, family, (lookupError, resolvedAddress) => {
        if (lookupError) {
          if (onSent !== undefined) {
            nextTick(onSent, lookupError);
          } else {
            nextTick(() => {
              if (this.#handle !== null) this.emit("error", lookupError);
            });
          }
          return;
        }
        sendResolved(resolvedAddress);
      });
    };

    // An unbound socket binds itself first. The packet is not dropped and not
    // sent synchronously; it waits for the port, which is the only queueing
    // this module does.
    if (this.#bindState === UNBOUND) {
      this.bind({ port: 0, exclusive: true });
      this.#enqueue(run);
      return;
    }
    if (this.#bindState === BINDING) {
      this.#enqueue(run);
      return;
    }
    // Default lookup defers numeric literals itself; a user-supplied lookup is
    // allowed to call back synchronously, exactly as Node's is.
    run();
  }

  /** Legacy fixed-arity spelling of `send`, upstream `lib/dgram.js:627`. */
  sendto(
    buffer: DatagramChunk,
    offset: number,
    length: number,
    port: number,
    address: string,
    callback?: SendCallback,
  ): void;
  sendto(
    buffer?: unknown,
    offset?: unknown,
    length?: unknown,
    port?: unknown,
    address?: unknown,
    callback?: unknown,
  ): void {
    validateNumber(offset, "offset");
    validateNumber(length, "length");
    validateNumber(port, "port");
    validateString(address, "address");
    if (callback !== undefined && !isSendCallback(callback)) {
      throw new ERR_INVALID_ARG_TYPE("callback", "Function", callback);
    }
    if (typeof buffer === "string" || ArrayBuffer.isView(buffer)) {
      this.send(buffer, offset, length, port, address, callback);
      return;
    }
    throw new ERR_INVALID_ARG_TYPE(
      "buffer",
      ["Buffer", "TypedArray", "DataView", "string"],
      buffer,
    );
  }

  close(callback?: () => void): this {
    if (typeof callback === "function") this.on("close", callback);

    // A close asked for while a bind is in flight joins the queue rather than
    // tearing down a handle the bind is about to use.
    if (this.#queueHead !== null) {
      this.#enqueue(() => this.close());
      return this;
    }

    const handle = this.#healthCheck();
    this.#stopReceiving();
    nts_udp_close(handle);
    this.#handle = null;
    emitDestroy(this.#asyncId);
    this.#asyncId = 0;
    this.#triggerAsyncId = 0;
    this.#contextFrame = undefined;
    nextTick(() => this.emit("close"));
    return this;
  }

  address(): AddressInfo {
    const handle = this.#healthCheck();
    return addressInfo(nts_udp_address(handle, false), "getsockname");
  }

  remoteAddress(): AddressInfo {
    const handle = this.#healthCheck();
    if (this.#connectState !== CONNECTED) throw new ERR_SOCKET_DGRAM_NOT_CONNECTED();
    return addressInfo(nts_udp_address(handle, true), "getpeername");
  }

  setBroadcast(on: boolean): void {
    const err = nts_udp_set_broadcast(this.#healthCheck(), on);
    if (err !== 0) throw exceptionWithHostPort(err, "setBroadcast");
  }

  setTTL(ttl: number): number {
    validateNumber(ttl, "ttl");
    const err = nts_udp_set_ttl(this.#healthCheck(), ttl);
    if (err !== 0) throw exceptionWithHostPort(err, "setTTL");
    return ttl;
  }

  setMulticastTTL(ttl: number): number {
    validateNumber(ttl, "ttl");
    const err = nts_udp_set_multicast_ttl(this.#healthCheck(), ttl);
    if (err !== 0) throw exceptionWithHostPort(err, "setMulticastTTL");
    return ttl;
  }

  setMulticastLoopback(on: boolean): boolean {
    const err = nts_udp_set_multicast_loopback(this.#healthCheck(), on);
    if (err !== 0) throw exceptionWithHostPort(err, "setMulticastLoopback");
    return on;
  }

  setMulticastInterface(interfaceAddress: string): void {
    const handle = this.#healthCheck();
    validateString(interfaceAddress, "interfaceAddress");
    const err = nts_udp_set_multicast_interface(handle, interfaceAddress);
    if (err !== 0) throw exceptionWithHostPort(err, "setMulticastInterface");
  }

  addMembership(address: string, iface?: string): void {
    const handle = this.#healthCheck();
    if (!address) throw new ERR_MISSING_ARGS("multicastAddress");
    const err = nts_udp_membership(handle, address, iface ?? "", true);
    if (err !== 0) throw exceptionWithHostPort(err, "addMembership");
  }

  dropMembership(address: string, iface?: string): void {
    const handle = this.#healthCheck();
    if (!address) throw new ERR_MISSING_ARGS("multicastAddress");
    const err = nts_udp_membership(handle, address, iface ?? "", false);
    if (err !== 0) throw exceptionWithHostPort(err, "dropMembership");
  }

  addSourceSpecificMembership(sourceAddress: string, groupAddress: string, iface?: string): void {
    const handle = this.#healthCheck();
    validateString(sourceAddress, "sourceAddress");
    validateString(groupAddress, "groupAddress");
    const err = nts_udp_source_membership(
      handle,
      sourceAddress,
      groupAddress,
      iface ?? "",
      true,
    );
    if (err !== 0) throw exceptionWithHostPort(err, "addSourceSpecificMembership");
  }

  dropSourceSpecificMembership(sourceAddress: string, groupAddress: string, iface?: string): void {
    const handle = this.#healthCheck();
    validateString(sourceAddress, "sourceAddress");
    validateString(groupAddress, "groupAddress");
    const err = nts_udp_source_membership(
      handle,
      sourceAddress,
      groupAddress,
      iface ?? "",
      false,
    );
    if (err !== 0) throw exceptionWithHostPort(err, "dropSourceSpecificMembership");
  }

  setRecvBufferSize(size: number): void {
    this.#bufferSize(size, true);
  }

  setSendBufferSize(size: number): void {
    this.#bufferSize(size, false);
  }

  getRecvBufferSize(): number {
    return this.#bufferSize(0, true);
  }

  getSendBufferSize(): number {
    return this.#bufferSize(0, false);
  }

  #bufferSize(size: number, receive: boolean): number {
    if ((size >>> 0) !== size) throw new ERR_SOCKET_BAD_BUFFER_SIZE();
    const result = nts_udp_buffer_size(this.#healthCheck(), size, receive);
    if (result < 0) throw socketBufferError(result, receive);
    return result;
  }

  getSendQueueSize(): number {
    return nts_udp_send_queue_size(this.#healthCheck());
  }

  getSendQueueCount(): number {
    return nts_udp_send_queue_count(this.#healthCheck());
  }

  /**
   * Count towards keeping the process alive, or stop counting.
   *
   * An unrefed socket still works. It just stops being a reason for the loop
   * to run, which is what a program wants for a socket that listens for
   * something optional.
   */
  ref(): this {
    if (this.#handle !== null) nts_udp_ref(this.#handle, true);
    return this;
  }

  unref(): this {
    if (this.#handle !== null) nts_udp_ref(this.#handle, false);
    return this;
  }
}

/** `send(buf, offset, length, ...)` — the slice, when one was asked for. */
function sliceBuffer(buffer: unknown, offset: unknown, length: unknown): Buffer {
  let view: Buffer;
  if (typeof buffer === "string") {
    view = Buffer.from(buffer);
  } else {
    if (!ArrayBuffer.isView(buffer)) {
      throw new ERR_INVALID_ARG_TYPE(
        "buffer",
        ["Buffer", "TypedArray", "DataView", "string"],
        buffer,
      );
    }
    view = bufferFromView(buffer);
  }
  const start = toUint32(offset);
  const size = toUint32(length);
  if (start > view.byteLength) throw new ERR_BUFFER_OUT_OF_BOUNDS("offset");
  if (start + size > view.byteLength) throw new ERR_BUFFER_OUT_OF_BOUNDS("length");
  return view.subarray(start, start + size);
}

/**
 * Everything `send` accepts, as a list of buffers.
 *
 * An array is accepted so that a caller can send a header and a body without
 * joining them first -- which for a datagram matters, because the join would
 * be the only copy in the path.
 */
function toBufferList(data: unknown): Buffer[] {
  if (typeof data === "string") return [Buffer.from(data)];
  if (isUnknownArray(data)) {
    if (data.length === 0) return [Buffer.alloc(0)];
    const buffers = new Array<Buffer>(data.length);
    for (let index = 0; index < data.length; index++) {
      const part = data[index];
      if (typeof part === "string") {
        buffers[index] = Buffer.from(part);
        continue;
      }
      if (!ArrayBuffer.isView(part)) {
        throw new ERR_INVALID_ARG_TYPE(
          "buffer list arguments",
          ["Buffer", "TypedArray", "DataView", "string"],
          data,
        );
      }
      buffers[index] = bufferFromView(part);
    }
    return buffers;
  }
  if (!ArrayBuffer.isView(data)) {
    throw new ERR_INVALID_ARG_TYPE("buffer", ["Buffer", "TypedArray", "DataView", "string"], data);
  }
  return [bufferFromView(data)];
}

export function createSocket(
  type: "udp4" | "udp6",
  listener?: (msg: Buffer, rinfo: RemoteInfo) => void,
): Socket;
export function createSocket(
  type: SocketOptions,
  listener?: (msg: Buffer, rinfo: RemoteInfo) => void,
): Socket;
export function createSocket(
  type: SocketOptions | "udp4" | "udp6",
  listener?: (msg: Buffer, rinfo: RemoteInfo) => void,
): Socket {
  return typeof type === "string" ? new Socket(type, listener) : new Socket(type, listener);
}
