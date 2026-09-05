// `http.Server`, from node v24.20.0 `lib/_http_server.js`.
//
// A TCP server with a parser on each connection. The parser turns bytes into
// messages; this turns messages into the `request` event, and decides what
// happens to the connection when a response finishes.
//
// That last decision is the one that matters. HTTP/1.1 connections are reused
// by default, so after a response the same socket carries the next request --
// which means the parser must be reset, the socket must not be closed, and any
// unread body of the *previous* request must be drained first. A request whose
// body nobody read leaves bytes in the socket, and those bytes would be parsed
// as the start of the next request.

import { Buffer } from "../../buffer/src/main.ts";
import { Server as NetServer, Socket } from "../../net/src/main.ts";
import type { ServerOptions as NetServerOptions, SocketOptions } from "../../net/src/main.ts";
import type { EventName } from "../../events/src/main.ts";
import type { Encoding } from "../../buffer/src/encodings.ts";
import {
  acquireHTTPParser,
  DEFAULT_MAX_HEADER_SIZE,
  HTTPParseError,
  HTTPParser,
  REQUEST,
  methods,
} from "./parser.ts";
import type { ParserError } from "./parser.ts";
import { IncomingMessage } from "./incoming.ts";
import { parseUniqueHeadersOption, ServerResponse } from "./outgoing.ts";
import type { HTTPDuplex } from "./outgoing.ts";
import { clearInterval, setInterval } from "../../timers/src/main.ts";
import type { Timeout } from "../../timers/src/main.ts";
import { nextTick } from "../../internal/tick.ts";
import {
  validateBoolean,
  validateFunction,
  validateInteger,
  validateObject,
  validateOneOf,
} from "../../internal/validators.ts";
import {
  ConnResetException,
  ERR_HTTP_SOCKET_ENCODING,
  ERR_INVALID_ARG_VALUE,
  ERR_OUT_OF_RANGE,
} from "../../internal/errors.ts";
import { STATUS_CODES } from "./status.ts";

export interface HttpServerOptions extends NetServerOptions {
  /** How long a connection may sit idle between requests. */
  keepAliveTimeout?: number | undefined;
  /** Internal safety margin added to the advertised keep-alive timeout. */
  keepAliveTimeoutBuffer?: number | undefined;
  /** How long the head of a request may take to arrive. */
  headersTimeout?: number | undefined;
  requestTimeout?: number | undefined;
  connectionsCheckingInterval?: number | undefined;
  maxHeaderSize?: number | undefined;
  httpValidation?: "strict" | "relaxed" | "insecure" | undefined;
  insecureHTTPParser?: boolean | undefined;
  requireHostHeader?: boolean | undefined;
  uniqueHeaders?: readonly string[] | undefined;
  joinDuplicateHeaders?: boolean | undefined;
  rejectNonStandardBodyWrites?: boolean | undefined;
  optimizeEmptyRequests?: boolean | undefined;
  shouldUpgradeCallback?: ShouldUpgradeCallback | undefined;
  IncomingMessage?: typeof IncomingMessage | undefined;
  ServerResponse?: typeof ServerResponse | undefined;
}

export type RequestListener = (request: IncomingMessage, response: ServerResponse) => void;
export type ShouldUpgradeCallback = (this: Server, request: IncomingMessage) => boolean;

function upgradeWhenObserved(this: Server, _request: IncomingMessage): boolean {
  return this.listenerCount("upgrade") > 0;
}

interface ConnectionDeadline {
  socket: HTTPDuplex;
  headersStartedAt: number;
  requestStartedAt: number;
  requestStarted: boolean;
  headersComplete: boolean;
  requestComplete: boolean;
}

class HTTPRequestTimeoutError extends Error {
  code = "ERR_HTTP_REQUEST_TIMEOUT";

  constructor() {
    super("Request timeout");
    this.name = "Error";
  }
}

function defaultParseErrorResponse(code: string): string {
  if (code === "HPE_HEADER_OVERFLOW") {
    return "HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n";
  }
  if (code === "HPE_CHUNK_EXTENSIONS_OVERFLOW") {
    return "HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\n\r\n";
  }
  return "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n";
}

/** Node accepts `100-continue` as one token in a comma-delimited Expect field. */
const CONTINUE_EXPRESSION = /(?:^|\W)100-continue(?:$|\W)/i;

