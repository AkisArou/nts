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
import { captureRejectionSymbol, EventEmitter } from "../../events/src/main.ts";
import { getDefaultHighWaterMark } from "../../stream/src/state.ts";
import { nextTick } from "../../internal/tick.ts";
import {
  ERR_HTTP_BODY_NOT_ALLOWED,
  ERR_HTTP_CONTENT_LENGTH_MISMATCH,
  ERR_HTTP_HEADERS_SENT,
  ERR_HTTP_INVALID_HEADER_VALUE,
  ERR_HTTP_INVALID_STATUS_CODE,
  ERR_HTTP_TRAILER_INVALID,
  ERR_INVALID_CHAR,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_HTTP_TOKEN,
  ERR_METHOD_NOT_IMPLEMENTED,
  ERR_STREAM_ALREADY_FINISHED,
  ERR_STREAM_DESTROYED,
  ERR_STREAM_NULL_VALUES,
  ERR_STREAM_WRITE_AFTER_END,
} from "../../internal/errors.ts";
import {
  validateInteger,
  validateLinkHeaderValue,
  validateObject,
} from "../../internal/validators.ts";
import { STATUS_CODES } from "./status.ts";

/** As much of a socket as an outgoing message uses. */
export interface OutgoingSocket {
  write(
    chunk: Buffer | string,
    encoding?: string | ((error?: unknown) => void) | null,
    callback?: (error?: unknown) => void,
  ): boolean;
  end(
    chunk?: Buffer | string,
    encoding?: string | ((error?: unknown) => void) | null,
    callback?: (error?: unknown) => void,
  ): unknown;
  destroy(error?: unknown, callback?: (error?: unknown) => void): unknown;
  writable?: boolean;
  on<Args extends unknown[]>(event: string | symbol, listener: (...args: Args) => unknown): unknown;
  once<Args extends unknown[]>(
    event: string | symbol,
    listener: (...args: Args) => unknown,
  ): unknown;
  removeListener<Args extends unknown[]>(
    event: string | symbol,
    listener: (...args: Args) => unknown,
  ): unknown;
  setTimeout(msecs: number, callback?: () => void): unknown;
  setNoDelay(enable?: boolean): unknown;
  setKeepAlive(enable?: boolean, initialDelay?: number): unknown;
  cork?(): void;
  uncork?(): void;
  readonly connecting?: boolean;
  readonly destroyed?: boolean;
  readonly errored?: unknown;
  readonly writableCorked?: number;
  readonly writableHighWaterMark?: number;
  readonly writableLength?: number;
}

type WriteCallback = (error?: unknown) => void;
type EndCallback = (error?: unknown) => void;

interface PendingWrite {
  chunk: Buffer | string;
  encoding: string | undefined;
  callback: WriteCallback | undefined;
}

/** Internal options supplied while a server constructs one response. */
export interface OutgoingMessageOptions {
  highWaterMark?: number | null | undefined;
  rejectNonStandardBodyWrites?: boolean | undefined;
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
const STRICT_HEADER_CHAR = /[^\t\x20-\x7e\x80-\xff]/;
const LENIENT_HEADER_CHAR = /[\x00\x0a\x0d]|[^\x00-\xff]/;
const RESPONSE_VERSION = "HTTP/1.1";

export type OutgoingHeaderValue = string | number | readonly string[];
export type OutgoingHeaders = Record<string, OutgoingHeaderValue>;
export type OutgoingHeaderPair = readonly [string, OutgoingHeaderValue];
export type OutgoingHeaderArray = readonly (OutgoingHeaderValue | OutgoingHeaderPair)[];
export type ResponseHeaders = OutgoingHeaders | OutgoingHeaderArray;
export interface OutgoingHeaderCollection extends Iterable<readonly [string, OutgoingHeaderValue]> {
  keys(): Iterable<string>;
  get(name: string): OutgoingHeaderValue | null | undefined;
}
export type InformationHeaderValue = OutgoingHeaderValue | null | undefined;
export type InformationHeaderPair = readonly [string, InformationHeaderValue];
export type InformationHeaders =
  | Record<string, InformationHeaderValue>
  | readonly InformationHeaderValue[]
  | readonly InformationHeaderPair[];
export type EarlyHints = Record<string, string | string[] | null | undefined>;
type TrailerEntries = ReadonlyArray<readonly [string, string]>;

function isTrailerEntries(headers: OutgoingHeaders | TrailerEntries): headers is TrailerEntries {
  return Array.isArray(headers);
}

function isHeaderPair(value: unknown): value is readonly [unknown, unknown] {
  return Array.isArray(value) && value.length >= 2;
}

function responseHeadersAreArray(headers: ResponseHeaders): headers is OutgoingHeaderArray {
  return Array.isArray(headers);
}

function isOutgoingHeaderCollection(value: unknown): value is OutgoingHeaderCollection {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return (
    "keys" in value &&
    typeof value.keys === "function" &&
    "get" in value &&
    typeof value.get === "function" &&
    Symbol.iterator in value &&
    typeof value[Symbol.iterator] === "function"
  );
}

function validateOutgoingHeaderValue(
  value: unknown,
  headers: readonly unknown[],
): asserts value is OutgoingHeaderValue {
  if (typeof value === "string" || typeof value === "number") return;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== "string") throw new ERR_INVALID_ARG_VALUE("headers", headers);
    }
    return;
  }
  throw new ERR_INVALID_ARG_VALUE("headers", headers);
}

