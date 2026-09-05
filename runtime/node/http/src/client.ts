// `http.ClientRequest`, from node v24.20.0 `lib/_http_client.js`.
//
// The other end of the same protocol: this writes a request and parses a
// response, where the server parses a request and writes a response. It shares
// `OutgoingMessage` with the server for the writing, and the same parser in
// its other mode for the reading.
//
// One asymmetry is worth naming. A server always knows how long a response
// body is, because it is the one framing it. A client does not always know how
// long a *response* body is: a reply with no `Content-Length` and no chunking
// runs until the connection closes, which is why the parser has an
// until-close framing at all and why a client must be told when the socket
// ends rather than only when a message does.

import { Buffer } from "../../buffer/src/main.ts";
import type { LookupFunction } from "../../net/src/main.ts";
import { URL } from "../../url/src/url.ts";
import { urlToHttpOptions } from "../../url/src/fileurl.ts";
import type { AbortSignalLike } from "../../internal/abort.ts";
import { addAbortSignal } from "../../stream/src/add-abort-signal.ts";
import { getTimerDuration } from "../../timers/src/main.ts";
import { nextTick } from "../../internal/tick.ts";
import {
  ConnResetException,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_HTTP_TOKEN,
  ERR_INVALID_PROTOCOL,
  ERR_INVALID_URL,
  ERR_UNESCAPED_CHARACTERS,
} from "../../internal/errors.ts";
import { validateBoolean, validateInteger, validateOneOf } from "../../internal/validators.ts";
import { acquireHTTPParser, HTTPParseError, RESPONSE } from "./parser.ts";
import { IncomingMessage } from "./incoming.ts";
import { checkIsHttpToken, OutgoingMessage, parseUniqueHeadersOption } from "./outgoing.ts";
import type { HTTPDuplex, OutgoingHeaders, OutgoingHeaderValue } from "./outgoing.ts";
import { Agent, globalAgent } from "./agent.ts";
import type { AgentConnectionOptions } from "./agent.ts";

export type RequestHeaderPair = readonly [string, OutgoingHeaderValue];
export type RequestHeaderArray = readonly (string | RequestHeaderPair)[];
export type RequestHeaders = OutgoingHeaders | RequestHeaderArray;

export interface RequestOptions {
  /** Present on WHATWG URL objects accepted by `request()` and `get()`. */
  href?: string | undefined;
  host?: string | undefined;
  hostname?: string | undefined;
  port?: number | string | undefined;
  path?: string | undefined;
  protocol?: string | undefined;
  method?: string | undefined;
  headers?: RequestHeaders | undefined;
  auth?: string | undefined;
  agent?: Agent | false | undefined;
  defaultPort?: number | undefined;
  timeout?: number | undefined;
  setHost?: boolean | undefined;
  setDefaultHeaders?: boolean | undefined;
  uniqueHeaders?: readonly string[] | undefined;
  joinDuplicateHeaders?: boolean | undefined;
  httpValidation?: "strict" | "relaxed" | "insecure" | undefined;
  insecureHTTPParser?: boolean | undefined;
  createConnection?:
    | ((
        options: AgentConnectionOptions,
        callback: (error: unknown, socket?: HTTPDuplex) => void,
      ) => HTTPDuplex | undefined)
    | undefined;
  lookup?: LookupFunction | undefined;
  localAddress?: string | undefined;
  localPort?: number | undefined;
  family?: number | undefined;
  hints?: number | undefined;
  socketPath?: string | undefined;
  signal?: AbortSignalLike | undefined;
  highWaterMark?: number | null | undefined;
  /** Node's name for "do not add a body framing", used by GET and HEAD. */
  maxHeaderSize?: number | undefined;
}

/** The public structural contract accepted by Node's `options.agent`. */
interface RequestAgent {
  readonly protocol?: string | undefined;
  readonly defaultPort?: number | undefined;
  readonly keepAlive?: boolean | undefined;
  readonly maxSockets?: number | undefined;
  readonly options?: { readonly timeout?: number | undefined } | undefined;
  addRequest(request: ClientRequest, options: AgentConnectionOptions): void;
}