function expectationContainsContinue(expectation: string | string[]): boolean {
  const value = Array.isArray(expectation) ? expectation.join(", ") : expectation;
  return CONTINUE_EXPRESSION.test(value);
}

/** A server parser must always receive bytes, including after protocol handoff. */
class HTTPServerSocket extends Socket {
  override setEncoding(_encoding: Encoding): this {
    throw new ERR_HTTP_SOCKET_ENCODING();
  }
}

export class Server extends NetServer {
  /**
   * Idle time before a kept-alive connection is closed.
   *
   * Five seconds, node's default. It exists because a connection held open for
   * a client that has gone costs a file descriptor and a slot in the accept
   * backlog, and a server with a few thousand of those stops accepting.
   */
  keepAliveTimeout = 5000;
  keepAliveTimeoutBuffer = 1000;
  headersTimeout = 60000;
  requestTimeout = 300000;
  connectionsCheckingInterval = 30000;
  timeout = 0;
  maxHeadersCount: number | null = null;
  maxRequestsPerSocket: number | null = 0;
  httpAllowHalfOpen = false;
  rejectNonStandardBodyWrites: boolean;
  requireHostHeader: boolean;
  shouldUpgradeCallback: ShouldUpgradeCallback;

  /**
   * Every accepted connection, so `close` can end the idle ones.
   *
   * A keep-alive server holds connections open on purpose, and a `close` that
   * only stopped accepting would wait for clients that may never speak again
   * -- which reads as a process that will not exit.
   */
  #connections = new Set<HTTPDuplex>();

  /**
   * Connections that have finished a response and are waiting for the next
   * request.
   *
   * "Idle" is narrower than "not currently answering". A connection that has
   * never sent a request is not idle -- it is still being waited on, and a
   * `close` that dropped it would cut off a client that is merely slow.
   * Idle means the server has done what was asked and the client has not asked
   * again, which is the state a graceful shutdown is allowed to end.
   */
  #idle = new Set<HTTPDuplex>();
  #deadlines = new Map<HTTPDuplex, ConnectionDeadline>();

  #maxHeaderSize: number;
  #IncomingMessage: typeof IncomingMessage;
  #ServerResponse: typeof ServerResponse;
  #connectionsChecker: Timeout | undefined;
  #lenientHeaderValues: boolean;
  #lenientParsing: boolean;
  #uniqueHeaders: ReadonlySet<string> | null;
  #joinDuplicateHeaders: boolean;
  #optimizeEmptyRequests: boolean;