function processInformationHeader(name: unknown, value: unknown, lenient: boolean): string {
  validateHeaderName(name);
  validateHeaderValue(name, value, lenient);
  return `${name}: ${value}\r\n`;
}

function serializeHeader(
  name: string,
  value: OutgoingHeaderValue,
  uniqueHeaders: ReadonlySet<string> | null,
): string {
  if (!Array.isArray(value)) return `${name}: ${value}\r\n`;
  const lowerName = name.toLowerCase();
  if ((lowerName === "cookie" && value.length >= 2) || uniqueHeaders?.has(lowerName) === true) {
    return `${name}: ${value.join("; ")}\r\n`;
  }
  let serialized = "";
  for (const entry of value) serialized += `${name}: ${entry}\r\n`;
  return serialized;
}

export function parseUniqueHeadersOption(
  headers: readonly string[] | undefined,
): ReadonlySet<string> | null {
  if (!Array.isArray(headers)) return null;
  const uniqueHeaders = new Set<string>();
  for (const header of headers) uniqueHeaders.add(header.toLowerCase());
  return uniqueHeaders;
}

export function checkIsHttpToken(value: string): boolean {
  return value.length > 0 && TOKEN.test(value);
}

export function checkInvalidHeaderChar(value: unknown, lenient = false): boolean {
  if (typeof value !== "string") return false;
  return (lenient ? LENIENT_HEADER_CHAR : STRICT_HEADER_CHAR).test(value);
}

