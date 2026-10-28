// Node-only peer for WPT's pywebsocket handlers. The runtime under test is never
// used to parse or generate its peer's frames (RFC 6455 sections 4, 5 and 7).
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { constants, createDeflateRaw, createInflateRaw } from "node:zlib";
import type { DeflateRaw, InflateRaw } from "node:zlib";

export interface WptHandshakeOptions {
  protocol?: string;
  headers?: readonly (readonly [string, string])[];
  compression?: boolean;
  acceptKey?: string;
  statusText?: string;
  initialFrame?: Uint8Array;
}

export interface WptMessage {
  readonly binary: boolean;
  readonly data: Buffer;
}

const tail = Buffer.from([0, 0, 255, 255]);
const maximumMessageBytes = 64 * 1024 * 1024;

interface DeflateOffer {
  readonly response: string;
  readonly windowBits: number;
  readonly reset: boolean;
}

function deflateOffer(header: string): DeflateOffer | null {
  // Match the pinned pywebsocket3 processor's accepted offers. In particular its
  // client_max_window_bits is bare and client_no_context_takeover is declined.
  for (const offer of header.split(",")) {
    const parts = offer.split(";").map((part) => part.trim());
    if (parts[0] !== "permessage-deflate") continue;
    const seen = new Set<string>();
    let windowBits = 15;
    let limited = false;
    let reset = false;
    let valid = true;
    for (const part of parts.slice(1)) {
      const equals = part.indexOf("=");
      const name = (equals < 0 ? part : part.slice(0, equals)).trim();
      const value = equals < 0 ? null : part.slice(equals + 1).trim();
      if (seen.has(name)) { valid = false; break; }
      seen.add(name);
      if (name === "server_max_window_bits" && value !== null && /^(?:9|1[0-5]|"(?:9|1[0-5])")$/.test(value)) {
        // Node/zlib cannot produce an 8-bit raw stream. Declining the extension
        // is legal; never advertise a window the native codec cannot provide.
        windowBits = Number(value.replaceAll('"', ""));
        limited = true;
      } else if (name === "server_no_context_takeover" && value === null) reset = true;
      else if (name !== "client_max_window_bits" || value !== null) { valid = false; break; }
    }
    if (!valid) continue;
    return {
      response: "permessage-deflate" + (limited ? "; server_max_window_bits=" + windowBits : "")
        + (reset ? "; server_no_context_takeover" : ""),
      windowBits,
      reset,
    };
  }
  return null;
}

/** RFC 7692 contexts use Node's native zlib; framing stays in the test peer. */
class DeflateContext {
  private readonly codec: DeflateRaw | InflateRaw;
  private chunks: Buffer[] = [];
  private length = 0;
  private failure: Error | null = null;
  private pending: ((error: Error) => void) | null = null;

  constructor(inflate: boolean, windowBits = 15) {
    this.codec = inflate ? createInflateRaw({ windowBits }) : createDeflateRaw({ windowBits });
    this.codec.on("data", (chunk: Buffer) => {
      this.length += chunk.length;
      if (this.length > maximumMessageBytes) {
        this.codec.destroy(new Error("WPT peer message exceeds its buffer limit"));
      } else this.chunks.push(chunk);
    });
    this.codec.on("error", (error: Error) => {
      this.failure = error;
      this.pending?.(error);
    });
  }

  process(input: Uint8Array): Promise<Buffer> {
    if (this.failure !== null) return Promise.reject(this.failure);
    this.chunks = [];
    this.length = 0;
    return new Promise<Buffer>((resolve, reject) => {
      this.pending = reject;
      this.codec.write(input, (error) => {
        if (error) { this.pending = null; reject(error); return; }
        this.codec.flush(constants.Z_SYNC_FLUSH, () => {
          this.pending = null;
          if (this.failure !== null) reject(this.failure);
          else resolve(Buffer.concat(this.chunks, this.length));
        });
      });
    });
  }

  reset(): void { this.codec.reset(); }
  close(): void {
    this.failure ??= new Error("WPT compression context closed");
    this.pending?.(this.failure);
    this.pending = null;
    this.codec.destroy();
  }
}

export function serverFrame(opcode: number, payload: Uint8Array, fin = true, compressed = false): Buffer {
  const size = payload.byteLength;
  const header = Buffer.alloc(size < 126 ? 2 : size < 65536 ? 4 : 10);
  header[0] = (fin ? 128 : 0) | (compressed ? 64 : 0) | opcode;
  header[1] = size < 126 ? size : size < 65536 ? 126 : 127;
  if (size >= 65536) header.writeBigUInt64BE(BigInt(size), 2);
  else if (size >= 126) header.writeUInt16BE(size, 2);
  return Buffer.concat([header, payload]);
}