  constructor(options?: HttpServerOptions | RequestListener, listener?: RequestListener) {
    let opts: HttpServerOptions = {};
    let handler = listener;
    if (typeof options === "function") {
      handler = options;
    } else if (options != null) {
      validateObject(options, "options");
      opts = options;
    }

    super({
      allowHalfOpen: true,
      pauseOnConnect: opts.pauseOnConnect,
      noDelay: opts.noDelay ?? true,
      keepAlive: opts.keepAlive,
      keepAliveInitialDelay: opts.keepAliveInitialDelay,
      highWaterMark: opts.highWaterMark,
      blockList: opts.blockList,
    });

    const requestTimeout = opts.requestTimeout ?? 300000;
    const headersTimeout = opts.headersTimeout ?? Math.min(60000, requestTimeout);
    const keepAliveTimeout = opts.keepAliveTimeout ?? 5000;
    const keepAliveTimeoutBuffer = opts.keepAliveTimeoutBuffer ?? 1000;
    const connectionsCheckingInterval = opts.connectionsCheckingInterval ?? 30000;
    const maxHeaderSize = opts.maxHeaderSize ?? DEFAULT_MAX_HEADER_SIZE;
    const httpValidation: unknown = opts.httpValidation;
    const insecureHTTPParser: unknown = opts.insecureHTTPParser;
    const requireHostHeader = opts.requireHostHeader ?? true;
    validateInteger(requestTimeout, "requestTimeout", 0);
    validateInteger(headersTimeout, "headersTimeout", 0);
    validateInteger(keepAliveTimeout, "keepAliveTimeout", 0);
    validateInteger(keepAliveTimeoutBuffer, "keepAliveTimeoutBuffer", 0);
    validateInteger(connectionsCheckingInterval, "connectionsCheckingInterval", 0);
    validateInteger(maxHeaderSize, "maxHeaderSize", 0);
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
    if (opts.requireHostHeader !== undefined) {
      validateBoolean(opts.requireHostHeader, "options.requireHostHeader");
    }
    if (opts.joinDuplicateHeaders !== undefined) {
      validateBoolean(opts.joinDuplicateHeaders, "options.joinDuplicateHeaders");
    }
    if (opts.rejectNonStandardBodyWrites !== undefined) {
      validateBoolean(opts.rejectNonStandardBodyWrites, "options.rejectNonStandardBodyWrites");
    }
    if (opts.optimizeEmptyRequests !== undefined) {
      validateBoolean(opts.optimizeEmptyRequests, "options.optimizeEmptyRequests");
    }
    if (opts.shouldUpgradeCallback !== undefined) {
      validateFunction(opts.shouldUpgradeCallback, "options.shouldUpgradeCallback");
    }
    if (httpValidation !== undefined && insecureHTTPParser !== undefined) {
      throw new ERR_INVALID_ARG_VALUE(
        "options.httpValidation",
        httpValidation,
        "cannot be used together with options.insecureHTTPParser",
      );
    }
    if (requestTimeout > 0 && headersTimeout > requestTimeout) {
      throw new ERR_OUT_OF_RANGE("headersTimeout", "<= requestTimeout", headersTimeout);
    }

    this.#maxHeaderSize = maxHeaderSize;
    this.#IncomingMessage = opts.IncomingMessage ?? IncomingMessage;
    this.#ServerResponse = opts.ServerResponse ?? ServerResponse;
    this.keepAliveTimeout = keepAliveTimeout;
    this.keepAliveTimeoutBuffer = keepAliveTimeoutBuffer;
    this.headersTimeout = headersTimeout;
    this.requestTimeout = requestTimeout;
    this.connectionsCheckingInterval = connectionsCheckingInterval;
    this.rejectNonStandardBodyWrites = opts.rejectNonStandardBodyWrites ?? false;
    this.requireHostHeader = requireHostHeader;
    this.#uniqueHeaders = parseUniqueHeadersOption(opts.uniqueHeaders);
    this.#joinDuplicateHeaders = opts.joinDuplicateHeaders ?? false;
    this.#optimizeEmptyRequests = opts.optimizeEmptyRequests ?? false;
    this.shouldUpgradeCallback = opts.shouldUpgradeCallback ?? upgradeWhenObserved;
    this.#lenientHeaderValues =
      httpValidation === "relaxed" || httpValidation === "insecure" || insecureHTTPParser === true;
    this.#lenientParsing = httpValidation === "insecure" || insecureHTTPParser === true;

    if (handler) this.on("request", handler);
    this.on("connection", (socket: HTTPDuplex) => this.#serve(socket));
    this.on("listening", () => this.#startConnectionsChecker());
  }

  /** Turn rejected async request handlers into a safe HTTP response. */
  protected override handleCapturedRejection(
    error: unknown,
    event: EventName,
    args: readonly unknown[],
  ): void {
    if (event !== "request") {
      super.handleCapturedRejection(error, event, args);
      return;
    }

    const response = args[1];
    if (!(response instanceof ServerResponse)) {
      super.handleCapturedRejection(error, event, args);
      return;
    }

    if (!response.headersSent && !response.writableEnded) {
      // A handler may have staged sensitive or representation-specific fields.
      // Node's generic failure response must not leak any of them.
      for (const name of response.getHeaderNames()) response.removeHeader(name);
      response.statusCode = 500;
      response.end(STATUS_CODES[500]);
      return;
    }

    // Once any response bytes are committed, a second HTTP response would
    // corrupt framing. Terminating the transport is the only safe outcome.
    response.destroy();
  }

  protected override createAcceptedSocket(options: SocketOptions): Socket {
    return new HTTPServerSocket(options);
  }

  #startConnectionsChecker(): void {
    if (this.#connectionsChecker !== undefined) {
      clearInterval(this.#connectionsChecker);
    }
    this.#connectionsChecker = setInterval(
      () => this.#checkConnections(),
      this.connectionsCheckingInterval,
    );
    this.#connectionsChecker.unref();
  }

  #checkConnections(): void {
    const headersTimeout =
      Number.isFinite(this.headersTimeout) && this.headersTimeout >= 0 ? this.headersTimeout : 0;
    const requestTimeout =
      Number.isFinite(this.requestTimeout) && this.requestTimeout >= 0 ? this.requestTimeout : 0;
    if (headersTimeout === 0 && requestTimeout === 0) return;

    const now = Date.now();
    for (const deadline of this.#deadlines.values()) {
      const headersExpired =
        deadline.requestStarted &&
        !deadline.headersComplete &&
        headersTimeout > 0 &&
        now - deadline.headersStartedAt >= headersTimeout;
      const requestExpired =
        deadline.requestStarted &&
        !deadline.requestComplete &&
        requestTimeout > 0 &&
        now - deadline.requestStartedAt >= requestTimeout;
      if (!headersExpired && !requestExpired) continue;

      const error = new HTTPRequestTimeoutError();
      if (!this.emit("clientError", error, deadline.socket)) {
        deadline.socket.end("HTTP/1.1 408 Request Timeout\r\nConnection: close\r\n\r\n");
      }
      this.#deadlines.delete(deadline.socket);
    }
  }