export function validateHeaderName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !checkIsHttpToken(name)) {
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
export function validateHeaderValue(name: string, value: unknown, lenient = false): void {
  if (value === undefined) {
    throw new ERR_HTTP_INVALID_HEADER_VALUE(value, name);
  }
  if (checkInvalidHeaderChar(String(value), lenient)) {
    throw new ERR_INVALID_CHAR("header content", name);
  }
}

function destroyOnRejection(this: OutgoingMessage, error: unknown): void {
  this.destroy(error);
}

export class OutgoingMessage extends EventEmitter {
  #socket: OutgoingSocket | null = null;
  #lenientHeaderValues = false;
  /** Fixed typed representation of node's private `kHighWaterMark` slot. */
  readonly _highWaterMark: number;
  #needDrain = false;
  #corked = 0;
  #errored: unknown = null;
  #flushError: unknown = null;
  #endCallbacks: EndCallback[] = [];
  #rejectNonStandardBodyWrites: boolean;

  readonly #onSocketDrain = (): void => {
    if (this.#needDrain && this.writableLength === 0 && !this.destroyed && !this.finished) {
      this.#needDrain = false;
      this.emit("drain");
    }
  };

  readonly #onSocketClose = (): void => {
    this._emitClose();
  };

  readonly #onFlushed = (error?: unknown): void => {
    this.#completeFlush(error);
  };

  constructor(options: OutgoingMessageOptions = {}) {
    super();
    this._highWaterMark = options.highWaterMark ?? getDefaultHighWaterMark(false);
    this.#rejectNonStandardBodyWrites = options.rejectNonStandardBodyWrites ?? false;
  }

  override [captureRejectionSymbol] = destroyOnRejection;

  /**
   * Output written before there was a socket to write it to.
   *
   * A client builds its request and calls `end()` immediately, but the
   * connection is not open yet -- it arrives a tick later, or much later if
   * the agent is at its limit and the request had to queue. Without this the
   * head is written to nothing and the request never leaves.
   */
  #pending: PendingWrite[] = [];
  #pendingSize = 0;

  get socket(): OutgoingSocket | null {
    return this.#socket;
  }

  set socket(value: OutgoingSocket | null) {
    const previous = this.#socket;
    if (previous === value) return;
    if (previous !== null) {
      this.#removeSocketLifecycle(previous);
      for (let index = 0; index < this.#corked; index++) previous.uncork?.();
    }

    this.#socket = value;
    if (value === null) return;

    if (typeof value.on === "function") value.on("drain", this.#onSocketDrain);
    if (typeof value.once === "function") value.once("close", this.#onSocketClose);
    for (let index = 0; index < this.#corked; index++) value.cork?.();

    if (this.#pending.length > 0) {
      const queued = this.#pending;
      this.#pending = [];
      this.#pendingSize = 0;
      for (const write of queued) {
        if (value.write(write.chunk, write.encoding, write.callback) === false) {
          this.#needDrain = true;
        }
      }
    }
  }

  #removeSocketLifecycle(socket: OutgoingSocket): void {
    if (typeof socket.removeListener === "function") {
      socket.removeListener("drain", this.#onSocketDrain);
      socket.removeListener("close", this.#onSocketClose);
    }
  }

  /**
   * Release HTTP's transport listeners while retaining the public socket
   * reference. Upgrade consumers receive that same socket, but from this
   * point its data, errors, and backpressure belong to the new protocol.
   */
  protected _handoffSocket(socket: OutgoingSocket): void {
    if (this.#socket !== socket) return;
    this.#removeSocketLifecycle(socket);
    for (let index = 0; index < this.#corked; index++) socket.uncork?.();
    this.#corked = 0;
  }

  get connection(): OutgoingSocket | null {
    return this.socket;
  }

  set connection(value: OutgoingSocket | null) {
    this.socket = value;
  }

  /** Internal fixed-layout validation policy selected by client/server options. */
  _setHeaderValidation(lenient: boolean): void {
    this.#lenientHeaderValues = lenient;
  }

  protected _isLenientHeaderValidation(): boolean {
    return this.#lenientHeaderValues;
  }

  /** Select fields whose array values serialize as one semicolon-delimited line. */
  _setUniqueHeaders(headers: ReadonlySet<string> | null): void {
    this.#uniqueHeaders = headers;
  }

  /** Write, or hold it until there is somewhere to write it. */
  protected _writeRaw(
    chunk: Buffer | string,
    encoding?: string,
    callback?: WriteCallback,
  ): boolean {
    if (this.#socket === null) {
      this.#pending.push({ chunk, encoding, callback });
      this.#pendingSize +=
        typeof chunk === "string" ? Buffer.byteLength(chunk, encoding ?? "utf8") : chunk.length;
      return this.#pendingSize < this._highWaterMark;
    }
    return this.#socket.write(chunk, encoding, callback) !== false;
  }

  /** Node's internal raw-send entry point, also used by legacy consumers. */
  _send(
    chunk: Buffer | string,
    encoding?: string | null,
    callback?: WriteCallback,
    _byteLength?: number,
  ): boolean {
    this.flushHeaders();
    return this._writeRaw(chunk, encoding ?? undefined, callback);
  }

  /** Whether the head has gone out and the headers are therefore fixed. */
  headersSent = false;
  finished = false;
  writableEnded = false;
  writableFinished = false;
  destroyed = false;

  /** Legacy Node field: ending an HTTP message does not make this false. */
  writable = true;

  /** Fixed legacy fields used by `stream.finished()` to identify this type. */
  _closed = false;
  _defaultKeepAlive = true;
  _keepAliveTimeout = 0;
  _removedConnection = false;
  _removedContLen = false;
  _removedTE = false;

  /** Set by the server or the client before anything is written. */
  shouldKeepAlive = true;
  maxRequestsOnConnectionReached = false;
  _maxRequestsPerSocket: number | null = 0;
  useChunkedEncodingByDefault = true;
  protected keepAliveWithoutFramingWhenEmpty = false;
  sendDate = false;
  chunkedEncoding = false;
  strictContentLength = false;

  /** Lowercased name to `[originalName, value]`. */
  protected headersMap = new Map<string, [string, OutgoingHeaderValue]>();
  #rawHeaderPairs: ReadonlyArray<readonly [string, OutgoingHeaderValue]> | null = null;
  #trailer = "";
  #uniqueHeaders: ReadonlySet<string> | null = null;

  /** Filled in by a subclass: the status line or the request line. */
  protected statusLine = "";

  /** Serialized head waiting to be written with the first body bytes. */
  #head: string | null = null;
  #headerFlushed = false;
  #automaticContentLength: number | undefined;

  /**
   * Whether this message can carry a body at all.
   *
   * A `204` and the reply to a `HEAD` cannot. The distinction matters for
   * framing: "no `Content-Length` and no chunking" means "read until the
   * connection closes" only for a message that *may* have a body. For one
   * that cannot, it means the body is empty.
   */
  protected hasBody = true;

  #ended = false;
  #bodyWriteStarted = false;
  #bytesWritten = 0;

  #declaredContentLength(): number | undefined {
    const value = this.getHeader("content-length");
    if (value === undefined) return this.#automaticContentLength;
    if (Array.isArray(value)) return undefined;
    const length = Number(value);
    return Number.isFinite(length) ? length : undefined;
  }

  get closed(): boolean {
    return this._closed;
  }

  get errored(): unknown {
    return this.#errored;
  }

  get writableObjectMode(): boolean {
    return false;
  }

  get writableHighWaterMark(): number {
    return this.#socket?.writableHighWaterMark ?? this._highWaterMark;
  }

  get writableLength(): number {
    return this.#pendingSize + (this.#socket?.writableLength ?? 0);
  }

  get writableCorked(): number {
    return this.#corked;
  }

  get writableNeedDrain(): boolean {
    return !this.destroyed && !this.finished && this.#needDrain;
  }

  /** Approximate bytes held before a socket is assigned. */
  get outputSize(): number {
    return this.#pendingSize;
  }

  setHeader(name: string, value: OutgoingHeaderValue): this {
    if (this.headersSent) throw new ERR_HTTP_HEADERS_SENT("set");
    validateHeaderName(name);
    validateHeaderValue(name, value, this.#lenientHeaderValues);
    this.headersMap.set(name.toLowerCase(), [name, value]);
    return this;
  }

  /** Replace fields from a WHATWG Headers or Map collection. */
  setHeaders(headers: OutgoingHeaderCollection): this {
    if (this.headersSent) throw new ERR_HTTP_HEADERS_SENT("set");
    if (!isOutgoingHeaderCollection(headers)) {
      throw new ERR_INVALID_ARG_TYPE("headers", ["Headers", "Map"], headers);
    }

    let cookies: string[] | null = null;
    for (const [name, value] of headers) {
      if (name === "set-cookie") {
        if (cookies === null) cookies = [];
        if (Array.isArray(value)) {
          for (const cookie of value) cookies.push(cookie);
        } else {
          cookies.push(String(value));
        }
      } else {
        this.setHeader(name, value);
      }
    }
    if (cookies !== null) this.setHeader("set-cookie", cookies);
    return this;
  }

  appendHeader(name: string, value: OutgoingHeaderValue): this {
    if (this.headersSent) throw new ERR_HTTP_HEADERS_SENT("append");
    validateHeaderName(name);
    validateHeaderValue(name, value, this.#lenientHeaderValues);

    const key = name.toLowerCase();
    const current = this.headersMap.get(key);
    if (current === undefined) {
      this.headersMap.set(key, [name, value]);
      return this;
    }

    const previous = current[1];
    const next = Array.isArray(previous) ? previous.slice() : [String(previous)];
    if (Array.isArray(value)) {
      for (const entry of value) next.push(entry);
    } else {
      next.push(String(value));
    }
    this.headersMap.set(key, [current[0], next]);
    return this;
  }

  getHeader(name: string): OutgoingHeaderValue | undefined {
    if (typeof name !== "string") {
      throw new ERR_INVALID_ARG_TYPE("name", "string", name);
    }
    return this.headersMap.get(name.toLowerCase())?.[1];
  }

  /** Every header, keyed by lowercased name. A copy: mutating it does nothing. */
  getHeaders(): OutgoingHeaders {
    // NTS records have no prototype, so `{}` has Node's intended dictionary
    // semantics once compiled.
    const out: OutgoingHeaders = {};
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
    const lowerName = name.toLowerCase();
    this.headersMap.delete(lowerName);
    // `Date` is synthesized only when the head is built, so deleting its
    // current map entry is not enough to honor an explicit removal.
    if (lowerName === "date") this.sendDate = false;
    else if (lowerName === "connection") this._removedConnection = true;
    else if (lowerName === "content-length") this._removedContLen = true;
    else if (lowerName === "transfer-encoding") this._removedTE = true;
  }

  /**
   * Fields sent *after* the body, which only chunked encoding can carry.
   *
   * They exist for values that are not known until the body is finished -- a
   * checksum, a signature -- and they are dropped without chunked encoding
   * because there is nowhere to put them.
   */
  addTrailers(headers: OutgoingHeaders | TrailerEntries): void {
    let trailer = "";
    if (isTrailerEntries(headers)) {
      for (const [name, value] of headers) trailer += this.#serializeTrailer(name, value);
    } else {
      for (const [name, value] of Object.entries(headers)) {
        trailer += this.#serializeTrailer(name, value);
      }
    }
    this.#trailer = trailer;
  }

  #serializeTrailer(name: string, value: OutgoingHeaderValue): string {
    validateHeaderName(name);
    validateHeaderValue(name, value, this.#lenientHeaderValues);
    return serializeHeader(name, value, this.#uniqueHeaders);
  }

  /** Written by a subclass before the headers, as the first line. */
  protected _implicitHeader(): void {
    throw new ERR_METHOD_NOT_IMPLEMENTED("_implicitHeader()");
  }

  /** Preserve an already validated raw header sequence exactly on the wire. */
  protected _storeRawHeaderPairs(
    pairs: ReadonlyArray<readonly [string, OutgoingHeaderValue]>,
  ): void {
    if (this.headersSent) throw new ERR_HTTP_HEADERS_SENT("render");
    this.#rawHeaderPairs = pairs;
    this.prepareHeaders();
  }

  /**
   * Decide the framing and send the head.
   *
   * Nothing may change the headers after this, which is why `setHeader` throws
   * once it has run: the length has been declared and the reader is counting.
   */
  protected prepareHeaders(): void {
    if (this.headersSent) return;
    if (!this.statusLine) this._implicitHeader();
    if (!this.statusLine) return;

    const declared = this.headersMap.get("content-length");
    const encoding = this.headersMap.get("transfer-encoding");
    const connection = this.headersMap.get("connection");
    const trailerHeader = this.headersMap.get("trailer");
    let addChunkedHeader = false;
    let automaticHeaders = "";

    // The header is not merely text on the wire; it controls ownership of the
    // socket after this message. Without this, an explicit `Connection:
    // close` response is nevertheless returned to the keep-alive path and a
    // graceful `server.close(callback)` can wait forever for it.
    if (connection !== undefined) {
      const connectionValue = String(connection[1]).toLowerCase();
      if (connectionValue.includes("close")) this.shouldKeepAlive = false;
      else if (connectionValue.includes("keep-alive")) this.shouldKeepAlive = true;
    }

    if (!this.hasBody) {
      this.chunkedEncoding = false;
      if (encoding && String(encoding[1]).toLowerCase().includes("chunked")) {
        // A zero chunk is forbidden for 1xx/204/304 and HEAD responses. Keep
        // the caller's explicit field but close the connection so no later
        // response can be mistaken for a chunk body.
        this.shouldKeepAlive = false;
      }
    } else if (declared !== undefined || this.#automaticContentLength !== undefined) {
      this.chunkedEncoding = false;
    } else if (encoding && String(encoding[1]).toLowerCase().includes("chunked")) {
      this.chunkedEncoding = true;
    } else if (this.useChunkedEncodingByDefault && !this._removedTE) {
      this.chunkedEncoding = true;
      addChunkedHeader = true;
    } else if (!this.keepAliveWithoutFramingWhenEmpty || this.#bodyWriteStarted) {
      // No length and no chunking on a message that may have a body: it ends
      // when the connection does, so the connection cannot be reused.
      this.shouldKeepAlive = false;
    }

    if (!this.chunkedEncoding && trailerHeader !== undefined) {
      throw new ERR_HTTP_TRAILER_INVALID();
    }

    if (this.sendDate && !this.headersMap.has("date")) {
      automaticHeaders += `Date: ${new Date().toUTCString()}\r\n`;
    }

    if (!this._removedConnection && !this.headersMap.has("connection")) {
      const connection =
        this.shouldKeepAlive && !this.maxRequestsOnConnectionReached ? "keep-alive" : "close";
      automaticHeaders += `Connection: ${connection}\r\n`;
    }

    if (
      this.shouldKeepAlive &&
      !this.maxRequestsOnConnectionReached &&
      this._defaultKeepAlive &&
      this._keepAliveTimeout > 0 &&
      !this.headersMap.has("keep-alive")
    ) {
      const maximum = this._maxRequestsPerSocket;
      const max = typeof maximum === "number" && (maximum | 0) > 0 ? `, max=${maximum}` : "";
      automaticHeaders += `Keep-Alive: timeout=${Math.floor(this._keepAliveTimeout / 1000)}${max}\r\n`;
    }

    if (addChunkedHeader) {
      automaticHeaders += "Transfer-Encoding: chunked\r\n";
    } else if (declared === undefined && this.#automaticContentLength !== undefined) {
      automaticHeaders += `Content-Length: ${this.#automaticContentLength}\r\n`;
    }

    let head = `${this.statusLine}\r\n`;
    const rawHeaderPairs = this.#rawHeaderPairs;
    if (rawHeaderPairs === null) {
      for (const entry of this.headersMap.values()) {
        head += serializeHeader(entry[0], entry[1], this.#uniqueHeaders);
      }
    } else {
      const rawNames = new Set<string>();
      for (const entry of rawHeaderPairs) {
        rawNames.add(entry[0].toLowerCase());
        head += serializeHeader(entry[0], entry[1], this.#uniqueHeaders);
      }
      for (const [name, entry] of this.headersMap) {
        if (!rawNames.has(name)) {
          head += serializeHeader(entry[0], entry[1], this.#uniqueHeaders);
        }
      }
      this.#rawHeaderPairs = null;
    }
    head += automaticHeaders;
    head += "\r\n";

    this.#head = head;
    this.headersSent = true;
  }

  flushHeaders(): void {
    this.prepareHeaders();
    if (this.#headerFlushed) return;
    const head = this.#head;
    this.#headerFlushed = true;
    if (head !== null) this._writeRaw(head, "latin1");
  }

  write(
    chunk: string | Uint8Array,
    encoding?: string | WriteCallback,
    callback?: WriteCallback,
  ): boolean {
    let encodingName: string | undefined;
    if (typeof encoding === "function") callback = encoding;
    else encodingName = encoding;

    if (chunk === null) throw new ERR_STREAM_NULL_VALUES();
    if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
      throw new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "Uint8Array"], chunk);
    }

    if (this.#ended) {
      const error = new ERR_STREAM_WRITE_AFTER_END();
      nextTick(() => {
        if (callback !== undefined) callback(error);
        if (!this.destroyed) this.emit("error", error);
      });
      return false;
    }

    if (this.destroyed) {
      const error = new ERR_STREAM_DESTROYED("write");
      if (callback !== undefined) nextTick(callback, error);
      return false;
    }

    if (!this.hasBody) {
      if (this.#rejectNonStandardBodyWrites) throw new ERR_HTTP_BODY_NOT_ALLOWED();
      this.flushHeaders();
      if (callback) nextTick(callback);
      return true;
    }

    const buffer =
      typeof chunk === "string"
        ? Buffer.from(chunk, encodingName ?? "utf8")
        : chunk instanceof Buffer
          ? chunk
          : Buffer.from(chunk);

    if (buffer.length === 0) {
      // A zero-length chunk is not "nothing" in chunked encoding -- it is the
      // terminator -- so it is dropped rather than framed. It still commits
      // the head, just as a non-empty first write would.
      this.flushHeaders();
      if (callback) nextTick(callback);
      return true;
    }

    this.#bodyWriteStarted = true;
    this.flushHeaders();

    if (this.strictContentLength) {
      const declared = this.#declaredContentLength();
      if (
        declared !== undefined &&
        !this.chunkedEncoding &&
        !this.hasHeader("transfer-encoding") &&
        this.#bytesWritten + buffer.length > declared
      ) {
        throw new ERR_HTTP_CONTENT_LENGTH_MISMATCH(this.#bytesWritten + buffer.length, declared);
      }
    }
    this.#bytesWritten += buffer.length;

    let ok: boolean;
    if (this.chunkedEncoding) {
      ok = this._writeRaw(`${buffer.length.toString(16)}\r\n`, "latin1");
      if (!this._writeRaw(buffer)) ok = false;
      // Completion belongs to the complete framed chunk, not merely to the
      // act of queueing its payload. In particular, a callback that destroys
      // the socket must not run before the trailing CRLF reached the native
      // write queue.
      if (!this._writeRaw("\r\n", "latin1", callback)) ok = false;
    } else {
      ok = this._writeRaw(buffer, undefined, callback);
    }
    if (!ok) this.#needDrain = true;
    return ok;
  }

  end(
    chunk?: string | Uint8Array | null | EndCallback,
    encoding?: string | EndCallback,
    callback?: EndCallback,
  ): this {
    let body: string | Uint8Array | null | undefined;
    let encodingName: string | undefined;
    if (typeof chunk === "function") {
      callback = chunk;
    } else {
      body = chunk;
      if (typeof encoding === "function") callback = encoding;
      else encodingName = encoding;
    }
    if (body === null) body = undefined;
    if (body !== undefined && typeof body !== "string" && !(body instanceof Uint8Array)) {
      throw new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "Uint8Array"], body);
    }

    if (this.#ended) {
      if (body !== undefined && body !== "") {
        this.write(body, encodingName, callback);
      } else if (callback !== undefined) {
        this.#queueEndCallback(callback);
      }
      return this;
    }

    if (
      !this.headersSent &&
      this.hasBody &&
      this.useChunkedEncodingByDefault &&
      !this._removedContLen &&
      !this.hasHeader("content-length") &&
      !this.hasHeader("transfer-encoding") &&
      this.#trailer.length === 0
    ) {
      const length =
        body === undefined
          ? 0
          : typeof body === "string"
            ? Buffer.byteLength(body, encodingName ?? "utf8")
            : body.byteLength;
      this.#automaticContentLength = length;
    }

    if (body !== undefined && this.strictContentLength) {
      const declared = this.#declaredContentLength();
      const bodyLength =
        typeof body === "string"
          ? Buffer.byteLength(body, encodingName ?? "utf8")
          : body.byteLength;
      if (
        declared !== undefined &&
        !this.chunkedEncoding &&
        !this.hasHeader("transfer-encoding") &&
        this.#bytesWritten + bodyLength !== declared
      ) {
        throw new ERR_HTTP_CONTENT_LENGTH_MISMATCH(this.#bytesWritten + bodyLength, declared);
      }
    }

    if (callback !== undefined) this.#endCallbacks.push(callback);

    if (body !== undefined) this.write(body, encodingName);
    else this.flushHeaders();

    if (this.strictContentLength) {
      const declared = this.#declaredContentLength();
      if (
        declared !== undefined &&
        !this.chunkedEncoding &&
        !this.hasHeader("transfer-encoding") &&
        this.#bytesWritten !== declared
      ) {
        throw new ERR_HTTP_CONTENT_LENGTH_MISMATCH(this.#bytesWritten, declared);
      }
    }

    this.#ended = true;
    this.writableEnded = true;
    this.finished = true;

    if (this.chunkedEncoding) {
      const tail = `0\r\n${this.#trailer}\r\n`;
      this._writeRaw(tail, "latin1", this.#onFlushed);
    } else {
      // A zero-byte write is an ordering sentinel. Its callback runs only
      // after every preceding head/body write has completed, so `finish` and
      // the end callback cannot make an undrained socket eligible for reuse.
      this._writeRaw("", undefined, this.#onFlushed);
    }

    return this;
  }

  destroy(error?: unknown): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.#errored = error;
    const socket = this.socket;
    if (socket !== null) {
      socket.destroy(error);
    } else {
      const finalError = error ?? new ERR_STREAM_DESTROYED("write");
      const pending = this.#pending;
      this.#pending = [];
      this.#pendingSize = 0;
      for (const write of pending) {
        if (write.callback !== undefined) nextTick(write.callback, finalError);
      }
      if (this.#endCallbacks.length > 0) this.#completeFlush(finalError);
      nextTick(() => this._emitClose());
    }
    return this;
  }

  setTimeout(msecs: number, callback?: () => void): this {
    if (callback !== undefined) this.on("timeout", callback);
    const socket = this.socket;
    if (socket === null) {
      this.once("socket", (connected: OutgoingSocket) => connected.setTimeout(msecs));
    } else {
      socket.setTimeout(msecs);
    }
    return this;
  }

  cork(): void {
    this.#corked += 1;
    this.socket?.cork?.();
  }

  uncork(): void {
    if (this.#corked === 0) return;
    this.#corked -= 1;
    this.socket?.uncork?.();
  }

  /** Mark a socket-backed message closed exactly once. */
  protected _emitClose(): void {
    if (this._closed) return;
    this._closed = true;
    this.destroyed = true;
    const socket = this.#socket;
    if (socket !== null) this.#removeSocketLifecycle(socket);
    if (!this.writableFinished && this.#endCallbacks.length > 0) {
      this.#completeFlush(this.#flushError ?? new ERR_STREAM_DESTROYED("end"));
    }
    this.emit("close");
  }

  #queueEndCallback(callback: EndCallback): void {
    if (this.writableFinished) {
      callback(new ERR_STREAM_ALREADY_FINISHED("end"));
    } else if (this.#flushError !== null) {
      nextTick(callback, this.#flushError);
    } else {
      this.#endCallbacks.push(callback);
    }
  }

  #completeFlush(error?: unknown): void {
    if (this.writableFinished || this.#flushError !== null) return;

    const socketError = this.#socket?.errored;
    const failure = error ?? socketError;
    const callbacks = this.#endCallbacks;
    this.#endCallbacks = [];
    if (failure !== undefined && failure !== null) {
      this.#flushError = failure;
      for (let index = 0; index < callbacks.length; index++) {
        const endCallback = callbacks[index];
        if (endCallback !== undefined) endCallback(failure);
      }
      return;
    }

    this.writableFinished = true;
    for (let index = 0; index < callbacks.length; index++) {
      const endCallback = callbacks[index];
      if (endCallback !== undefined) endCallback(null);
    }
    this.emit("finish");
  }
}

export class ServerResponse extends OutgoingMessage {
  statusCode = 200;
  statusMessage: string | undefined;
  _sent100 = false;
  _expect_continue = false;

  constructor(
    request: {
      httpVersionMajor: number;
      httpVersionMinor: number;
      method: string | null;
    },
    options: OutgoingMessageOptions = {},
  ) {
    super(options);
    // HTTP/1.0 has no chunked encoding, so a response with no declared length
    // has to be delimited by closing the connection.
    this.useChunkedEncodingByDefault =
      request.httpVersionMajor > 1 ||
      (request.httpVersionMajor === 1 && request.httpVersionMinor >= 1);
    this.hasBody = request.method !== "HEAD";
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
    statusMessage?: string | ResponseHeaders,
    headers?: ResponseHeaders,
  ): this {
    if (this.headersSent) throw new ERR_HTTP_HEADERS_SENT("write");

    const originalStatusCode: unknown = statusCode;
    statusCode |= 0;
    if (statusCode < 100 || statusCode > 999) {
      throw new ERR_HTTP_INVALID_STATUS_CODE(originalStatusCode);
    }

    let message = statusMessage;
    let fields = headers;
    if (typeof message !== "string" && message !== undefined) {
      fields = message;
      message = undefined;
    }

    this.statusCode = statusCode;
    if ((statusCode >= 100 && statusCode < 200) || statusCode === 204 || statusCode === 304) {
      this.hasBody = false;
    }
    if (message !== undefined) {
      this.statusMessage = message;
    } else if (!this.statusMessage) {
      this.statusMessage = STATUS_CODES[statusCode] ?? "unknown";
    }

    if (fields !== undefined && responseHeadersAreArray(fields)) {
      const values: readonly unknown[] = fields;
      if (isHeaderPair(values[0])) {
        for (const value of values) {
          if (!isHeaderPair(value)) {
            throw new ERR_INVALID_ARG_VALUE("headers", fields);
          }
          validateHeaderName(value[0]);
          validateOutgoingHeaderValue(value[1], values);
          this.removeHeader(value[0]);
        }
        for (const value of values) {
          if (!isHeaderPair(value)) {
            throw new ERR_INVALID_ARG_VALUE("headers", fields);
          }
          validateHeaderName(value[0]);
          validateOutgoingHeaderValue(value[1], values);
          this.appendHeader(value[0], value[1]);
        }
      } else {
        // The flat `[name, value, name, value]` form, which is what a
        // proxy forwarding raw headers already has.
        if (values.length % 2 !== 0) {
          throw new ERR_INVALID_ARG_VALUE("headers", fields);
        }

        // A raw list overrides progressively set fields, but repeated entries
        // in that list are deliberate and must remain separate lines.
        for (let index = 0; index < values.length; index += 2) {
          const name = values[index];
          const value = values[index + 1];
          validateHeaderName(name);
          validateOutgoingHeaderValue(value, values);
          this.removeHeader(name);
        }
        for (let index = 0; index < values.length; index += 2) {
          const name = values[index];
          const value = values[index + 1];
          validateHeaderName(name);
          validateOutgoingHeaderValue(value, values);
          this.appendHeader(name, value);
        }
      }
    } else if (fields) {
      for (const [name, value] of Object.entries(fields)) this.setHeader(name, value);
    }

    // If the client is still waiting for 100 Continue, it may send its body
    // after receiving this final response. The connection cannot safely carry
    // another request because those bytes would be ambiguous there.
    if (this._expect_continue && !this._sent100) this.shouldKeepAlive = false;

    this._implicitHeader();
    this.prepareHeaders();
    return this;
  }

  protected override _implicitHeader(): void {
    const message = this.statusMessage ?? STATUS_CODES[this.statusCode] ?? "unknown";
    if (checkInvalidHeaderChar(message)) throw new ERR_INVALID_CHAR("statusMessage");
    this.statusLine = `${RESPONSE_VERSION} ${this.statusCode} ${message}`;
  }

  /** Attach the connection currently carrying this response. */
  assignSocket(socket: OutgoingSocket): void {
    this.socket = socket;
    this.emit("socket", socket);
  }

  /** Release a completed response from the connection that carried it. */
  detachSocket(socket: OutgoingSocket): void {
    if (this.socket === socket) this.socket = null;
  }

  /** Complete the response-side close lifecycle after it has been detached. */
  _closeAfterFinish(): void {
    this._emitClose();
  }

  /** Send `100 Continue`, for a client that asked whether it may send a body. */
  writeContinue(callback?: () => void): void {
    this.writeInformation(100, null, callback);
    this._sent100 = true;
  }

  writeProcessing(callback?: () => void): void {
    this.writeInformation(102, null, callback);
  }

  writeInformation(
    statusCode: number,
    headers?: InformationHeaders | null,
    callback?: WriteCallback,
  ): boolean {
    if (this.headersSent) throw new ERR_HTTP_HEADERS_SENT("write");
    validateInteger(statusCode, "statusCode", 100, 199);
    if (statusCode === 101) throw new ERR_HTTP_INVALID_STATUS_CODE(statusCode);

    const statusMessage = STATUS_CODES[statusCode] ?? "unknown";
    let head = `${RESPONSE_VERSION} ${statusCode} ${statusMessage}\r\n`;
    const lenient = this._isLenientHeaderValidation();

    if (headers !== undefined && headers !== null) {
      if (Array.isArray(headers)) {
        const values: readonly unknown[] = headers;
        if (isHeaderPair(values[0])) {
          for (let index = 0; index < values.length; index++) {
            const entry: unknown = values[index];
            if (!isHeaderPair(entry)) {
              throw new ERR_INVALID_ARG_VALUE("headers", headers);
            }
            head += processInformationHeader(entry[0], entry[1], lenient);
          }
        } else {
          if (values.length % 2 !== 0) {
            throw new ERR_INVALID_ARG_VALUE("headers", headers);
          }
          for (let index = 0; index < values.length; index += 2) {
            head += processInformationHeader(values[index], values[index + 1], lenient);
          }
        }
      } else {
        validateObject(headers, "headers");
        for (const [name, value] of Object.entries(headers)) {
          head += processInformationHeader(name, value, lenient);
        }
      }
    }

    head += "\r\n";
    return this._writeRaw(head, "ascii", callback);
  }

  writeEarlyHints(hints: EarlyHints, callback?: WriteCallback): void {
    validateObject(hints, "hints");
    const linkValue: unknown = hints.link;
    if (linkValue === null || linkValue === undefined) return;

    const link = validateLinkHeaderValue(linkValue);
    if (link.length === 0) return;
    if (checkInvalidHeaderChar(link)) throw new ERR_INVALID_CHAR("header content", "Link");

    const headers: Record<string, InformationHeaderValue> = { Link: link };
    for (const [name, value] of Object.entries(hints)) {
      if (name !== "link") headers[name] = value;
    }
    this.writeInformation(103, headers, callback);
  }
}