export class WptWebSocketPeer {
  readonly request: IncomingMessage;
  readonly url: URL;
  readonly secure: boolean;
  readonly socket: Socket;
  readonly signal: AbortSignal;
  closeCode: number | null = null;
  closeReason = "";
  closeReceived = false;
  private readonly controller = new AbortController();
  private input: Buffer;
  private offset = 0;
  private wake: (() => void) | null = null;
  private ended = false;
  private closeSent = false;
  private inflater: DeflateContext | null = null;
  private deflater: DeflateContext | null = null;
  private resetDeflater = false;

  constructor(request: IncomingMessage, socket: Socket, head: Buffer, secure: boolean) {
    this.request = request;
    this.socket = socket;
    this.secure = secure;
    this.url = new URL(request.url ?? "/", `${secure ? "https" : "http"}://${request.headers.host ?? "web-platform.test"}`);
    this.signal = this.controller.signal;
    this.input = head;
    // Paused reads are essential to the upstream backpressure handlers. A 'data'
    // listener that eagerly queues the whole message defeats the test.
    socket.pause();
    socket.on("readable", () => { this.wake?.(); });
    socket.on("end", () => { this.ended = true; this.wake?.(); });
    socket.on("error", () => { this.ended = true; this.wake?.(); });
    socket.on("close", () => {
      this.ended = true;
      this.wake?.();
      this.controller.abort(new Error("WPT peer closed"));
      this.inflater?.close();
      this.deflater?.close();
    });
  }

  header(name: string): string {
    const value = this.request.headers[name.toLowerCase()];
    return Array.isArray(value) ? value.join(", ") : value ?? "";
  }

  async validateHandshake(): Promise<boolean> {
    // pywebsocket3/handshake/hybi.py validates these before calling a handler.
    // Keeping the peer strict makes a broken client request observable.
    const valid = this.request.method === "GET" && this.request.httpVersion === "1.1"
      && this.header("host") !== "" && this.header("upgrade").toLowerCase() === "websocket"
      && this.header("connection").toLowerCase().split(",").some((token) => token.trim() === "upgrade")
      && /^[+/0-9A-Za-z]{21}[AQgw]==$/.test(this.header("sec-websocket-key"));
    const version = this.header("sec-websocket-version");
    if (valid && version === "13") return true;
    const unsupported = valid && version !== "";
    await this.writeRaw(`HTTP/1.1 ${unsupported ? "426 Upgrade Required" : "400 Bad Request"}\r\n`
      + (unsupported ? "Sec-WebSocket-Version: 13\r\n" : "") + "Content-Length: 0\r\n\r\n");
    this.end();
    return false;
  }

