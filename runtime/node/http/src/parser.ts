// An HTTP/1.1 parser, to RFC 9112.
//
// Node uses llhttp, a C parser generated from a state machine. This is a
// TypeScript one with the same callback surface, and it is written here rather
// than bound because a parser is exactly the kind of thing this project should
// own: it is pure logic over bytes, it has no system call in it, and binding to
// a C library would make every conformance result a test of that library.
//
// The whole difficulty is that bytes arrive in arbitrary pieces. A header may
// be split across three reads; a chunk size may be split mid-digit. So there
// is no "parse this message" function — there is a state machine that consumes
// what it has, remembers where it was, and asks for more.
//
// Where the specification permits something and reality requires refusing it,
// the refusal is the point rather than strictness for its own sake. Two
// framings for one body — a `Content-Length` and a `Transfer-Encoding` — is
// the request-smuggling shape: a proxy and an origin server that disagree
// about which wins can be made to see two different sets of requests in one
// stream. RFC 9112 §6.1 says the length must be rejected in that case, and
// this rejects the message.

import {
  emitAfter,
  emitBefore,
  emitDestroy,
  emitInit,
  getDefaultTriggerAsyncId,
  initHooksExist,
  newAsyncId,
} from "../../internal/async-hooks.ts";
import { AsyncContextFrame } from "../../internal/async-context.ts";

const CR = 13;
const LF = 10;
const SP = 32;
const HTAB = 9;

/**
 * What the parser is reading.
 *
 * Constants and a union rather than an `enum`, because node's type-stripping
 * loader refuses `enum` -- it is the one TypeScript construct that emits code
 * rather than erasing, so a runtime that only strips types cannot run it.
 * `erasableSyntaxOnly` is the rule this profile is written under.
 */
const State = {
  StartLine: 0,
  Header: 1,
  Body: 2,
  ChunkSize: 3,
  ChunkData: 4,
  ChunkDataEnd: 5,
  Trailer: 6,
  Complete: 7,
  Upgraded: 8,
} as const;
type State = (typeof State)[keyof typeof State];

/** How the body's end is known. */
const Framing = {
  None: 0,
  ContentLength: 1,
  Chunked: 2,
  UntilClose: 3,
} as const;
type Framing = (typeof Framing)[keyof typeof Framing];

export const REQUEST = 1;
export const RESPONSE = 2;

/**
 * The methods node recognises, in its own order.
 *
 * The order is the contract: `HTTPParser.methods[n]` is how a caller turns the
 * number the parser reports back into a name.
 */
export const methods = [
  "DELETE",
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "CONNECT",
  "OPTIONS",
  "TRACE",
  "COPY",
  "LOCK",
  "MKCOL",
  "MOVE",
  "PROPFIND",
  "PROPPATCH",
  "SEARCH",
  "UNLOCK",
  "BIND",
  "REBIND",
  "UNBIND",
  "ACL",
  "REPORT",
  "MKACTIVITY",
  "CHECKOUT",
  "MERGE",
  "M-SEARCH",
  "NOTIFY",
  "SUBSCRIBE",
  "UNSUBSCRIBE",
  "PATCH",
  "PURGE",
  "MKCALENDAR",
  "LINK",
  "UNLINK",
  "SOURCE",
  "QUERY",
];

/** Public method names in Node's stable alphabetical order. */
export const METHODS: string[] = [
  "ACL",
  "BIND",
  "CHECKOUT",
  "CONNECT",
  "COPY",
  "DELETE",
  "GET",
  "HEAD",
  "LINK",
  "LOCK",
  "M-SEARCH",
  "MERGE",
  "MKACTIVITY",
  "MKCALENDAR",
  "MKCOL",
  "MOVE",
  "NOTIFY",
  "OPTIONS",
  "PATCH",
  "POST",
  "PROPFIND",
  "PROPPATCH",
  "PURGE",
  "PUT",
  "QUERY",
  "REBIND",
  "REPORT",
  "SEARCH",
  "SOURCE",
  "SUBSCRIBE",
  "TRACE",
  "UNBIND",
  "UNLINK",
  "UNLOCK",
  "UNSUBSCRIBE",
];

export interface ParserError {
  code: string;
  reason: string;
  bytesParsed: number;
}