export type ResponseListener = (response: IncomingMessage) => void;

interface PendingResponseChunk {
  readonly chunk: Buffer;
  next: PendingResponseChunk | null;
}

/** Methods that carry no body, so no framing header should be added. */
const BODILESS = new Set(["GET", "HEAD", "DELETE", "OPTIONS", "TRACE", "CONNECT"]);
const INVALID_PATH = /[^\u0021-\u00ff]/;

function statusIsInformational(statusCode: number): boolean {
  return statusCode >= 100 && statusCode < 200 && statusCode !== 101;
}

function requestHeadersAreArray(headers: RequestHeaders): headers is RequestHeaderArray {
  return Array.isArray(headers);
}

function requestHeaderIsPair(header: string | RequestHeaderPair): header is RequestHeaderPair {
  return Array.isArray(header);
}

function validateRequestHost(value: unknown, name: "host" | "hostname"): string | null | undefined {
  if (value !== null && value !== undefined && typeof value !== "string") {
    throw new ERR_INVALID_ARG_TYPE(`options.${name}`, ["string", "undefined", "null"], value);
  }
  return value;
}

function isRequestAgent(value: unknown): value is RequestAgent {
  if (value === null || typeof value !== "object" || !("addRequest" in value)) return false;
  return typeof value.addRequest === "function";
}

function applyRequestHeaderArray(
  request: OutgoingMessage,
  headers: RequestHeaderArray,
): RequestHeaderPair[] {
  const pairs: RequestHeaderPair[] = [];
  const first = headers[0];
  if (first !== undefined && requestHeaderIsPair(first)) {
    for (const header of headers) {
      if (!requestHeaderIsPair(header)) {
        throw new ERR_INVALID_ARG_VALUE(
          "options.headers",
          headers,
          "must contain only name/value pairs",
        );
      }
      request.appendHeader(header[0], header[1]);
      pairs.push([header[0], header[1]]);
    }
    return pairs;
  }

  if (headers.length % 2 !== 0) {
    throw new ERR_INVALID_ARG_VALUE(
      "options.headers",
      headers,
      "must contain an even number of entries",
    );
  }
  for (let index = 0; index < headers.length; index += 2) {
    const name = headers[index];
    const value = headers[index + 1];
    if (typeof name !== "string" || typeof value !== "string") {
      throw new ERR_INVALID_ARG_VALUE(
        "options.headers",
        headers,
        "must contain alternating string names and values",
      );
    }
    request.appendHeader(name, value);
    pairs.push([name, value]);
  }
  return pairs;
}

export class ClientRequest extends OutgoingMessage<HTTPDuplex> {
  method: string;
  host: string;
  protocol: string;
  agent: RequestAgent | null;

  aborted = false;
  reusedSocket = false;
  maxHeadersCount: number | null = null;
  timeout: number | undefined;
  timeoutCb: (() => void) | null = null;
  #pendingSocketTimeout: number | undefined;
  #responseEnded = false;
  /** The response, once its head has arrived. */
  res: IncomingMessage | null = null;

  #options: RequestOptions;
  #port: number;
  #errorEmitted = false;
  #joinDuplicateHeaders = false;
  #path = "";

  get path(): string {
    return this.#path;
  }

  set path(value: string) {
    const path = String(value);
    if (INVALID_PATH.test(path)) {
      throw new ERR_UNESCAPED_CHARACTERS("Request path");
    }
    this.#path = path;
  }

