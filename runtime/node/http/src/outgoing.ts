// `http.OutgoingMessage` and `http.ServerResponse`, from node v24.20.0
// `lib/_http_outgoing.js` and `lib/_http_server.js`.
//
// The writable half. It is writable in shape but not in substance: what a
// caller writes is a *body*, and what reaches the socket is a body wrapped in
// a framing that was decided when the headers went out. So `write` is not a
// pass-through, and the interesting decision happens before the first byte of
// body is sent.
//
// That decision is the framing, and there are only three answers. If the
// program set a `Content-Length`, the body is that many bytes. If it did not
// and the protocol is HTTP/1.1, the body is chunked -- each write becomes a
// length-prefixed chunk and the end is a zero-length one. If it did not and
// the protocol is HTTP/1.0, there is no way to delimit a body except by
// closing the connection, so the connection cannot be reused.
//
// Getting this wrong is not a formatting error. A response whose declared
// length disagrees with its body desynchronises the connection: the next
// response begins where the reader is still expecting bytes.

import { Buffer } from "../../buffer/src/main.ts";
import { EventEmitter } from "../../events/src/main.ts";
import { nextTick } from "../../internal/tick.ts";
import {
  ERR_HTTP_HEADERS_SENT,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_HTTP_TOKEN,
  ERR_STREAM_WRITE_AFTER_END,
} from "../../internal/errors.ts";
import { STATUS_CODES } from "./status.ts";

/** As much of a socket as an outgoing message uses. */
export interface OutgoingSocket {
  write(chunk: Buffer | string, encoding?: string, callback?: () => void): boolean;
  end(chunk?: Buffer | string): unknown;
  destroy(error?: unknown): void;
  writable?: boolean;
  on(event: string, listener: (...args: never[]) => void): unknown;
  [key: string]: unknown;
}

/** RFC 9110's `token`: what a header name may contain. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Anything that would end a line or a field, which no value may contain.
 *
 * Written as escapes rather than as literal characters: a control byte sitting
 * inside a character class is invisible in a diff and in a review, which is
 * exactly the wrong property for the check that prevents response splitting.
 */
const CONTROL = /[\u0000-\u001f\u007f]/;

function checkHeaderName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !TOKEN.test(name)) {
    throw new ERR_INVALID_HTTP_TOKEN("Header name", String(name));
  }
}

/**
 * A header value with no control characters in it.
 *
 * A newline here is response splitting: everything after it is read as a new
 * header, or as the start of a second response. It is the most common way a
 * program that echoes user input into a header becomes exploitable, which is
 * why it is checked on the way out as well as on the way in.
 */
function checkHeaderValue(name: string, value: unknown): void {
  if (value === undefined) {
    throw new ERR_INVALID_HTTP_TOKEN("Header value", `undefined for ${name}`);
  }
  const text = Array.isArray(value) ? value.join("") : String(value);
  if (CONTROL.test(text)) {
    throw new ERR_INVALID_HTTP_TOKEN("Header value", text);
  }
}

export class OutgoingMessage extends EventEmitter {
  socket: OutgoingSocket | null = null;

  /** Whether the head has gone out and the headers are therefore fixed. */
  headersSent = false;
  finished = false;
  writableEnded = false;
  writableFinished = false;
  destroyed = false;

  /** Set by the server or the client before anything is written. */
  shouldKeepAlive = true;
  useChunkedEncodingByDefault = true;
  sendDate = false;
  chunkedEncoding = false;

  /** Lowercased name to `[originalName, value]`. */
  protected headersMap = new Map<string, [string, string | number | string[]]>();
  protected trailersMap = new Map<string, [string, string | number | string[]]>();

  /** Filled in by a subclass: the status line or the request line. */
  protected statusLine = "";

  #ended = false;

  get connection(): OutgoingSocket | null {
    return this.socket;
  }

  get writable(): boolean {
    return !this.#ended && !this.destroyed;
  }

  setHeader(name: string, value: string | number | string[]): this {
    checkHeaderName(name);
    checkHeaderValue(name, value);
    if (this.headersSent) throw new ERR_HTTP_HEADERS_SENT("set");
    this.headersMap.set(name.toLowerCase(), [name, value]);
    return this;
  }

  getHeader(name: string): string | number | string[] | undefined {
    if (typeof name !== "string") {
      throw new ERR_INVALID_ARG_TYPE("name", "string", name);
    }
    return this.headersMap.get(name.toLowerCase())?.[1];
  }