interface CommonHeadersComplete {
  versionMajor: number;
  versionMinor: number;
  headers: string[];
  upgrade: boolean;
  shouldKeepAlive: boolean;
}

/** Request metadata passed to `onHeadersComplete`. */
export interface RequestHeadersComplete extends CommonHeadersComplete {
  type: typeof REQUEST;
  method: number;
  url: string;
  statusCode: undefined;
  statusMessage: undefined;
}

/** Response metadata passed to `onHeadersComplete`. */
export interface ResponseHeadersComplete extends CommonHeadersComplete {
  type: typeof RESPONSE;
  method: undefined;
  url: undefined;
  statusCode: number;
  statusMessage: string;
}

/** What `onHeadersComplete` is given. */
export type HeadersComplete = RequestHeadersComplete | ResponseHeadersComplete;

/**
 * A header name, lowercased for comparison.
 *
 * Field names are case-insensitive (RFC 9110 §5.1), and a parser that compared
 * them literally would miss `content-length` written as `Content-Length` --
 * which is how almost everyone writes it.
 */
function lower(value: string): string {
  return value.toLowerCase();
}

/** Whether a token is a valid field name: RFC 9110's `tchar`, and nothing else. */
function isValidFieldName(name: string): boolean {
  if (name.length === 0) return false;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    const ok =
      (c >= 0x30 && c <= 0x39) || // 0-9
      (c >= 0x41 && c <= 0x5a) || // A-Z
      (c >= 0x61 && c <= 0x7a) || // a-z
      c === 0x21 ||
      (c >= 0x23 && c <= 0x27) ||
      c === 0x2a ||
      c === 0x2b ||
      c === 0x2d ||
      c === 0x2e ||
      c === 0x5e ||
      c === 0x5f ||
      c === 0x60 ||
      c === 0x7c ||
      c === 0x7e;
    if (!ok) return false;
  }
  return true;
}

/**
 * Whether a field value is free of control characters.
 *
 * A newline inside a header value is header injection: everything after it is
 * read as a new header, or as the start of a second message.
 */
function isValidFieldValue(value: string, lenient: boolean): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (lenient) {
      if (c === CR || c === LF || c === 0 || c > 0xff) return false;
    } else if (c !== HTAB && (c < SP || c === 0x7f || c > 0xff)) {
      return false;
    }
  }
  return true;
}

const HTTP_PARSER_TYPES = ["HTTPINCOMINGMESSAGE", "HTTPCLIENTREQUEST"] as const;

interface ParserCallbackScope {
  asyncId: number;
  priorFrame: AsyncContextFrame | undefined;
}

export class HTTPParser {
  static readonly REQUEST = REQUEST;
  static readonly RESPONSE = RESPONSE;
  static readonly methods = methods;

  /** The five callbacks, assigned by the caller. */
  onMessageBegin: ((this: HTTPParser) => void) | null = null;
  onHeaders: ((this: HTTPParser, headers: string[], url: string) => void) | null = null;
  onHeadersComplete: ((this: HTTPParser, info: HeadersComplete) => number | void) | null = null;
  onBody: ((this: HTTPParser, chunk: Uint8Array) => void) | null = null;
  onMessageComplete: ((this: HTTPParser) => void) | null = null;

  #type: number = REQUEST;
  #state: State = State.StartLine;
  #framing: Framing = Framing.None;

  /** Bytes seen but not yet forming a complete line. */
  #partial = "";
  #headers: string[] = [];
  #headerBytes = 0;
  #maxHeaderSize = 80 * 1024;
  #lenientHeaderValues = false;
  #lenientTransferEncoding = false;

  #method = 0;
  #url = "";
  #statusCode = 0;
  #statusMessage = "";
  #versionMajor = 1;
  #versionMinor = 1;

  #contentLength = -1;
  #remaining = 0;
  #chunkRemaining = 0;
  #connectionUpgrade = false;
  #sawUpgrade = false;
  #upgrade = false;
  #shouldKeepAlive = true;
  #skipBody = false;
  #sawContentLength = false;
  #sawTransferEncoding = false;

  #error: ParserError | null = null;
  #bytesParsed = 0;
  #asyncId = 0;
  #triggerAsyncId = 0;
  #contextFrame: AsyncContextFrame | undefined;