  constructor(options: RequestOptions | string, callback?: ResponseListener) {
    const opts: RequestOptions =
      typeof options === "string"
        ? parseUrlish(options)
        : options.href === undefined
          ? { ...options }
          : { ...parseUrlish(options.href), ...options };
    super({ highWaterMark: opts.highWaterMark });
    this.#options = opts;

    const requestedMethod: unknown = opts.method;
    if (
      requestedMethod !== undefined &&
      requestedMethod !== null &&
      typeof requestedMethod !== "string"
    ) {
      throw new ERR_INVALID_ARG_TYPE("options.method", "string", requestedMethod);
    }
    const method = requestedMethod || "GET";
    if (typeof method !== "string" || !checkIsHttpToken(method)) {
      throw new ERR_INVALID_HTTP_TOKEN("Method", String(method));
    }

    this.method = method.toUpperCase();
    this.path = opts.path || "/";
    this.host =
      validateRequestHost(opts.hostname, "hostname") ||
      validateRequestHost(opts.host, "host") ||
      "localhost";

    const agentOption: unknown = opts.agent;
    let selectedAgent: RequestAgent | null;
    if (agentOption === false) {
      selectedAgent = new Agent();
    } else if (agentOption === null || agentOption === undefined) {
      selectedAgent = opts.createConnection === undefined ? globalAgent : null;
    } else if (isRequestAgent(agentOption)) {
      selectedAgent = agentOption;
    } else {
      throw new ERR_INVALID_ARG_TYPE(
        "options.agent",
        ["Agent-like Object", "undefined", "false"],
        agentOption,
      );
    }
    this.protocol = opts.protocol ?? selectedAgent?.protocol ?? "http:";
    const expectedProtocol = selectedAgent?.protocol ?? globalAgent.protocol;
    if (this.protocol !== expectedProtocol) {
      throw new ERR_INVALID_PROTOCOL(this.protocol, expectedProtocol);
    }
    const defaultPort = opts.defaultPort || selectedAgent?.defaultPort;
    this.#port = Number(opts.port || defaultPort || 80);
    const timeoutOption: unknown = opts.timeout;
    this.timeout =
      timeoutOption === undefined ? undefined : getTimerDuration(timeoutOption, "timeout");
    const maxHeaderSize: unknown = opts.maxHeaderSize;
    if (maxHeaderSize !== undefined) validateInteger(maxHeaderSize, "maxHeaderSize", 0);

    const httpValidation: unknown = opts.httpValidation;
    const insecureHTTPParser: unknown = opts.insecureHTTPParser;
    if (httpValidation !== undefined) {
      validateOneOf(httpValidation, "options.httpValidation", [
        "strict",
        "relaxed",
        "insecure",
      ] as const);
    }
    if (insecureHTTPParser !== undefined) {
      validateBoolean(insecureHTTPParser, "options.insecureHTTPParser");
    }
    if (opts.joinDuplicateHeaders !== undefined) {
      validateBoolean(opts.joinDuplicateHeaders, "options.joinDuplicateHeaders");
    }
    if (httpValidation !== undefined && insecureHTTPParser !== undefined) {
      throw new ERR_INVALID_ARG_VALUE(
        "options.httpValidation",
        httpValidation,
        "cannot be used together with options.insecureHTTPParser",
      );
    }
    this._setHeaderValidation(
      httpValidation === "relaxed" || httpValidation === "insecure" || insecureHTTPParser === true,
    );
    this.#joinDuplicateHeaders = opts.joinDuplicateHeaders ?? false;

    if (callback) this.once("response", callback);

    // Node permits an explicit body even on methods such as GET. Such methods
    // merely default to *no framing*: an empty request is self-delimiting, but
    // writing bytes without a Content-Length or Transfer-Encoding makes the
    // connection close-delimited and therefore ineligible for reuse.
    this.hasBody = true;
    this.useChunkedEncodingByDefault = !BODILESS.has(this.method);
    this.keepAliveWithoutFramingWhenEmpty = BODILESS.has(this.method);
    this.shouldKeepAlive =
      selectedAgent !== null &&
      (selectedAgent.keepAlive === true || Number.isFinite(selectedAgent.maxSockets));
    this._removedConnection = opts.setDefaultHeaders === false;
    this._removedContLen = opts.setDefaultHeaders === false;
    this._removedTE = opts.setDefaultHeaders === false;

    const rawHeaderArray = opts.headers !== undefined && requestHeadersAreArray(opts.headers);
    let rawHeaderPairs: RequestHeaderPair[] | undefined;
    if (opts.headers !== undefined) {
      if (requestHeadersAreArray(opts.headers)) {
        rawHeaderPairs = applyRequestHeaderArray(this, opts.headers);
      } else {
        for (const [name, value] of Object.entries(opts.headers)) {
          this.setHeader(name, value);
        }
      }
    }

    // `Host` identifies which site on a shared address the request is for, and
    // is mandatory in HTTP/1.1. Added unless the caller set it or opted out.
    const setHost =
      opts.setHost !== undefined ? Boolean(opts.setHost) : opts.setDefaultHeaders !== false;
    if (!rawHeaderArray && setHost && !this.hasHeader("host")) {
      const needsPort = this.#port !== defaultPort;
      const firstColon = this.host.indexOf(":");
      const hostHeader =
        firstColon !== -1 && this.host.includes(":", firstColon + 1) && !this.host.startsWith("[")
          ? `[${this.host}]`
          : this.host;
      this.setHeader("Host", needsPort ? `${hostHeader}:${this.#port}` : hostHeader);
    }

    const hostHeader = this.getHeader("host");
    if (!rawHeaderArray && hostHeader !== undefined && typeof hostHeader !== "string") {
      throw new ERR_INVALID_ARG_TYPE("options.headers.host", "string", hostHeader);
    }

    if (!rawHeaderArray && opts.auth && !this.hasHeader("authorization")) {
      this.setHeader("Authorization", `Basic ${Buffer.from(opts.auth).toString("base64")}`);
    }

    if (rawHeaderPairs !== undefined) {
      this.statusLine = `${this.method} ${this.path} HTTP/1.1`;
      this._storeRawHeaderPairs(rawHeaderPairs);
    }
    this._setUniqueHeaders(parseUniqueHeadersOption(opts.uniqueHeaders));

    this.agent = selectedAgent;
    const connectionOptions = {
      host: this.host,
      port: this.#port,
      lookup: opts.lookup,
      localAddress: opts.localAddress,
      localPort: opts.localPort,
      family: opts.family,
      hints: opts.hints,
      path: opts.socketPath,
      timeout: this.timeout,
      highWaterMark: opts.highWaterMark,
    };
    if (opts.signal !== undefined) addAbortSignal(opts.signal, this);
    if (this.destroyed) return;
    if (this.agent) {
      this.agent.addRequest(this, connectionOptions);
    } else {
      const createConnection = opts.createConnection;
      if (createConnection === undefined) {
        const socket = globalAgent.createConnection(connectionOptions);
        nextTick(() => this.onSocket(socket));
      } else {
        let completed = false;
        const onCreated = (error: unknown, socket?: HTTPDuplex): void => {
          if (completed) return;
          completed = true;
          if (error !== null && error !== undefined) {
            nextTick(() => this.#fail(error));
          } else if (socket === undefined) {
            nextTick(() => this.#fail(new TypeError("createConnection did not provide a socket")));
          } else {
            this.onSocket(socket);
          }
        };
        let socket: HTTPDuplex | undefined;
        try {
          socket = createConnection(connectionOptions, onCreated);
        } catch (error) {
          onCreated(error);
          return;
        }
        if (socket !== undefined) onCreated(null, socket);
      }
    }

    // `Expect: 100-continue` is a two-phase request. The server cannot grant
    // permission until it has seen the head, while the caller correctly waits
    // for that permission before writing the body. Queue the head immediately
    // (or send it when the socket arrives) to avoid deadlocking both sides.
    if (this.hasHeader("expect")) this.flushHeaders();
  }

  protected override _implicitHeader(): void {
    this.statusLine = `${this.method} ${this.path} HTTP/1.1`;
  }

  /** Given a connection by the agent, or made one. Everything starts here. */
  onSocket(socket: HTTPDuplex | null, error?: unknown): void {
    let onEarlyError: ((error: unknown) => void) | undefined;
    if (socket !== null && error === undefined) {
      onEarlyError = (socketError: unknown): void => this.#fail(socketError, true);
      socket.on("error", onEarlyError);
    }
    nextTick(() => this.#activateSocket(socket, error, onEarlyError));
  }

  #activateSocket(
    socket: HTTPDuplex | null,
    error: unknown,
    onEarlyError: ((error: unknown) => void) | undefined,
  ): void {
    if (this.destroyed || error !== undefined || socket === null) {
      if (error !== undefined) this.#fail(error, true);
      else if (socket === null && !this.destroyed) {
        this.#fail(new Error("Agent did not provide a socket"));
      }
      if (socket !== null) {
        if (error === undefined && this.agent !== null && !socket.destroyed) {
          if (onEarlyError !== undefined) socket.removeListener("error", onEarlyError);
          this.#releaseSocket(socket, true);
        } else {
          if (onEarlyError !== undefined) {
            socket.once("close", () => socket.removeListener("error", onEarlyError));
          }
          if (!socket.destroyed) socket.destroy(error);
        }
      }
      return;
    }
    if (onEarlyError !== undefined) socket.removeListener("error", onEarlyError);

    const parserLease = acquireHTTPParser();
    const parser = parserLease.parser;
    parser.initialize(
      RESPONSE,
      this.#options.maxHeaderSize,
      undefined,
      this.#options.httpValidation === "relaxed" ||
        this.#options.httpValidation === "insecure" ||
        this.#options.insecureHTTPParser === true,
      this.#options.httpValidation === "insecure" || this.#options.insecureHTTPParser === true,
    );
    if (typeof this.maxHeadersCount === "number") {
      parser.maxHeaderPairs = this.maxHeadersCount << 1;
    }
    const maxResponseHeaderEntries = parser.maxHeaderPairs > 0 ? parser.maxHeaderPairs : undefined;

    let response: IncomingMessage | null = null;
    let upgradeResponse: IncomingMessage | null = null;
    let finalMessageComplete = false;
    let parsingResponse = false;
    let pendingResponseHead: PendingResponseChunk | null = null;
    let pendingResponseTail: PendingResponseChunk | null = null;

    const abortResponse = (): void => {
      if (response === null || response.complete || response.destroyed) return;
      const error = new ConnResetException("aborted");
      response._destroyFromSocket(error);
    };

    const onResponseTimeout = (): void => {
      response?.emit("timeout", socket);
    };

    const consumeResponseChunk = (chunk: Buffer): boolean => {
      let offset = 0;
      while (offset < chunk.length) {
        const consumed = parser.execute(chunk.subarray(offset));
        if (consumed < 0) {
          const parserError = parser.error;
          if (parserError === null) {
            throw new Error("HTTP parser failed without an error");
          }
          const error = new HTTPParseError(parserError, chunk, offset);
          parserLease.release();
          cleanupSocketListeners();
          this.#failWithoutSocketError(error);
          return false;
        }
        offset += consumed;

        const acceptedUpgrade = upgradeResponse;
        if (acceptedUpgrade !== null) {
          upgradeResponse = null;
          handoffUpgrade(acceptedUpgrade, chunk.subarray(offset));
          return false;
        }

        if (!finalMessageComplete) return true;
        if (offset < chunk.length) {
          finalMessageComplete = false;
          parser.continueAfterMessage();
          continue;
        }

        parserLease.release();
        cleanupSocketListeners();
        return false;
      }
      return true;
    };

    const enqueueResponseChunk = (chunk: Buffer): void => {
      const entry: PendingResponseChunk = { chunk, next: null };
      const tail = pendingResponseTail;
      if (tail === null) pendingResponseHead = entry;
      else tail.next = entry;
      pendingResponseTail = entry;
    };

    const takePendingResponseChunk = (): Buffer | null => {
      const entry = pendingResponseHead;
      if (entry === null) return null;
      pendingResponseHead = entry.next;
      if (pendingResponseHead === null) pendingResponseTail = null;
      return entry.chunk;
    };

    const clearPendingResponseChunks = (): void => {
      pendingResponseHead = null;
      pendingResponseTail = null;
    };

    const onData = (chunk: Buffer): void => {
      if (parsingResponse) {
        enqueueResponseChunk(chunk);
        return;
      }

      parsingResponse = true;
      let current: Buffer | null = chunk;
      try {
        while (current !== null) {
          if (!consumeResponseChunk(current)) {
            clearPendingResponseChunks();
            return;
          }
          current = takePendingResponseChunk();
        }
      } finally {
        parsingResponse = false;
      }
    };

    const onEnd = (): void => {
      // A response with no framing ends when the connection does, so the end
      // of the socket is what completes the message.
      parser.finish();
      if (response === null) {
        cleanupSocketListeners();
        this.#failWithoutSocketError(new ConnResetException("socket hang up"), true);
      } else {
        abortResponse();
      }
    };

    const onError = (error: unknown): void => {
      parserLease.release();
      cleanupSocketListeners();
      this.#fail(error, true);
    };

    const onClose = (): void => {
      cleanupSocketListeners();
      // The response parser is finished with the connection.
      parserLease.release();
      if (!this.res) {
        // The connection went before any response arrived, which is the one
        // case a client cannot recover from on its own. `abort()` reports its
        // own event, but does not suppress this first transport outcome.
        this.#fail(new ConnResetException("socket hang up"), true);
      } else {
        abortResponse();
      }
      this._emitClose();
    };

    const cleanupSocketListeners = (): void => {
      detachParserListeners();
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    };

    const detachParserListeners = (): void => {
      socket.removeListener("data", onData);
      socket.removeListener("end", onEnd);
      socket.removeListener("timeout", onResponseTimeout);
      if (this.timeoutCb !== null) {
        socket.removeListener("timeout", this.timeoutCb);
        this.timeoutCb = null;
      }
    };

    const handoffUpgrade = (message: IncomingMessage, head: Buffer): void => {
      detachParserListeners();
      parser.finish();
      parserLease.release();

      const eventName = this.method === "CONNECT" ? "connect" : "upgrade";
      if (this.listenerCount(eventName) === 0) {
        socket.destroy();
        return;
      }

      // Agent and OutgoingMessage ownership are independent. Drop both before
      // the callback, while keeping req.socket/res.socket equal to the raw
      // transport as Node's public API promises.
      socket.emit("agentRemove");
      cleanupSocketListeners();
      this._handoffSocket(socket);
      socket.readableFlowing = null;
      this.emit(eventName, message, socket, head);
      this._emitClose();
    };

    parser.onHeadersComplete = (info) => {
      if (info.type !== RESPONSE) {
        throw new Error("response parser produced request metadata");
      }
      const message = new IncomingMessage(socket);
      message.joinDuplicateHeaders = this.#joinDuplicateHeaders;
      message.httpVersionMajor = info.versionMajor;
      message.httpVersionMinor = info.versionMinor;
      message.httpVersion = `${info.versionMajor}.${info.versionMinor}`;
      message.statusCode = info.statusCode;
      message.statusMessage = info.statusMessage;
      message.keepAlive = info.shouldKeepAlive;
      message._addHeaders(info.headers, maxResponseHeaderEntries);
      message.setSource(() => socket.resume());

      if (info.upgrade || this.method === "CONNECT") {
        response = message;
        this.res = message;
        upgradeResponse = message;
        return 2;
      }

      // An informational response is not *the* response: the real one follows
      // on the same connection, so the parser has to carry on rather than
      // treat this as the message.
      if (statusIsInformational(info.statusCode)) {
        if (info.statusCode === 100) this.emit("continue");
        this.emit("information", {
          httpVersion: message.httpVersion,
          httpVersionMajor: info.versionMajor,
          httpVersionMinor: info.versionMinor,
          statusCode: info.statusCode,
          statusMessage: info.statusMessage,
          headers: message.headers,
          rawHeaders: message.rawHeaders,
        });
        return 1;
      }

      // The request begins reusable when its Agent may pool the transport,
      // but the peer has the final say. A non-persistent response makes the
      // public request state and the later pool decision agree.
      if (this.shouldKeepAlive && !info.shouldKeepAlive) this.shouldKeepAlive = false;

      response = message;
      this.res = message;
      socket.on("timeout", onResponseTimeout);
      message.once("end", () => {
        this.#responseEnded = true;
        message._detachAbortSignal();
        // Registered before the response is exposed, so the request becomes
        // logically destroyed before user `end` listeners run. The actual
        // close/free transition stays deferred, leaving the socket busy for
        // the whole current event emission.
        this.#finishResponse(socket, message);
      });
      if (!this.emit("response", message)) message._dump();

      // HEAD, 204, and 304 may carry representation metadata such as
      // Content-Length, but never a response body. Treating that metadata as
      // framing would wait for bytes that a conforming server will not send.
      return this.method === "HEAD" || info.statusCode === 204 || info.statusCode === 304 ? 1 : 0;
    };

    parser.onBody = (chunk) => {
      if (response && !response.push(Buffer.from(chunk))) socket.pause();
    };

    parser.onHeaders = (headers) => {
      if (response === null) return;
      response._beginTrailers();
      response._addHeaders(headers, maxResponseHeaderEntries);
    };

    parser.onMessageComplete = () => {
      if (upgradeResponse !== null) {
        upgradeResponse.complete = true;
        return;
      }
      if (!response) {
        // Informational responses complete their own parser message, but not
        // this ClientRequest. Reset synchronously so a final response already
        // present later in the same TCP chunk is parsed rather than stranded.
        parser.continueAfterMessage();
        return;
      }
      const completed = response;
      completed.complete = true;
      completed.push(null);
      // `execute()` may still have bytes from the same packet to inspect.
      // Defer detaching until `onData` has either rejected that tail or shown
      // that the response ended exactly at the packet boundary.
      finalMessageComplete = true;
    };

    socket.on("data", onData);
    socket.on("end", onEnd);
    socket.on("error", onError);
    socket.on("close", onClose);
    // Assigning the socket flushes pre-connection writes, so the parser and
    // lifecycle listeners must already be installed when that happens.
    this.socket = socket;

    const pendingSocketTimeout = this.#pendingSocketTimeout;
    this.#pendingSocketTimeout = undefined;
    if (pendingSocketTimeout !== undefined) {
      if (socket.connecting) {
        socket.once("connect", () => socket.setTimeout?.(pendingSocketTimeout));
      } else {
        socket.setTimeout?.(pendingSocketTimeout);
      }
    }

    const timeout = this.timeout ?? this.agent?.options?.timeout;
    if (timeout !== undefined) {
      this.timeoutCb = () => {
        this.emit("timeout");
      };
      socket.once("timeout", this.timeoutCb);
    }

    this.emit("socket", socket);
  }

  #finishResponse(socket: HTTPDuplex, response: IncomingMessage): void {
    if (!this.writableFinished) {
      // A server may answer before it has read the request body. Such a socket
      // is still carrying outbound bytes and cannot be handed to another
      // request. Keep it active; the ordered `finish` callback releases it if
      // and when the write queue actually drains.
      this.once("finish", () => this.#finishResponse(socket, response));
      return;
    }
    if (socket.writableLength > 0) {
      // ClientRequest is not itself the native Writable in this profile; its
      // framed writes are delegated to the socket. Therefore the socket's
      // queue is the final authority even after the request's ordered finish
      // sentinel has completed.
      socket.once("drain", () => this.#finishResponse(socket, response));
      return;
    }
    const reusable = this.shouldKeepAlive && response.keepAlive && !this.destroyed;
    if (reusable) {
      this.destroyed = true;
      // A completed response must not destroy a socket that has already been
      // returned to its owner. Keep `req.socket` for compatibility, while the
      // incoming side relinquishes transport ownership immediately.
      response.socket = null;
    }
    nextTick(() => {
      this._emitClose();
      this.#releaseSocket(
        socket,
        reusable,
        typeof response.headers["keep-alive"] === "string"
          ? response.headers["keep-alive"]
          : undefined,
      );
    });
  }

  #releaseSocket(socket: HTTPDuplex, reusable: boolean, keepAliveHint?: string): void {
    const agent = this.agent;
    if (agent instanceof Agent) {
      agent.release(
        agent.getName({ host: this.host, port: this.#port }),
        socket,
        reusable,
        keepAliveHint,
      );
      return;
    }
    if (reusable) {
      // A custom connection has no built-in pool, but its owner may reuse it
      // by observing Node's public `free` event. This is also how two requests
      // can deliberately share the same generic Duplex.
      socket.emit("free");
      return;
    }
    socket.destroy();
  }

  #fail(error: unknown, allowAfterAbort = false): void {
    if ((!allowAfterAbort && this.aborted) || this.#errorEmitted) return;
    this.#errorEmitted = true;
    this.emit("error", error);
    super.destroy(error);
  }

  /** Report a protocol failure without emitting that request-owned error on the transport. */
  #failWithoutSocketError(error: unknown, allowAfterAbort = false): void {
    if ((!allowAfterAbort && this.aborted) || this.#errorEmitted) return;
    this.#errorEmitted = true;
    this.emit("error", error);
    super.destroy();
  }

  /** Node's older name for `destroy`, kept because programs call it. */
  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    nextTick(() => this.emit("abort"));
    this.destroy();
  }

  override destroy(error?: unknown): this {
    if (this.destroyed) return this;
    // Once the request is abandoned, remaining response bytes belong to
    // nobody. Drain them without delivering more `data` to user code while
    // the socket teardown completes.
    this.res?._dump();
    if (this.socket === null && this.agent !== null && !this.aborted && !this.#errorEmitted) {
      const failure = error ?? new ConnResetException("socket hang up");
      nextTick(() => {
        if (this.#errorEmitted || this.aborted) return;
        this.#errorEmitted = true;
        this.emit("error", failure);
      });
    }
    return super.destroy(error);
  }

  override setTimeout(msecs: number, callback?: () => void): this {
    if (this.#responseEnded) return this;
    const duration = getTimerDuration(msecs, "msecs");
    this.timeout = duration;
    if (callback) this.once("timeout", callback);
    const socket = this.socket;
    if (socket === null) {
      this.#pendingSocketTimeout = duration;
    } else {
      if (this.timeoutCb !== null) socket.removeListener("timeout", this.timeoutCb);
      if (socket.connecting === true) {
        socket.once("connect", () => socket.setTimeout?.(duration));
      } else {
        socket.setTimeout?.(duration);
      }
      this.timeoutCb = () => {
        this.emit("timeout");
      };
      socket.once("timeout", this.timeoutCb);
    }
    return this;
  }

  clearTimeout(callback?: () => void): this {
    return this.setTimeout(0, callback);
  }

  /** Disable Nagle on the underlying socket once there is one. */
  setNoDelay(enable = true): void {
    this.socket?.setNoDelay?.(enable);
  }

  setSocketKeepAlive(enable = true, initialDelay = 0): void {
    this.socket?.setKeepAlive?.(enable, initialDelay);
  }
}

/** `http.request("http://host/path")`, taken apart. */
function parseUrlish(url: string): RequestOptions {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ERR_INVALID_URL(url);
  }
  return urlToHttpOptions(parsed);
}

export function request(
  options: RequestOptions | string,
  optionsOrCallback?: RequestOptions | ResponseListener,
  maybeCallback?: ResponseListener,
): ClientRequest {
  // `request(url, options, cb)` as well as `request(options, cb)`, because a
  // URL says where and an options object says how, and a caller often has both.
  let opts: RequestOptions;
  let callback: ResponseListener | undefined;

  if (typeof options === "string") {
    opts = parseUrlish(options);
    if (typeof optionsOrCallback === "function") {
      callback = optionsOrCallback;
    } else if (optionsOrCallback) {
      opts = { ...opts, ...optionsOrCallback };
      callback = maybeCallback;
    }
  } else {
    opts = options;
    callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
  }

  return new ClientRequest(opts, callback);
}

/**
 * A request that is already finished being written.
 *
 * The whole of the difference from `request` is the `end()`, and it exists
 * because forgetting it is the most common way a `GET` appears to hang: the
 * request has been built and never sent.
 */
export function get(
  options: RequestOptions | string,
  optionsOrCallback?: RequestOptions | ResponseListener,
  maybeCallback?: ResponseListener,
): ClientRequest {
  const req = request(options, optionsOrCallback, maybeCallback);
  req.end();
  return req;
}