  #beginRequest(deadline: ConnectionDeadline): void {
    const now = Date.now();
    deadline.headersStartedAt = now;
    deadline.requestStartedAt = now;
    deadline.requestStarted = true;
    deadline.headersComplete = false;
    deadline.requestComplete = false;
  }

  #awaitRequest(deadline: ConnectionDeadline): void {
    deadline.requestStarted = false;
    deadline.headersComplete = false;
    deadline.requestComplete = false;
  }

  #serve(socket: HTTPDuplex): void {
    this.#connections.add(socket);

    const now = Date.now();
    const deadline: ConnectionDeadline = {
      socket,
      headersStartedAt: now,
      requestStartedAt: now,
      requestStarted: true,
      headersComplete: false,
      requestComplete: false,
    };
    this.#deadlines.set(socket, deadline);

    const parserLease = acquireHTTPParser();
    const parser = parserLease.parser;
    // The parser is work performed by this accepted connection, not by the
    // listener that happened to accept it. Node passes the socket resource to
    // its native parser for exactly this trigger relationship.
    parser.initialize(
      REQUEST,
      this.#maxHeaderSize,
      socket.asyncId?.(),
      this.#lenientHeaderValues,
      this.#lenientParsing,
    );
    if (typeof this.maxHeadersCount === "number") {
      parser.maxHeaderPairs = this.maxHeadersCount << 1;
    }

    let incoming: IncomingMessage | null = null;
    let response: ServerResponse | null = null;
    let activeResponse: ServerResponse | null = null;
    let queuedResponses: ServerResponse[] = [];
    let queuedResponseIndex = 0;
    let keepAliveTimeoutSet = false;
    let upgradeRequest: IncomingMessage | null = null;
    let parseErrorSeen = false;
    let socketErrorsSuppressed = false;
    let requestCount = 0;

    const abortQueuedResponses = (error: unknown): void => {
      for (let index = queuedResponseIndex; index < queuedResponses.length; index++) {
        const queued = queuedResponses[index];
        if (queued !== undefined && !queued.destroyed) queued.destroy(error);
      }
      queuedResponses = [];
      queuedResponseIndex = 0;
    };

    const onSocketClose = (): void => {
      this.#connections.delete(socket);
      this.#idle.delete(socket);
      this.#deadlines.delete(socket);

      const reset = new ConnResetException("aborted");
      if (incoming !== null && !incoming.destroyed) incoming._destroyFromSocket(reset);
      abortQueuedResponses(reset);

      // The parser belongs to the connection, not to a message: on a
      // keep-alive socket it survives between requests, so the connection
      // ending is the only moment it is finished.
      parserLease.release();
    };

    const onSocketTimeout = (): void => {
      const requestHandled =
        incoming !== null && !incoming.complete && incoming.emit("timeout", socket);
      const responseHandled = activeResponse !== null && activeResponse.emit("timeout", socket);
      const serverHandled = this.emit("timeout", socket);
      if (!requestHandled && !responseHandled && !serverHandled) socket.destroy();
    };

    if (this.timeout > 0) socket.setTimeout?.(this.timeout);
    socket.on("timeout", onSocketTimeout);

    const advanceResponseQueue = (): void => {
      if (socket.writable === false) {
        abortQueuedResponses(new ConnResetException("aborted"));
        activeResponse = null;
        return;
      }

      const next = queuedResponses[queuedResponseIndex];
      if (next !== undefined) {
        queuedResponseIndex += 1;
        activeResponse = next;
        next.assignSocket(socket);
        return;
      }

      queuedResponses = [];
      queuedResponseIndex = 0;
      activeResponse = null;

      const keepAliveTimeout =
        Number.isFinite(this.keepAliveTimeout) && this.keepAliveTimeout >= 0
          ? this.keepAliveTimeout
          : 0;
      const keepAliveTimeoutBuffer =
        Number.isFinite(this.keepAliveTimeoutBuffer) && this.keepAliveTimeoutBuffer >= 0
          ? this.keepAliveTimeoutBuffer
          : 1000;
      if (keepAliveTimeout > 0 && socket.setTimeout !== undefined) {
        socket.setTimeout(keepAliveTimeout + keepAliveTimeoutBuffer);
        keepAliveTimeoutSet = true;
      }

      // A later pipelined request may already have started while this
      // response was draining. Only enter the idle state when the parser has
      // no in-progress message whose own request deadline must remain armed.
      if (deadline.requestComplete) this.#awaitRequest(deadline);
      socket.resume();
      this.#idle.add(socket);
      socket.unref?.();
    };

    const ignoreSocketError = (_error: unknown): void => {};

    const suppressFurtherSocketErrors = (): void => {
      if (socketErrorsSuppressed) return;
      socketErrorsSuppressed = true;
      socket.removeListener("error", onSocketError);
      socket.on("error", ignoreSocketError);
    };

    const onSocketError = (error: unknown): void => {
      suppressFurtherSocketErrors();
      this.emit("clientError", error, socket);
      socket.destroy(error);
    };

    const handleParseError = (
      parserError: ParserError,
      rawPacket: Buffer,
      packetOffset = 0,
    ): void => {
      parseErrorSeen = true;
      const error = new HTTPParseError(parserError, rawPacket, packetOffset);
      suppressFurtherSocketErrors();
      if (this.emit("clientError", error, socket)) {
        socket.destroy(error);
        return;
      }
      if (socket.writable) {
        socket.end(defaultParseErrorResponse(error.code), () => socket.destroy(error));
      } else {
        socket.destroy(error);
      }
    };

    const handoffUpgrade = (message: IncomingMessage, head: Buffer): void => {
      // The new protocol owns this transport now. HTTP must leave neither a
      // parser nor a timeout/error/close listener that could consume data or
      // destroy the socket behind its new owner's back.
      this.#connections.delete(socket);
      this.#idle.delete(socket);
      this.#deadlines.delete(socket);
      socket.removeListener("close", onSocketClose);
      socket.removeListener("timeout", onSocketTimeout);
      socket.removeListener("error", onSocketError);
      socket.removeListener("data", onSocketData);
      socket.removeListener("end", onSocketEnd);
      parser.finish();
      parserLease.release();
      socket.readableFlowing = null;

      const eventName = message.method === "CONNECT" ? "connect" : "upgrade";
      if (this.listenerCount(eventName) > 0) {
        this.emit(eventName, message, socket, head);
      } else {
        socket.destroy();
      }
    };

    const feed = (data: Buffer): void => {
      if (!deadline.requestStarted) this.#beginRequest(deadline);
      let view = data;
      let packetOffset = 0;
      for (;;) {
        const consumed = parser.execute(view);
        if (consumed < 0) {
          const error = parser.error;
          if (error === null) throw new Error("HTTP parser failed without an error");
          handleParseError(error, data, packetOffset);
          return;
        }
        const acceptedUpgrade = upgradeRequest;
        if (acceptedUpgrade !== null) {
          upgradeRequest = null;
          handoffUpgrade(acceptedUpgrade, view.subarray(consumed));
          return;
        }
        // A message ended part-way through this buffer: the rest is the next
        // request on the same connection, and must not be lost.
        if (consumed < view.length) {
          packetOffset += consumed;
          view = view.subarray(consumed);
          if (incoming?.complete) {
            parser.continueAfterMessage();
            this.#beginRequest(deadline);
            continue;
          }
        }
        return;
      }
    };

    parser.onHeadersComplete = (info) => {
      if (info.type !== REQUEST) {
        throw new Error("request parser produced response metadata");
      }
      if (keepAliveTimeoutSet) {
        socket.setTimeout?.(this.timeout);
        keepAliveTimeoutSet = false;
      }
      deadline.headersComplete = true;
      const message = new this.#IncomingMessage(socket);
      message.httpVersionMajor = info.versionMajor;
      message.httpVersionMinor = info.versionMinor;
      message.httpVersion = `${info.versionMajor}.${info.versionMinor}`;
      message.method = methods[info.method] ?? null;
      message.url = info.url;
      message.keepAlive = info.shouldKeepAlive;
      message.joinDuplicateHeaders = this.#joinDuplicateHeaders;
      message._addHeaders(info.headers);
      // The socket is the source; asking for more means resuming it.
      message.setSource(() => socket.resume());

      incoming = message;

      if (message.method === "CONNECT" || info.upgrade) {
        const accepted =
          message.method === "CONNECT" || Boolean(this.shouldUpgradeCallback(message));
        if (accepted) {
          upgradeRequest = message;
          return 2;
        }
      }

      response = new this.#ServerResponse(message, {
        highWaterMark: socket.writableHighWaterMark,
        rejectNonStandardBodyWrites: this.rejectNonStandardBodyWrites,
      });
      response._setHeaderValidation(this.#lenientHeaderValues);
      response._setUniqueHeaders(this.#uniqueHeaders);
      response.shouldKeepAlive = info.shouldKeepAlive;
      response._keepAliveTimeout = this.keepAliveTimeout;
      response._maxRequestsPerSocket = this.maxRequestsPerSocket;

      if (activeResponse === null) {
        activeResponse = response;
        response.assignSocket(socket);
      } else {
        queuedResponses.push(response);
      }

      // A request has arrived, so this connection matters again until it is
      // answered, and it is no longer idle.
      socket.ref?.();
      this.#idle.delete(socket);

      const finished = response;
      finished.once("finish", () => {
        message._detachAbortSignal();
        if (activeResponse !== finished) {
          throw new Error("HTTP response queue completed out of order");
        }
        finished.detachSocket(socket);
        nextTick(() => finished._closeAfterFinish());
        this.#afterResponse(socket, parser, message, finished, advanceResponseQueue);
      });

      if (
        this.#optimizeEmptyRequests &&
        message.headers["content-length"] === undefined &&
        message.headers["transfer-encoding"] === undefined
      ) {
        message._dumpAndCloseReadable();
        message._read();
      }

      // RFC 9112 section 3.2 requires exactly one authority for HTTP/1.1.
      // Node preserves its historical first-wins handling for duplicates, but
      // a missing Host field is unambiguously invalid unless the server owner
      // explicitly opts out for a legacy peer.
      if (
        this.requireHostHeader &&
        info.versionMajor === 1 &&
        info.versionMinor === 1 &&
        message.headers.host === undefined
      ) {
        finished.writeHead(400, { Connection: "close" });
        finished.end();
        return 0;
      }

      const maximumRequests = this.maxRequestsPerSocket;
      if (
        info.versionMajor === 1 &&
        info.versionMinor === 1 &&
        typeof maximumRequests === "number" &&
        maximumRequests > 0
      ) {
        requestCount += 1;
        finished.maxRequestsOnConnectionReached = maximumRequests <= requestCount;
        if (maximumRequests < requestCount) {
          this.emit("dropRequest", message, socket);
          finished.shouldKeepAlive = false;
          finished.writeHead(503);
          finished.end();
          return 0;
        }
      }

      if (info.versionMajor === 1 && info.versionMinor === 1) {
        const expectation = message.headers["expect"];
        if (expectation !== undefined) {
          if (expectationContainsContinue(expectation)) {
            // The client may withhold its body until this decision. A listener
            // owns that decision; otherwise Node permits the body and delivers
            // the request through the ordinary event.
            finished._expect_continue = true;
            if (this.listenerCount("checkContinue") > 0) {
              this.emit("checkContinue", message, finished);
              return 0;
            }
            finished.writeContinue();
            this.emit("request", message, finished);
            return 0;
          }

          // Unknown expectations never reach the ordinary request listener.
          // Applications may decide how to answer them; without a listener,
          // RFC 9110's standard response is 417 Expectation Failed.
          if (this.listenerCount("checkExpectation") > 0) {
            this.emit("checkExpectation", message, finished);
            return 0;
          }
          finished.writeHead(417);
          finished.end();
          return 0;
        }
      }

      this.emit("request", message, finished);
      return 0;
    };

    parser.onBody = (chunk) => {
      // `push` returning false is the consumer asking for a pause, and the
      // socket is what has to pause -- the parser has no buffer of its own.
      if (incoming && !incoming.push(Buffer.from(chunk))) socket.pause();
    };

    parser.onHeaders = (headers) => {
      if (incoming === null) return;
      incoming._beginTrailers();
      incoming._addHeaders(headers);
    };

    parser.onMessageComplete = () => {
      if (!incoming) return;
      deadline.requestComplete = true;
      incoming.complete = true;
      if (upgradeRequest !== null) return;
      incoming.push(null);
    };

    socket.on("error", onSocketError);

    const onSocketData = (chunk: unknown): void => {
      if (chunk instanceof Buffer) {
        feed(chunk);
      } else if (typeof chunk === "string" || chunk instanceof Uint8Array) {
        feed(Buffer.from(chunk));
      } else {
        throw new TypeError("HTTP socket produced a non-byte data chunk");
      }
    };

    const onSocketEnd = (): void => {
      // A parser error has already been delivered with the packet that caused
      // it. EOF is transport completion, not a second occurrence of the same
      // protocol error.
      if (parseErrorSeen) return;
      if (parser.finish() < 0) {
        const error = parser.error;
        if (error === null) throw new Error("HTTP parser failed without an error");
        handleParseError(error, Buffer.alloc(0));
      } else if (!this.httpAllowHalfOpen) {
        socket.end();
      }
    };

    socket.once("close", onSocketClose);
    socket.on("data", onSocketData);
    socket.on("end", onSocketEnd);
  }

  /**
   * What happens to the connection once a response is finished.
   *
   * Reused when both ends agreed to keep it, closed otherwise. The unread body
   * matters: bytes of a request nobody read are still in the socket, and
   * parsing them as the next request is how a server ends up answering a
   * message that was never sent.
   */
  #afterResponse(
    socket: HTTPDuplex,
    parser: HTTPParser,
    message: IncomingMessage,
    response: ServerResponse,
    advance: () => void,
  ): void {
    // Node's `resOnFinish`: a handler that never read its request has handed
    // ownership of the body back to the server.  Drain it so an ignored body
    // cannot become the next request on this connection, and so an already
    // complete empty body still advances through `end` and `close`.
    if (!message._consuming && !message._readableState.resumeScheduled) {
      message._dump();
    }

    if (!response.shouldKeepAlive || !message.keepAlive) {
      socket.end();
      return;
    }

    if (!message.complete) {
      // `_dump()` resumed the source, but the parser has not reached the end
      // yet.  Reuse is safe only after the readable has drained that body.
      message.once("end", () => this.#afterResponse(socket, parser, message, response, advance));
      return;
    }

    parser.continueAfterMessage();
    advance();
  }

  /** Node's name for the idle timeout on accepted connections. */
  setTimeout(msecs: number, callback?: () => void): this {
    this.timeout = msecs;
    if (callback !== undefined) this.on("timeout", callback);
    return this;
  }

  /**
   * End every connection that is between requests.
   *
   * Only the idle ones. A connection that has never sent a request is not
   * idle -- it is still being waited on, and dropping it would cut off a
   * client that is merely slow. A connection in the middle of a response is
   * not idle either.
   */
  override closeIdleConnections(): void {
    for (const socket of this.#idle) {
      if (!socket.destroyed) socket.destroy();
    }
    this.#idle.clear();
  }

  closeAllConnections(): void {
    for (const socket of this.#connections) socket.destroy();
    this.#connections.clear();
    this.#idle.clear();
    this.#deadlines.clear();
  }

  /**
   * Stop accepting, and release the connections that are only waiting.
   *
   * Node ends the idle ones here rather than waiting for them, because a
   * keep-alive client has no reason to close a connection it may want again --
   * so a `close` that waited for every connection would, for exactly the
   * servers that keep-alive is for, never finish.
   */
  override close(callback?: (error?: unknown) => void): this {
    if (this.#connectionsChecker !== undefined) {
      clearInterval(this.#connectionsChecker);
      this.#connectionsChecker = undefined;
    }
    super.close(callback);
    this.closeIdleConnections();
    return this;
  }
}

export function createServer(
  options?: HttpServerOptions | RequestListener,
  listener?: RequestListener,
): Server {
  return new Server(options, listener);
}