  initialize(
    type: number,
    maxHeaderSize?: number,
    triggerAsyncId?: number,
    lenientHeaderValues = false,
    lenientTransferEncoding = false,
  ): void {
    this.#type = type;
    this.#maxHeaderSize = maxHeaderSize ?? 80 * 1024;
    this.#lenientHeaderValues = lenientHeaderValues;
    this.#lenientTransferEncoding = lenientTransferEncoding;

    // A parser is an asynchronous resource, and which one depends on what it
    // is parsing: node calls a request parser an HTTPINCOMINGMESSAGE and a
    // response parser an HTTPCLIENTREQUEST. They are the two ends of the same
    // connection, and a tool watching a proxy needs to tell them apart.
    //
    // Reset rather than assigned, because parsers are reused: node keeps a
    // free list, and one taken off it is starting new work under a new
    // identity with the old one reported finished.
    if (this.#asyncId > 0) emitDestroy(this.#asyncId);
    const asyncId = newAsyncId();
    const trigger = triggerAsyncId ?? getDefaultTriggerAsyncId();
    this.#asyncId = asyncId;
    this.#triggerAsyncId = trigger;
    this.#contextFrame = AsyncContextFrame.current();
    if (initHooksExist()) {
      const resourceType = type === REQUEST ? HTTP_PARSER_TYPES[0] : HTTP_PARSER_TYPES[1];
      emitInit(asyncId, resourceType, trigger, this);
    }

    this.reset();
  }

  /**
   * This parser is finished.
   *
   * Called when the connection it was parsing goes, which is the only moment
   * anyone can say so -- a parser between messages on a keep-alive connection
   * looks exactly like one that will never be used again.
   */
  free(): void {
    if (this.#asyncId <= 0) return;
    emitDestroy(this.#asyncId);
    this.#asyncId = 0;
    this.#triggerAsyncId = 0;
    this.#contextFrame = undefined;
  }

  /** Node's native parser names the same terminal operation `close`. */
  close(): void {
    this.free();
  }

  /** Enter one native-parser callback with this parser as the current work. */
  #enterCallback(): ParserCallbackScope {
    const asyncId = this.#asyncId;
    const priorFrame = AsyncContextFrame.exchange(this.#contextFrame);
    emitBefore(asyncId, this.#triggerAsyncId, this);
    return { asyncId, priorFrame };
  }

  #leaveCallback(scope: ParserCallbackScope): void {
    // A message-complete callback is allowed to free its parser. Use the id
    // captured on entry so clearing the parser cannot turn the matching
    // `after` into an event for async id zero.
    emitAfter(scope.asyncId);
    AsyncContextFrame.setCurrent(scope.priorFrame);
  }

  #callMessageBegin(): void {
    const callback = this.onMessageBegin;
    if (callback === null) return;
    const scope = this.#enterCallback();
    try {
      callback.call(this);
    } finally {
      this.#leaveCallback(scope);
    }
  }

  #callHeaders(headers: string[], url: string): void {
    const callback = this.onHeaders;
    if (callback === null) return;
    const scope = this.#enterCallback();
    try {
      callback.call(this, headers, url);
    } finally {
      this.#leaveCallback(scope);
    }
  }

  #callHeadersComplete(info: HeadersComplete): number | void {
    const callback = this.onHeadersComplete;
    if (callback === null) return undefined;
    const scope = this.#enterCallback();
    try {
      return callback.call(this, info);
    } finally {
      this.#leaveCallback(scope);
    }
  }