  async accept(options: WptHandshakeOptions = {}): Promise<void> {
    const headers: (readonly [string, string])[] = [
      ["Upgrade", "websocket"],
      ["Connection", "Upgrade"],
      ["Sec-WebSocket-Accept", options.acceptKey ?? createHash("sha1")
        .update(this.header("sec-websocket-key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64")],
    ];
    if (options.protocol !== undefined) headers.push(["Sec-WebSocket-Protocol", options.protocol]);
    if (options.compression !== false) {
      const offer = deflateOffer(this.header("sec-websocket-extensions"));
      if (offer !== null) {
        headers.push(["Sec-WebSocket-Extensions", offer.response]);
        this.inflater = new DeflateContext(true);
        this.deflater = new DeflateContext(false, offer.windowBits);
        this.resetDeflater = offer.reset;
      }
    }
    headers.push(...(options.headers ?? []));
    const response = Buffer.from(`HTTP/1.1 101 ${options.statusText ?? "Switching Protocols"}\r\n`
      + headers.map(([name, value]) => name + ": " + value + "\r\n").join("") + "\r\n", "latin1");
    await this.writeRaw(options.initialFrame === undefined
      ? response : Buffer.concat([response, options.initialFrame]));
  }

  private async exact(length: number): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let remaining = length;
    while (remaining > 0) {
      if (this.offset === this.input.length) {
        const chunk: unknown = this.socket.read();
        if (chunk !== null) {
          if (!Buffer.isBuffer(chunk)) throw new TypeError("WPT socket must produce bytes");
          this.input = chunk;
          this.offset = 0;
        } else {
          if (this.ended || this.socket.destroyed || this.socket.readableEnded) return null;
          await new Promise<void>((resolve) => { this.wake = resolve; });
          this.wake = null;
          continue;
        }
      }
      const size = Math.min(remaining, this.input.length - this.offset);
      chunks.push(this.input.subarray(this.offset, this.offset + size));
      this.offset += size;
      remaining -= size;
    }
    return chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, length);
  }

  async readMessage(): Promise<WptMessage | null> {
    const fragments: Buffer[] = [];
    let size = 0;
    let messageOpcode = 0;
    let compressed = false;
    while (!this.closeReceived) {
      const header = await this.exact(2);
      if (header === null) return null;
      const first = header[0]!;
      const second = header[1]!;
      const opcode = first & 15;
      const fin = (first & 128) !== 0;
      if ((second & 128) === 0 || (first & 48) !== 0) throw new Error("Invalid client frame");
      let length = second & 127;
      if (length >= 126) {
        const extended = await this.exact(length === 126 ? 2 : 8);
        if (extended === null) return null;
        const value = length === 126 ? BigInt(extended.readUInt16BE()) : extended.readBigUInt64BE();
        if (value > BigInt(maximumMessageBytes)) throw new Error("WPT frame too large");
        length = Number(value);
      }
      const mask = await this.exact(4);
      const wire = await this.exact(length);
      if (mask === null || wire === null) return null;
      const payload = Buffer.allocUnsafe(length);
      for (let index = 0; index < length; index++) payload[index] = wire[index]! ^ mask[index & 3]!;
      if (opcode >= 8) {
        if (!fin || length > 125 || (first & 64) !== 0) throw new Error("Invalid control frame");
        if (opcode === 8) {
          this.closeReceived = true;
          if (length === 1) throw new Error("Invalid close payload");
          this.closeCode = length < 2 ? null : payload.readUInt16BE();
          this.closeReason = payload.subarray(2).toString("utf8");
          return null;
        }
        if (opcode === 9) await this.sendFrame(10, payload);
        else if (opcode !== 10) throw new Error("Invalid control opcode");
        continue;
      }
      if (opcode === 1 || opcode === 2) {
        if (messageOpcode !== 0) throw new Error("Interleaved messages");
        messageOpcode = opcode;
        compressed = (first & 64) !== 0;
      } else if (opcode !== 0 || messageOpcode === 0 || (first & 64) !== 0) {
        throw new Error("Invalid continuation");
      }
      fragments.push(payload);
      size += length;
      if (size > maximumMessageBytes) throw new Error("WPT message too large");
      if (!fin) continue;
      let data: Buffer = fragments.length === 1 ? payload : Buffer.concat(fragments, size);
      if (compressed) {
        if (this.inflater === null) throw new Error("Unnegotiated compression");
        data = await this.inflater.process(Buffer.concat([data, tail]));
      }
      return { binary: messageOpcode === 2, data };
    }
    return null;
  }

  async send(data: string | Uint8Array, binary = typeof data !== "string"): Promise<void> {
    let payload: Uint8Array = typeof data === "string" ? Buffer.from(data) : data;
    if (this.deflater !== null) {
      const flushed = await this.deflater.process(payload);
      payload = flushed.subarray(0, flushed.length - 4);
      if (this.resetDeflater) this.deflater.reset();
    }
    await this.writeRaw(serverFrame(binary ? 2 : 1, payload, true, this.deflater !== null));
  }

  sendFrame(opcode: number, payload: Uint8Array, fin = true): Promise<void> {
    return this.writeRaw(serverFrame(opcode, payload, fin));
  }

  writeRaw(data: string | Uint8Array): Promise<void> {
    if (this.socket.destroyed) return Promise.reject(new Error("WPT peer closed"));
    return new Promise<void>((resolve, reject) => {
      const closed = (): void => { reject(new Error("WPT peer closed during write")); };
      this.socket.once("close", closed);
      this.socket.write(data, (error?: Error | null) => {
        this.socket.off("close", closed);
        if (error) reject(error); else resolve();
      });
    });
  }

  async close(code: number | null = 1000, reason = ""): Promise<void> {
    if (!this.closeSent && !this.socket.destroyed) {
      this.closeSent = true;
      const payload = code === null ? Buffer.alloc(0) : Buffer.alloc(2 + Buffer.byteLength(reason));
      if (code !== null) { payload.writeUInt16BE(code); payload.write(reason, 2); }
      await this.sendFrame(8, payload);
    }
    while (!this.closeReceived && !this.socket.destroyed) {
      if (await this.readMessage() === null) break;
    }
    this.end();
  }

  delay(milliseconds: number): Promise<void> {
    if (this.signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = (): void => { clearTimeout(timer); this.signal.removeEventListener("abort", done); resolve(); };
      const timer = setTimeout(done, milliseconds);
      this.signal.addEventListener("abort", done, { once: true });
    });
  }

  end(): void { this.socket.end(); }
  abort(): void { this.socket.destroy(); }
}