  /** Every header, keyed by lowercased name. A copy: mutating it does nothing. */
  getHeaders(): Record<string, string | number | string[]> {
    const out = Object.create(null) as Record<string, string | number | string[]>;
    for (const [key, entry] of this.headersMap) out[key] = entry[1];
    return out;
  }

  getHeaderNames(): string[] {
    return [...this.headersMap.keys()];
  }

  /** The names as they were given, which is what goes on the wire. */
  getRawHeaderNames(): string[] {
    return [...this.headersMap.values()].map((entry) => entry[0]);
  }

  hasHeader(name: string): boolean {
    if (typeof name !== "string") {
      throw new ERR_INVALID_ARG_TYPE("name", "string", name);
    }
    return this.headersMap.has(name.toLowerCase());
  }

  removeHeader(name: string): void {
    if (typeof name !== "string") {
      throw new ERR_INVALID_ARG_TYPE("name", "string", name);
    }
    if (this.headersSent) throw new ERR_HTTP_HEADERS_SENT("remove");
    this.headersMap.delete(name.toLowerCase());
  }

  /**
   * Fields sent *after* the body, which only chunked encoding can carry.
   *
   * They exist for values that are not known until the body is finished -- a
   * checksum, a signature -- and they are dropped without chunked encoding
   * because there is nowhere to put them.
   */
  addTrailers(headers: Record<string, string | number> | [string, string][]): void {
    const entries = Array.isArray(headers) ? headers : Object.entries(headers);
    for (const pair of entries) {
      const name = pair[0] as string;
      const value = pair[1] as string | number;
      checkHeaderName(name);
      checkHeaderValue(name, value);
      this.trailersMap.set(name.toLowerCase(), [name, value as string]);
    }
  }

  /** Written by a subclass before the headers, as the first line. */
  protected _implicitHeader(): void {
    throw new Error("_implicitHeader() must be implemented by a subclass");
  }

  /**
   * Decide the framing and send the head.
   *
   * Nothing may change the headers after this, which is why `setHeader` throws
   * once it has run: the length has been declared and the reader is counting.
   */
  flushHeaders(): void {
    if (this.headersSent) return;
    if (!this.statusLine) this._implicitHeader();

    const declared = this.headersMap.get("content-length");
    const encoding = this.headersMap.get("transfer-encoding");

    if (declared) {
      this.chunkedEncoding = false;
    } else if (encoding && String(encoding[1]).toLowerCase().includes("chunked")) {
      this.chunkedEncoding = true;
    } else if (this.useChunkedEncodingByDefault) {
      this.chunkedEncoding = true;
      this.headersMap.set("transfer-encoding", ["Transfer-Encoding", "chunked"]);
    } else {
      // No length and no chunking: the body ends when the connection does, so
      // the connection cannot be reused and must say so.
      this.shouldKeepAlive = false;
    }

    if (!this.headersMap.has("connection")) {
      this.headersMap.set("connection", [
        "Connection",
        this.shouldKeepAlive ? "keep-alive" : "close",
      ]);
    }

    if (this.sendDate && !this.headersMap.has("date")) {
      this.headersMap.set("date", ["Date", new Date().toUTCString()]);
    }

    let head = `${this.statusLine}\r\n`;
    for (const entry of this.headersMap.values()) {
      const name = entry[0];
      const value = entry[1];
      if (Array.isArray(value)) {
        // A repeated field is repeated lines, not a joined one -- required for
        // `Set-Cookie` and harmless for everything else.
        for (const one of value) head += `${name}: ${one}\r\n`;
      } else {
        head += `${name}: ${value}\r\n`;
      }
    }
    head += "\r\n";

    this.headersSent = true;
    this.socket?.write(head, "latin1");
  }

  write(chunk: string | Buffer, encoding?: string | (() => void), callback?: () => void): boolean {
    let enc = encoding;
    if (typeof enc === "function") {
      callback = enc;
      enc = undefined;
    }
    if (this.#ended) {
      const error = new ERR_STREAM_WRITE_AFTER_END();
      nextTick(() => this.emit("error", error));
      return false;
    }

    if (!this.headersSent) this.flushHeaders();

    const buffer = typeof chunk === "string"
      ? Buffer.from(chunk, (enc as string) ?? "utf8")
      : chunk;

    if (buffer.length === 0) {
      // A zero-length chunk is not "nothing" in chunked encoding -- it is the
      // terminator -- so it is dropped rather than framed.
      if (callback) nextTick(callback);
      return true;
    }

    let ok: boolean;
    if (this.chunkedEncoding) {
      this.socket?.write(`${buffer.length.toString(16)}\r\n`, "latin1");
      ok = this.socket?.write(buffer) !== false;
      this.socket?.write("\r\n", "latin1");
    } else {
      ok = this.socket?.write(buffer) !== false;
    }

    if (callback) nextTick(callback);
    return ok;
  }

