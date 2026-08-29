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
import { nextTick } from "../../internal/tick.ts";
import {
  ERR_INVALID_ARG_TYPE,
  ERR_SOCKET_ALREADY_BOUND,
  ERR_SOCKET_BAD_PORT,
  ERR_SOCKET_BAD_TYPE,
  ERR_SOCKET_DGRAM_IS_CONNECTED,
  ERR_SOCKET_DGRAM_NOT_CONNECTED,
  ERR_SOCKET_DGRAM_NOT_RUNNING,
} from "../../internal/errors.ts";
import { exceptionWithHostPort } from "../../internal/uv.ts";
import { validateString } from "../../internal/validators.ts";
import type { AbortSignalLike } from "../../internal/abort.ts";

/** Open a datagram socket. `type` is `udp4` or `udp6`. */
declare function nts_udp_new(type: string, reuseAddr: boolean, ipv6Only: boolean): number;
/**
 * Bind, and call back when the socket actually has the port.
 *
 * A callback and not a return code, because binding is asynchronous: the name
 * may need resolving and the port is not assigned until the kernel says so.
 * Reporting success synchronously would let `address()` be called on a socket
 * that does not have one yet, which is exactly the failure it caused.
 */
declare function nts_udp_bind(
  handle: number,
  address: string,
  port: number,
  onBound: (errno: number) => void,
): number;
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
  bytes: number[],
  port: number,
  address: string,
  callback: (errno: number, sent: number) => void,
): number;
declare function nts_udp_recv_start(
  handle: number,
  onMessage: (bytes: number[], address: string, family: string, port: number) => void,
  onError: (errno: number) => void,
): number;
declare function nts_udp_recv_stop(handle: number): number;
declare function nts_udp_connect(
  handle: number,
  address: string,
  port: number,
  onConnected: (errno: number) => void,
): number;
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
declare function nts_udp_buffer_size(handle: number, size: number, receive: boolean): number;
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

export interface RemoteInfo {
  address: string;
  family: "IPv4" | "IPv6";
  port: number;
  size: number;
}

export interface AddressInfo {
  address: string;
  family: string;
  port: number;
}

export interface SocketOptions {
  type?: "udp4" | "udp6" | undefined;
  reuseAddr?: boolean | undefined;
  ipv6Only?: boolean | undefined;
  recvBufferSize?: number | undefined;
  sendBufferSize?: number | undefined;
  signal?: AbortSignalLike | undefined;
}

export interface BindOptions {
  port?: number | undefined;
  address?: string | undefined;
  exclusive?: boolean | undefined;
}