  #callBody(chunk: Uint8Array): void {
    const callback = this.onBody;
    if (callback === null) return;
    const scope = this.#enterCallback();
    try {
      callback.call(this, chunk);
    } finally {
      this.#leaveCallback(scope);
    }
  }

  #callMessageComplete(): void {
    const callback = this.onMessageComplete;
    if (callback === null) return;
    const scope = this.#enterCallback();
    try {
      callback.call(this);
    } finally {
      this.#leaveCallback(scope);
    }
  }

  /** Back to the start of a message, keeping the callbacks. */
  reset(): void {
    this.#state = State.StartLine;
    this.#framing = Framing.None;
    this.#partial = "";
    this.#headers = [];
    this.#headerBytes = 0;
    this.#method = 0;
    this.#url = "";
    this.#statusCode = 0;
    this.#statusMessage = "";
    this.#versionMajor = 1;
    this.#versionMinor = 1;
    this.#contentLength = -1;
    this.#remaining = 0;
    this.#chunkRemaining = 0;
    this.#connectionUpgrade = false;
    this.#sawUpgrade = false;
    this.#upgrade = false;
    this.#shouldKeepAlive = true;
    this.#skipBody = false;
    this.#sawContentLength = false;
    this.#sawTransferEncoding = false;
    this.#error = null;
    this.#bytesParsed = 0;
  }

  /**
   * A response with no body regardless of its headers.
   *
   * The reply to a `HEAD`, and a 204 or 304, carry `Content-Length` describing
   * the body the request *would* have had. A parser that believed it would
   * wait forever for bytes that are never sent.
   */
  set skipBody(value: boolean) {
    this.#skipBody = value;
  }

  get error(): ParserError | null {
    return this.#error;
  }

  #fail(code: string, reason: string): number {
    this.#error = { code, reason, bytesParsed: this.#bytesParsed };
    return -1;
  }

  /**
   * Consume as much of `data` as forms complete units.
   *
   * Returns the number of bytes consumed, or `-1` with `error` set. Anything
   * unconsumed is a partial line the caller should send again with more after
   * it -- which is why the parser keeps `#partial` rather than asking the
   * caller to buffer.
   */
  execute(data: Uint8Array): number {
    let offset = 0;
    this.#bytesParsed = 0;

    while (offset < data.length) {
      if (this.#state === State.Upgraded || this.#state === State.Complete) break;

      if (this.#state === State.Body) {
        const consumed = this.#readBody(data, offset);
        offset += consumed;
        this.#bytesParsed = offset;
        continue;
      }

      if (this.#state === State.ChunkData) {
        const consumed = this.#readChunkData(data, offset);
        offset += consumed;
        this.#bytesParsed = offset;
        continue;
      }

      // Everything else is line-oriented.
      const lineEnd = indexOfLF(data, offset);
      if (lineEnd === -1) {
        // No complete line: keep what is here and wait for more.
        const remaining = data.length - offset;
        this.#partial += decode(data.subarray(offset));
        offset = data.length;
        this.#bytesParsed = offset;
        this.#headerBytes += remaining;
        if (this.#headerBytes > this.#maxHeaderSize) {
          return this.#fail("HPE_HEADER_OVERFLOW", "Header overflow");
        }
        const partialResult = this.#validatePartialStartLine();
        if (partialResult < 0) return partialResult;
        break;
      }

      const line = this.#partial + decode(data.subarray(offset, lineEnd));
      this.#partial = "";
      this.#headerBytes += lineEnd - offset + 1;
      offset = lineEnd + 1;
      this.#bytesParsed = offset;

      // Only the line-oriented states reach here, so this bounds the headers
      // and the chunk framing but never the body.
      if (this.#headerBytes > this.#maxHeaderSize) {
        return this.#fail("HPE_HEADER_OVERFLOW", "Header overflow");
      }

      const result = this.#readLine(stripCR(line));
      if (result < 0) return result;
    }

    this.#bytesParsed = offset;
    return offset;
  }

  /** Tell the parser the connection ended, which can complete a message. */
  finish(): number {
    if (this.#state === State.Body && this.#framing === Framing.UntilClose) {
      this.#complete();
      return 0;
    }
    if (this.#state === State.StartLine && this.#partial === "") return 0;
    if (this.#state === State.Complete || this.#state === State.Upgraded) return 0;
    return this.#fail("HPE_INVALID_EOF_STATE", "Invalid EOF state");
  }

  #readLine(line: string): number {
    switch (this.#state) {
      case State.StartLine:
        // A blank line before the start line is tolerated: RFC 9112 §2.2 says
        // a robust parser should ignore at least one empty line, because some
        // clients send a stray CRLF after a previous message.
        if (line === "") return 0;
        return this.#readStartLine(line);

      case State.Header:
        if (line === "") return this.#endOfHeaders();
        return this.#readHeader(line);

      case State.ChunkSize:
        return this.#readChunkSize(line);

      case State.ChunkDataEnd:
        if (line !== "") {
          return this.#fail("HPE_INVALID_CHUNK_SIZE", "Invalid character in chunk terminator");
        }
        this.#state = State.ChunkSize;
        return 0;

      case State.Trailer:
        if (line === "") {
          if (this.#headers.length > 0) {
            const trailers = this.#headers;
            this.#headers = [];
            this.#callHeaders(trailers, "");
          }
          this.#complete();
          return 0;
        }
        // Trailers are headers, and are reported as headers.
        return this.#readHeader(line);

      default:
        return this.#fail("HPE_INVALID_CONSTANT", "Unexpected line");
    }
  }

  #readStartLine(line: string): number {
    this.#callMessageBegin();

    if (this.#type === RESPONSE) {
      // HTTP-version SP status-code SP [ reason-phrase ]
      const firstSpace = line.indexOf(" ");
      if (firstSpace === -1) return this.#fail("HPE_INVALID_CONSTANT", "Invalid status line");

      const version = line.slice(0, firstSpace);
      if (!this.#readVersion(version)) {
        return this.#fail("HPE_INVALID_VERSION", "Invalid HTTP version");
      }

      const rest = line.slice(firstSpace + 1);
      const secondSpace = rest.indexOf(" ");
      const codeText = secondSpace === -1 ? rest : rest.slice(0, secondSpace);
      if (!/^\d{3}$/.test(codeText)) {
        return this.#fail("HPE_INVALID_STATUS", "Invalid status code");
      }
      this.#statusCode = Number(codeText);
      this.#statusMessage = secondSpace === -1 ? "" : rest.slice(secondSpace + 1);
    } else {
      // method SP request-target SP HTTP-version
      const firstSpace = line.indexOf(" ");
      if (firstSpace === -1) return this.#fail("HPE_INVALID_METHOD", "Invalid request line");
      const method = line.slice(0, firstSpace);
      const index = methods.indexOf(method);
      if (index === -1) return this.#fail("HPE_INVALID_METHOD", "Invalid method");
      this.#method = index;

      const lastSpace = line.lastIndexOf(" ");
      if (lastSpace === firstSpace) {
        return this.#fail("HPE_INVALID_VERSION", "Missing HTTP version");
      }
      this.#url = line.slice(firstSpace + 1, lastSpace);
      if (this.#url.length === 0) return this.#fail("HPE_INVALID_URL", "Empty request target");
      if (!this.#readVersion(line.slice(lastSpace + 1))) {
        return this.#fail("HPE_INVALID_VERSION", "Invalid HTTP version");
      }
    }

    // Keep-alive is the default from 1.1 and must be asked for in 1.0.
    this.#shouldKeepAlive =
      this.#versionMajor > 1 || (this.#versionMajor === 1 && this.#versionMinor >= 1);
    this.#state = State.Header;
    return 0;
  }

  #validatePartialStartLine(): number {
    if (this.#state !== State.StartLine || this.#partial.length === 0) return 0;
    if (this.#type === RESPONSE) return 0;

    const firstSpace = this.#partial.indexOf(" ");
    const method = firstSpace === -1 ? this.#partial : this.#partial.slice(0, firstSpace);
    if (!isValidFieldName(method)) {
      return this.#fail("HPE_INVALID_METHOD", "Invalid method");
    }
    if (firstSpace !== -1 && methods.indexOf(method) === -1) {
      return this.#fail("HPE_INVALID_METHOD", "Invalid method");
    }
    return 0;
  }

  #readVersion(text: string): boolean {
    const match = /^HTTP\/(\d)\.(\d)$/.exec(text);
    if (!match) return false;
    this.#versionMajor = Number(match[1]);
    this.#versionMinor = Number(match[2]);
    return true;
  }

  #readHeader(line: string): number {
    // Obsolete line folding: a continuation line begins with whitespace and
    // belongs to the header before it. RFC 9112 §5.2 deprecates it and tells
    // a server to reject it, because a folded header means different things to
    // different intermediaries -- another smuggling shape.
    const first = line.charCodeAt(0);
    if (first === SP || first === HTAB) {
      return this.#fail("HPE_INVALID_HEADER_TOKEN", "Obsolete line folding");
    }

    const colon = line.indexOf(":");
    if (colon <= 0) return this.#fail("HPE_INVALID_HEADER_TOKEN", "Malformed header");

    const name = line.slice(0, colon);
    // No space is permitted before the colon. It looks harmless and is the
    // other classic smuggling vector: some parsers strip it and some do not,
    // so `Content-Length : 5` is one header to one and none to the other.
    if (name.charCodeAt(name.length - 1) === SP) {
      return this.#fail("HPE_INVALID_HEADER_TOKEN", "Whitespace before colon");
    }
    if (!isValidFieldName(name)) {
      return this.#fail("HPE_INVALID_HEADER_TOKEN", "Invalid header name");
    }

    const value = line.slice(colon + 1).trim();
    if (!isValidFieldValue(value, this.#lenientHeaderValues)) {
      return this.#fail("HPE_INVALID_HEADER_TOKEN", "Invalid header value");
    }

    this.#headers.push(name, value);
    return this.#noteHeader(lower(name), value);
  }

  /** The four headers that change how the message is read. */
  #noteHeader(name: string, value: string): number {
    switch (name) {
      case "content-length": {
        if (this.#sawContentLength && this.#contentLength !== Number(value)) {
          // Two different lengths is unresolvable and dangerous.
          return this.#fail("HPE_UNEXPECTED_CONTENT_LENGTH", "Duplicate Content-Length");
        }
        if (!/^\d+$/.test(value)) {
          return this.#fail("HPE_INVALID_CONTENT_LENGTH", "Invalid Content-Length");
        }
        this.#sawContentLength = true;
        this.#contentLength = Number(value);
        break;
      }
      case "transfer-encoding": {
        if (this.#sawTransferEncoding && !this.#lenientTransferEncoding) {
          return this.#fail(
            "HPE_INVALID_TRANSFER_ENCODING",
            "Invalid `Transfer-Encoding` header value",
          );
        }
        this.#sawTransferEncoding = true;
        const encodings = value.split(",").map((e) => lower(e.trim()));
        // Only a final `chunked` gives a framing. Anything else leaves the
        // message unframed, which for a request is unacceptable.
        if (encodings[encodings.length - 1] === "chunked") {
          this.#framing = Framing.Chunked;
        } else if (this.#type === REQUEST) {
          return this.#fail("HPE_INVALID_TRANSFER_ENCODING", "Unsupported Transfer-Encoding");
        }
        break;
      }
      case "connection": {
        const tokens = value.split(",").map((t) => lower(t.trim()));
        if (tokens.includes("close")) this.#shouldKeepAlive = false;
        else if (tokens.includes("keep-alive")) this.#shouldKeepAlive = true;
        if (tokens.includes("upgrade")) this.#connectionUpgrade = true;
        break;
      }
      case "upgrade":
        // Only meaningful together with `Connection: upgrade`, which may
        // appear before or after this field.
        this.#sawUpgrade = true;
        break;
      default:
        break;
    }
    return 0;
  }

  #endOfHeaders(): number {
    // RFC 9112 §6.1: if both framings are present the length must be rejected.
    // A proxy that trusts one and an origin that trusts the other can be made
    // to disagree about where a message ends, which is request smuggling.
    if (this.#sawTransferEncoding && this.#sawContentLength) {
      return this.#fail(
        "HPE_UNEXPECTED_CONTENT_LENGTH",
        "Content-Length can't be present with Transfer-Encoding",
      );
    }

    if (this.#framing !== Framing.Chunked) {
      if (this.#sawContentLength) {
        this.#framing = Framing.ContentLength;
        this.#remaining = this.#contentLength;
      } else if (this.#type === RESPONSE) {
        // A response with no framing runs until the connection closes.
        this.#framing = Framing.UntilClose;
        // Closing the connection is the delimiter, so this socket cannot
        // carry another response even when HTTP/1.1 would otherwise default
        // to persistence.
        this.#shouldKeepAlive = false;
      } else {
        // A request with no framing has no body at all. Assuming otherwise
        // would make the next request on the connection look like this one's
        // body.
        this.#framing = Framing.None;
      }
    }

    // `Upgrade` is a two-field negotiation, not a property of either header
    // in isolation. CONNECT is the one exception: its successful response
    // turns the same connection into a tunnel without Upgrade fields.
    this.#upgrade =
      this.#type === REQUEST
        ? methods[this.#method] === "CONNECT" || (this.#connectionUpgrade && this.#sawUpgrade)
        : this.#statusCode === 101 && this.#connectionUpgrade && this.#sawUpgrade;

    const info: HeadersComplete =
      this.#type === RESPONSE
        ? {
            type: RESPONSE,
            versionMajor: this.#versionMajor,
            versionMinor: this.#versionMinor,
            headers: this.#headers,
            method: undefined,
            url: undefined,
            statusCode: this.#statusCode,
            statusMessage: this.#statusMessage,
            upgrade: this.#upgrade,
            shouldKeepAlive: this.#shouldKeepAlive,
          }
        : {
            type: REQUEST,
            versionMajor: this.#versionMajor,
            versionMinor: this.#versionMinor,
            headers: this.#headers,
            method: this.#method,
            url: this.#url,
            statusCode: undefined,
            statusMessage: undefined,
            upgrade: this.#upgrade,
            shouldKeepAlive: this.#shouldKeepAlive,
          };
    this.#headers = [];

    // The callback may say "no body" -- that is how a client tells the parser
    // this is the response to a HEAD.
    const answer = this.#callHeadersComplete(info);
    const skip = this.#skipBody || answer === 1;

    // The protocol owner makes the final decision. A server may decline an
    // advertised upgrade through `shouldUpgradeCallback`; a client promotes
    // every response to CONNECT even though that response has no Upgrade
    // headers. Both decisions are expressed by the native parser's return-2
    // convention.
    if (answer === 2) {
      this.#state = State.Upgraded;
      this.#callMessageComplete();
      return 0;
    }

    if (
      skip ||
      this.#framing === Framing.None ||
      (this.#framing === Framing.ContentLength && this.#remaining === 0)
    ) {
      this.#complete();
      return 0;
    }

    this.#state = this.#framing === Framing.Chunked ? State.ChunkSize : State.Body;
    return 0;
  }

  #readBody(data: Uint8Array, offset: number): number {
    const available = data.length - offset;
    const take =
      this.#framing === Framing.UntilClose ? available : Math.min(available, this.#remaining);

    if (take > 0) {
      this.#callBody(data.subarray(offset, offset + take));
      if (this.#framing === Framing.ContentLength) this.#remaining -= take;
    }

    if (this.#framing === Framing.ContentLength && this.#remaining === 0) {
      this.#complete();
    }
    return take;
  }

  #readChunkSize(line: string): number {
    // A chunk size may carry extensions after a semicolon, which nothing uses
    // and which are skipped rather than parsed.
    const semicolon = line.indexOf(";");
    const sizeText = (semicolon === -1 ? line : line.slice(0, semicolon)).trim();
    if (!/^[0-9a-fA-F]+$/.test(sizeText)) {
      return this.#fail("HPE_INVALID_CHUNK_SIZE", "Invalid chunk size");
    }

    const size = Number.parseInt(sizeText, 16);
    if (size === 0) {
      // The last chunk. Trailers may follow, ended by a blank line.
      this.#state = State.Trailer;
      return 0;
    }

    this.#chunkRemaining = size;
    this.#state = State.ChunkData;
    return 0;
  }

  #readChunkData(data: Uint8Array, offset: number): number {
    const take = Math.min(data.length - offset, this.#chunkRemaining);
    if (take > 0) {
      this.#callBody(data.subarray(offset, offset + take));
      this.#chunkRemaining -= take;
    }
    if (this.#chunkRemaining === 0) {
      // The CRLF after the data, which is not part of it.
      this.#state = State.ChunkDataEnd;
    }
    return take;
  }

  #complete(): void {
    this.#state = State.Complete;
    this.#callMessageComplete();
  }

  /** Ready for the next message on the same connection. */
  continueAfterMessage(): void {
    if (this.#state === State.Complete) this.reset();
  }
}

/** The index of the next LF at or after `from`, or -1. */
function indexOfLF(data: Uint8Array, from: number): number {
  for (let i = from; i < data.length; i++) {
    if (data[i] === LF) return i;
  }
  return -1;
}

function stripCR(line: string): string {
  return line.length > 0 && line.charCodeAt(line.length - 1) === CR ? line.slice(0, -1) : line;
}

/**
 * Bytes as text, one byte to one code unit.
 *
 * Header field values are bytes, not characters: RFC 9110 says a recipient
 * should treat them as opaque octets. Decoding as UTF-8 would turn an invalid
 * sequence into a replacement character and change the length, so this maps
 * each byte to the code point of the same value and leaves interpretation to
 * whoever knows the field.
 */
function decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === undefined) throw new Error("HTTP parser byte index is outside the input");
    out += String.fromCharCode(byte);
  }
  return out;
}