  end(
    chunk?: string | Buffer | (() => void),
    encoding?: string | (() => void),
    callback?: () => void,
  ): this {
    let body = chunk;
    let enc = encoding;
    if (typeof body === "function") {
      callback = body;
      body = undefined;
    } else if (typeof enc === "function") {
      callback = enc;
      enc = undefined;
    }

    if (this.#ended) {
      if (callback) nextTick(callback);
      return this;
    }

    if (body !== undefined) this.write(body as string | Buffer, enc as string);
    else if (!this.headersSent) this.flushHeaders();

    if (this.chunkedEncoding) {
      let tail = "0\r\n";
      for (const entry of this.trailersMap.values()) {
        tail += `${entry[0]}: ${entry[1]}\r\n`;
      }
      tail += "\r\n";
      this.socket?.write(tail, "latin1");
    }

    this.#ended = true;
    this.writableEnded = true;
    this.finished = true;

    // On a tick, so a caller that ends and then adds a `finish` listener in
    // the same statement still hears about it.
    nextTick(() => {
      this.writableFinished = true;
      this.emit("finish");
      if (callback) callback();
    });

    return this;
  }

  destroy(error?: unknown): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.socket?.destroy(error);
    return this;
  }

  setTimeout(msecs: number, callback?: () => void): this {
    const socket = this.socket as { setTimeout?: (m: number, cb?: () => void) => void } | null;
    socket?.setTimeout?.(msecs, callback);
    return this;
  }

  /** Batching hints. Present because programs call them; nothing to batch. */
  cork(): void {}
  uncork(): void {}
}

export class ServerResponse extends OutgoingMessage {
  statusCode = 200;
  statusMessage: string | undefined;

  #version: string;

  constructor(request: {
    httpVersionMajor: number;
    httpVersionMinor: number;
    method: string | null;
  }) {
    super();
    this.#version = `HTTP/${request.httpVersionMajor}.${request.httpVersionMinor}`;
    // HTTP/1.0 has no chunked encoding, so a response with no declared length
    // has to be delimited by closing the connection.
    this.useChunkedEncodingByDefault =
      request.httpVersionMajor > 1 ||
      (request.httpVersionMajor === 1 && request.httpVersionMinor >= 1);
    this.sendDate = true;
  }

  /**
   * Set the status and headers in one call.
   *
   * Headers given here are applied *over* anything already set, which is how a
   * handler can have defaults and still override them at the last moment.
   */
  writeHead(
    statusCode: number,
    statusMessage?: string | Record<string, string | number | string[]> | string[],
    headers?: Record<string, string | number | string[]> | string[],
  ): this {
    if (this.headersSent) throw new ERR_HTTP_HEADERS_SENT("write");

    let message = statusMessage;
    let fields = headers;
    if (typeof message !== "string" && message !== undefined) {
      fields = message;
      message = undefined;
    }

    this.statusCode = statusCode;
    if (message !== undefined) this.statusMessage = message;

    if (Array.isArray(fields)) {
      // The flat `[name, value, name, value]` form, which is what a proxy
      // forwarding raw headers already has.
      for (let i = 0; i < fields.length; i += 2) {
        this.setHeader(fields[i] as string, fields[i + 1] as string);
      }
    } else if (fields) {
      for (const [name, value] of Object.entries(fields)) this.setHeader(name, value);
    }

    this._implicitHeader();
    return this;
  }

  protected override _implicitHeader(): void {
    const message = this.statusMessage ?? STATUS_CODES[this.statusCode] ?? "unknown";
    this.statusLine = `${this.#version} ${this.statusCode} ${message}`;
  }

  /** Send `100 Continue`, for a client that asked whether it may send a body. */
  writeContinue(): void {
    this.socket?.write(`${this.#version} 100 Continue\r\n\r\n`, "latin1");
  }

  writeProcessing(): void {
    this.socket?.write(`${this.#version} 102 Processing\r\n\r\n`, "latin1");
  }
}