type SendCallback = (error: Error | null, bytes?: number) => void;

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
  /**
   * Calls made before the socket was bound.
   *
   * Present only while a bind is in flight -- `undefined` rather than an empty
   * array, because "there is a queue" is what tells a later call to join it
   * rather than to run.
   */
  #queue: (() => void)[] | undefined;
  #recvBufferSize: number | undefined;
  #sendBufferSize: number | undefined;

  constructor(type?: SocketOptions | "udp4" | "udp6", listener?: (msg: Buffer, rinfo: RemoteInfo) => void) {
    super();

    let options: SocketOptions = {};
    let kind: unknown = type;
    if (type !== null && typeof type === "object") {
      options = type;
      kind = options.type;
    }

    if (kind !== "udp4" && kind !== "udp6") throw new ERR_SOCKET_BAD_TYPE();
    this.type = kind;

    this.#recvBufferSize = options.recvBufferSize;
    this.#sendBufferSize = options.sendBufferSize;
    this.#handle = nts_udp_new(kind, !!options.reuseAddr, !!options.ipv6Only);

    if (typeof listener === "function") this.on("message", listener as never);

    const signal = options.signal;
    if (signal !== undefined && signal !== null) {
      if (typeof (signal as AbortSignalLike).addEventListener !== "function") {
        throw new ERR_INVALID_ARG_TYPE("options.signal", "AbortSignal", signal);
      }
      const onAborted = (): void => {
        if (this.#handle !== null) this.close();
      };
      if (signal.aborted) {
        onAborted();
      } else {
        signal.addEventListener("abort", onAborted, { once: true });
        this.once("close", (() => signal.removeEventListener("abort", onAborted)) as never);
      }
    }
  }

  /** Throws if the socket has been closed, as every operation must. */
  #healthCheck(): number {
    if (this.#handle === null) throw new ERR_SOCKET_DGRAM_NOT_RUNNING();
    return this.#handle;
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
      (bytes: number[], address: string, family: string, port: number) => {
        const message = Buffer.from(bytes);
        // The sender travels with the packet, not with the socket -- there is
        // no connection for it to be a property of.
        this.emit("message", message, {
          address,
          family: family as "IPv4" | "IPv6",
          port,
          size: message.length,
        } as RemoteInfo);
      },
      (errno: number) => {
        this.emit("error", exceptionWithHostPort(errno, "recvmsg"));
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
  bind(...args: unknown[]): this {
    this.#healthCheck();
    if (this.#bindState !== UNBOUND) throw new ERR_SOCKET_ALREADY_BOUND();
    this.#bindState = BINDING;

    const callback = args.length > 0 && typeof args[args.length - 1] === "function"
      ? (args[args.length - 1] as () => void)
      : undefined;
    if (callback) {
      // Removed on either outcome, so a socket that failed and was rebuilt
      // does not call an old callback on its next success.
      const onListening = (): void => {
        this.removeListener("error", cleanup as never);
        callback.call(this);
      };
      const cleanup = (): void => {
        this.removeListener("error", cleanup as never);
        this.removeListener("listening", onListening as never);
      };
      this.on("error", cleanup as never);
      this.on("listening", onListening as never);
    }

    // A function in first position is the callback, not a port. `bind(cb)`
    // means "any free port, tell me when you have it", and reading it as a
    // port produced "Port should be >= 0 and < 65536. Received [Function]".
    let port: unknown = typeof args[0] === "function" ? undefined : args[0];
    let address: string | undefined;

    if (port !== null && port !== undefined && typeof port === "object") {
      const options = port as BindOptions;
      address = options.address || "";
      port = options.port;
    } else {
      address = typeof args[1] === "function" ? "" : (args[1] as string | undefined);
    }

    // The unspecified address, which means "every interface". Different in the
    // two families, and not interchangeable: an `udp6` socket bound to
    // `0.0.0.0` is an error rather than a socket on every interface.
    if (!address) address = this.type === "udp4" ? "0.0.0.0" : "::";

    const bindPort = port === undefined || port === null ? 0 : validatePort(port, "Port", true);

    nextTick(() => {
      if (this.#handle === null) return;
      nts_udp_bind(this.#handle, address as string, bindPort, (errno: number) => {
        if (this.#handle === null) return;
        if (errno !== 0) {
          this.#bindState = UNBOUND;
          this.emit("error", exceptionWithHostPort(errno, "bind", address, bindPort));
          this.#drainQueue();
          return;
        }
        this.#bindState = BOUND;
        if (this.#recvBufferSize !== undefined) {
          nts_udp_buffer_size(this.#handle, this.#recvBufferSize, true);
        }
        if (this.#sendBufferSize !== undefined) {
          nts_udp_buffer_size(this.#handle, this.#sendBufferSize, false);
        }
        this.#startReceiving();
        this.emit("listening");
        this.#drainQueue();
      });
    });

    return this;
  }

  /** Run whatever was asked for while the bind was in flight. */
  #drainQueue(): void {
    const queue = this.#queue;
    this.#queue = undefined;
    if (!queue) return;
    for (const work of queue) work();
  }

  /**
   * Remember a peer, and refuse the others.
   *
   * Not a handshake -- UDP has none. It sets a default destination so `send`
   * needs no address, and makes the socket ignore packets from anyone else,
   * which is the only part the kernel is involved in.
   */
  connect(port: number, address?: string | (() => void), callback?: () => void): void {
    if (typeof address === "function") {
      callback = address;
      address = undefined;
    }
    if (this.#connectState !== DISCONNECTED) throw new ERR_SOCKET_DGRAM_IS_CONNECTED();

    const target = address || (this.type === "udp4" ? "127.0.0.1" : "::1");
    const targetPort = validatePort(port, "Port", false);
    this.#connectState = CONNECTING;
    if (callback) this.once("connect", callback as never);

    const run = (): void => {
      if (this.#handle === null) return;
      // Also asynchronous, and for the same reason: the address may need
      // resolving before there is anything to remember.
      nts_udp_connect(this.#handle, target, targetPort, (errno: number) => {
        if (this.#handle === null) return;
        if (errno !== 0) {
          this.#connectState = DISCONNECTED;
          this.emit("error", exceptionWithHostPort(errno, "connect", target, targetPort));
          return;
        }
        this.#connectState = CONNECTED;
        this.emit("connect");
      });
    };

    // A connect before the socket has a port has to wait for one, for the same
    // reason a send does.
    if (this.#bindState === UNBOUND) {
      this.bind({ port: 0, exclusive: true });
      (this.#queue ??= []).push(run);
      return;
    }
    if (this.#bindState === BINDING) {
      (this.#queue ??= []).push(run);
      return;
    }
    nextTick(run);
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
    buffer: Buffer | string | (Buffer | string)[],
    offset?: number | SendCallback,
    length?: number | SendCallback,
    port?: number | string | SendCallback,
    address?: string | SendCallback,
    callback?: SendCallback,
  ): void {
    const connected = this.#connectState === CONNECTED;
    let data = buffer;
    let sendPort: unknown = port;
    let sendAddress: unknown = address;
    let done: SendCallback | undefined = callback;

    if (!connected) {
      if (address || (port && typeof port !== "function")) {
        data = sliceBuffer(buffer, offset as number, length as number);
      } else {
        // `send(buf, port, address, cb)` -- the offset and length were never
        // there and everything has shifted left by two.
        done = port as SendCallback;
        sendPort = offset;
        sendAddress = length;
      }
    } else {
      if (typeof length === "number") {
        data = sliceBuffer(buffer, offset as number, length);
        if (typeof port === "function") {
          done = port;
          sendPort = null;
        }
      } else {
        done = offset as SendCallback;
      }
      if (sendPort || sendAddress) throw new ERR_SOCKET_DGRAM_IS_CONNECTED();
    }

    const list = toBufferList(data);
    if (!connected) sendPort = validatePort(sendPort, "Port", false);
    if (typeof done !== "function") done = undefined;

    if (typeof sendAddress === "function") {
      done = sendAddress as SendCallback;
      sendAddress = undefined;
    } else if (sendAddress != null) {
      validateString(sendAddress, "address");
    }

    this.#healthCheck();

    const target = (sendAddress as string | undefined) ??
      (this.type === "udp4" ? "127.0.0.1" : "::1");
    const payload = list.length === 1 ? (list[0] as Buffer) : Buffer.concat(list);

    const run = (): void => {
      if (this.#handle === null) return;
      const err = nts_udp_send(
        this.#handle,
        Array.from(payload) as number[],
        connected ? 0 : (sendPort as number),
        connected ? "" : target,
        (errno: number, sent: number) => {
          if (!done) return;
          if (errno < 0) done(exceptionWithHostPort(errno, "send", target, sendPort as number));
          else done(null, sent);
        },
      );
      if (err !== 0 && done) {
        const ex = exceptionWithHostPort(err, "send", target, sendPort as number);
        nextTick(() => (done as SendCallback)(ex));
      }
    };

    // An unbound socket binds itself first. The packet is not dropped and not
    // sent synchronously; it waits for the port, which is the only queueing
    // this module does.
    if (this.#bindState === UNBOUND) {
      this.bind({ port: 0, exclusive: true });
      (this.#queue ??= []).push(run);
      return;
    }
    if (this.#bindState === BINDING) {
      (this.#queue ??= []).push(run);
      return;
    }
    run();
  }

  close(callback?: () => void): this {
    if (typeof callback === "function") this.on("close", callback as never);

    // A close asked for while a bind is in flight joins the queue rather than
    // tearing down a handle the bind is about to use.
    if (this.#queue !== undefined) {
      this.#queue.push(() => this.close());
      return this;
    }

    const handle = this.#healthCheck();
    this.#stopReceiving();
    nts_udp_close(handle);
    this.#handle = null;
    nextTick(() => this.emit("close"));
    return this;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#handle === null) return;
    await new Promise<void>((resolve) => this.close(() => resolve()));
  }

  address(): AddressInfo {
    const handle = this.#healthCheck();
    const out = nts_udp_address(handle, false);
    if (out.length < 3) throw exceptionWithHostPort(out[0] as number, "getsockname");
    return { address: out[0] as string, family: out[1] as string, port: out[2] as number };
  }

  remoteAddress(): AddressInfo {
    this.#healthCheck();
    if (this.#connectState !== CONNECTED) throw new ERR_SOCKET_DGRAM_NOT_CONNECTED();
    const out = nts_udp_address(this.#handle as number, true);
    if (out.length < 3) throw exceptionWithHostPort(out[0] as number, "getpeername");
    return { address: out[0] as string, family: out[1] as string, port: out[2] as number };
  }

  setBroadcast(on: boolean): void {
    const err = nts_udp_set_broadcast(this.#healthCheck(), on);
    if (err !== 0) throw exceptionWithHostPort(err, "setBroadcast");
  }

  setTTL(ttl: number): number {
    validateNumberInRange(ttl, "ttl", 1, 255);
    const err = nts_udp_set_ttl(this.#healthCheck(), ttl);
    if (err !== 0) throw exceptionWithHostPort(err, "setTTL");
    return ttl;
  }

  setMulticastTTL(ttl: number): number {
    validateNumberInRange(ttl, "ttl", 0, 255);
    const err = nts_udp_set_multicast_ttl(this.#healthCheck(), ttl);
    if (err !== 0) throw exceptionWithHostPort(err, "setMulticastTTL");
    return ttl;
  }

  setMulticastLoopback(on: boolean): boolean {
    const err = nts_udp_set_multicast_loopback(this.#healthCheck(), on);
    if (err !== 0) throw exceptionWithHostPort(err, "setMulticastLoopback");
    return on;
  }

  setMulticastInterface(iface: string): void {
    this.#healthCheck();
    validateString(iface, "multicastInterface");
    const err = nts_udp_set_multicast_interface(this.#handle as number, iface);
    if (err !== 0) throw exceptionWithHostPort(err, "setMulticastInterface");
  }

  addMembership(address: string, iface?: string): void {
    const handle = this.#healthCheck();
    if (!address) throw new ERR_INVALID_ARG_TYPE("multicastAddress", "string", address);
    const err = nts_udp_membership(handle, address, iface ?? "", true);
    if (err !== 0) throw exceptionWithHostPort(err, "addMembership");
  }

  dropMembership(address: string, iface?: string): void {
    const handle = this.#healthCheck();
    if (!address) throw new ERR_INVALID_ARG_TYPE("multicastAddress", "string", address);
    const err = nts_udp_membership(handle, address, iface ?? "", false);
    if (err !== 0) throw exceptionWithHostPort(err, "dropMembership");
  }

  setRecvBufferSize(size: number): void {
    const err = nts_udp_buffer_size(this.#healthCheck(), size, true);
    if (err !== 0) throw exceptionWithHostPort(err, "setRecvBufferSize");
  }

  setSendBufferSize(size: number): void {
    const err = nts_udp_buffer_size(this.#healthCheck(), size, false);
    if (err !== 0) throw exceptionWithHostPort(err, "setSendBufferSize");
  }

  getRecvBufferSize(): number {
    return nts_udp_buffer_size(this.#healthCheck(), 0, true);
  }

  getSendBufferSize(): number {
    return nts_udp_buffer_size(this.#healthCheck(), 0, false);
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

function validateNumberInRange(value: unknown, name: string, min: number, max: number): void {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  }
  if (value < min || value > max) {
    throw new ERR_SOCKET_BAD_PORT(name, value, true);
  }
}

/** `send(buf, offset, length, ...)` — the slice, when one was asked for. */
function sliceBuffer(buffer: unknown, offset: number, length: number): Buffer {
  if (typeof buffer === "string") return Buffer.from(buffer);
  if (!ArrayBuffer.isView(buffer as ArrayBufferView)) {
    throw new ERR_INVALID_ARG_TYPE(
      "buffer",
      ["Buffer", "TypedArray", "DataView", "string"],
      buffer,
    );
  }
  const view = buffer as Buffer;
  return view.subarray(offset >>> 0, (offset >>> 0) + (length >>> 0)) as Buffer;
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
  if (Array.isArray(data)) {
    return data.map((part) => {
      if (typeof part === "string") return Buffer.from(part);
      if (!ArrayBuffer.isView(part as ArrayBufferView)) {
        throw new ERR_INVALID_ARG_TYPE(
          "buffer list arguments",
          ["Buffer", "TypedArray", "DataView", "string"],
          part,
        );
      }
      return part as Buffer;
    });
  }
  if (!ArrayBuffer.isView(data as ArrayBufferView)) {
    throw new ERR_INVALID_ARG_TYPE(
      "buffer",
      ["Buffer", "TypedArray", "DataView", "string"],
      data,
    );
  }
  return [data as Buffer];
}

export function createSocket(
  type?: SocketOptions | "udp4" | "udp6",
  listener?: (msg: Buffer, rinfo: RemoteInfo) => void,
): Socket {
  return new Socket(type, listener);
}
