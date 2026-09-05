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
import type { ServerOptions as NetServerOptions } from "../../net/src/main.ts";
import { HTTPParser, REQUEST, methods } from "./parser.ts";
import type { ParserError } from "./parser.ts";
import { IncomingMessage } from "./incoming.ts";
import { ServerResponse } from "./outgoing.ts";
import { clearInterval, setInterval } from "../../timers/src/main.ts";
import type { Timeout } from "../../timers/src/main.ts";
import {
  validateBoolean,
  validateInteger,
  validateObject,
  validateOneOf,
} from "../../internal/validators.ts";
import { ERR_INVALID_ARG_VALUE, ERR_OUT_OF_RANGE } from "../../internal/errors.ts";

export interface HttpServerOptions extends NetServerOptions {
  /** How long a connection may sit idle between requests. */
  keepAliveTimeout?: number | undefined;
  /** How long the head of a request may take to arrive. */
  headersTimeout?: number | undefined;
  requestTimeout?: number | undefined;
  connectionsCheckingInterval?: number | undefined;
  maxHeaderSize?: number | undefined;
  httpValidation?: "strict" | "relaxed" | "insecure" | undefined;
  insecureHTTPParser?: boolean | undefined;
  requireHostHeader?: boolean | undefined;
  IncomingMessage?: typeof IncomingMessage | undefined;
  ServerResponse?: typeof ServerResponse | undefined;
}

export type RequestListener = (request: IncomingMessage, response: ServerResponse) => void;

interface ConnectionDeadline {
  socket: Socket;
  headersStartedAt: number;
  requestStartedAt: number;
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

class HTTPParseError extends Error {
  readonly code: string;
  readonly bytesParsed: number;
  readonly rawPacket: Buffer;

  constructor(parserError: ParserError, rawPacket: Buffer) {
    super(`Parse Error: ${parserError.reason}`);
    this.code = parserError.code;
    this.bytesParsed = parserError.bytesParsed;
    this.rawPacket = rawPacket;
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

export class Server extends NetServer {
  /**
   * Idle time before a kept-alive connection is closed.
   *
   * Five seconds, node's default. It exists because a connection held open for
   * a client that has gone costs a file descriptor and a slot in the accept
   * backlog, and a server with a few thousand of those stops accepting.
   */
  keepAliveTimeout = 5000;
  headersTimeout = 60000;
  requestTimeout = 300000;
  connectionsCheckingInterval = 30000;
  maxHeadersCount: number | null = null;
  maxRequestsPerSocket = 0;
  requireHostHeader: boolean;

  /**
   * Every accepted connection, so `close` can end the idle ones.
   *
   * A keep-alive server holds connections open on purpose, and a `close` that
   * only stopped accepting would wait for clients that may never speak again
   * -- which reads as a process that will not exit.
   */
  #connections = new Set<Socket>();

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
  #idle = new Set<Socket>();
  #deadlines = new Map<Socket, ConnectionDeadline>();

  #maxHeaderSize: number;
  #IncomingMessage: typeof IncomingMessage;
  #ServerResponse: typeof ServerResponse;
  #connectionsChecker: Timeout | undefined;
  #lenientHeaderValues: boolean;
  #lenientTransferEncoding: boolean;

  constructor(options?: HttpServerOptions | RequestListener, listener?: RequestListener) {
    let opts: HttpServerOptions = {};
    let handler = listener;
    if (typeof options === "function") {
      handler = options;
    } else if (options != null) {
      validateObject(options, "options");
      opts = options;
    }

    super(opts);

    const requestTimeout = opts.requestTimeout ?? 300000;
    const headersTimeout = opts.headersTimeout ?? Math.min(60000, requestTimeout);
    const keepAliveTimeout = opts.keepAliveTimeout ?? 5000;
    const connectionsCheckingInterval = opts.connectionsCheckingInterval ?? 30000;
    const maxHeaderSize = opts.maxHeaderSize ?? 80 * 1024;
    const httpValidation: unknown = opts.httpValidation;
    const insecureHTTPParser: unknown = opts.insecureHTTPParser;
    const requireHostHeader = opts.requireHostHeader ?? true;
    validateInteger(requestTimeout, "requestTimeout", 0);
    validateInteger(headersTimeout, "headersTimeout", 0);
    validateInteger(keepAliveTimeout, "keepAliveTimeout", 0);
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
    this.headersTimeout = headersTimeout;
    this.requestTimeout = requestTimeout;
    this.connectionsCheckingInterval = connectionsCheckingInterval;
    this.requireHostHeader = requireHostHeader;
    this.#lenientHeaderValues =
      httpValidation === "relaxed" || httpValidation === "insecure" || insecureHTTPParser === true;
    this.#lenientTransferEncoding = httpValidation === "insecure" || insecureHTTPParser === true;

    if (handler) this.on("request", handler);
    this.on("connection", (socket: Socket) => this.#serve(socket));
    this.on("listening", () => this.#startConnectionsChecker());
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
        !deadline.headersComplete &&
        headersTimeout > 0 &&
        now - deadline.headersStartedAt >= headersTimeout;
      const requestExpired =
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
    deadline.headersComplete = false;
    deadline.requestComplete = false;
  }

  #serve(socket: Socket): void {
    this.#connections.add(socket);

    const now = Date.now();
    const deadline: ConnectionDeadline = {
      socket,
      headersStartedAt: now,
      requestStartedAt: now,
      headersComplete: false,
      requestComplete: false,
    };
    this.#deadlines.set(socket, deadline);

    const parser = new HTTPParser();
    // The parser is work performed by this accepted connection, not by the
    // listener that happened to accept it. Node passes the socket resource to
    // its native parser for exactly this trigger relationship.
    parser.initialize(
      REQUEST,
      this.#maxHeaderSize,
      socket.asyncId(),
      this.#lenientHeaderValues,
      this.#lenientTransferEncoding,
    );

    socket.once("close", () => {
      this.#connections.delete(socket);
      this.#idle.delete(socket);
      this.#deadlines.delete(socket);
      // The parser belongs to the connection, not to a message: on a
      // keep-alive socket it survives between requests, so the connection
      // ending is the only moment it is finished.
      parser.free();
    });

    let incoming: IncomingMessage | null = null;
    let response: ServerResponse | null = null;
    /** Bytes that arrived after a message ended, belonging to the next one. */
    let pending: Buffer | null = null;

    const ignoreSocketError = (_error: unknown): void => {};

    const suppressFurtherSocketErrors = (): void => {
      socket.removeListener("error", onSocketError);
      socket.on("error", ignoreSocketError);
    };

    const onSocketError = (error: unknown): void => {
      suppressFurtherSocketErrors();
      if (!this.emit("clientError", error, socket)) socket.destroy(error);
    };

    const handleParseError = (parserError: ParserError, rawPacket: Buffer): void => {
      const error = new HTTPParseError(parserError, rawPacket);
      suppressFurtherSocketErrors();
      if (this.emit("clientError", error, socket)) return;
      if (socket.writable) {
        socket.end(defaultParseErrorResponse(error.code), () => socket.destroy(error));
      } else {
        socket.destroy(error);
      }
    };

    const feed = (data: Buffer): void => {
      let view: Uint8Array = data;
      for (;;) {
        const consumed = parser.execute(view);
        if (consumed < 0) {
          const error = parser.error;
          if (error === null) throw new Error("HTTP parser failed without an error");
          handleParseError(error, data);
          return;
        }
        // A message ended part-way through this buffer: the rest is the next
        // request on the same connection, and must not be lost.
        if (consumed < view.length) {
          view = view.subarray(consumed);
          if (incoming?.complete) {
            parser.continueAfterMessage();
            this.#beginRequest(deadline);
            continue;
          }
          pending = Buffer.from(view);
        }
        return;
      }
    };

    parser.onHeadersComplete = (info) => {
      if (info.type !== REQUEST) {
        throw new Error("request parser produced response metadata");
      }
      deadline.headersComplete = true;
      const message = new this.#IncomingMessage(socket);
      message.httpVersionMajor = info.versionMajor;
      message.httpVersionMinor = info.versionMinor;
      message.httpVersion = `${info.versionMajor}.${info.versionMinor}`;
      message.method = methods[info.method] ?? null;
      message.url = info.url;
      message.keepAlive = info.shouldKeepAlive;
      message._addHeaders(info.headers);
      // The socket is the source; asking for more means resuming it.
      message.setSource(() => socket.resume());

      incoming = message;
      response = new this.#ServerResponse(message);
      response._setHeaderValidation(this.#lenientHeaderValues);
      response.socket = socket;
      response.shouldKeepAlive = info.shouldKeepAlive;

      // A request has arrived, so this connection matters again until it is
      // answered, and it is no longer idle.
      socket.ref();
      this.#idle.delete(socket);

      const finished = response;
      finished.once("finish", () =>
        this.#afterResponse(socket, parser, deadline, message, finished),
      );

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

      // A client that said `Expect: 100-continue` is waiting for permission
      // before it sends the body. Node emits an event if anyone is listening
      // and otherwise answers yes, because a server that never replies leaves
      // the client waiting for a timeout.
      if (String(message.headers["expect"] ?? "").toLowerCase() === "100-continue") {
        if (this.listenerCount("checkContinue") > 0) {
          this.emit("checkContinue", message, finished);
          return 0;
        }
        finished.writeContinue();
      }

      this.emit("request", message, finished);
      return 0;
    };

    parser.onBody = (chunk) => {
      // `push` returning false is the consumer asking for a pause, and the
      // socket is what has to pause -- the parser has no buffer of its own.
      if (incoming && !incoming.push(Buffer.from(chunk))) socket.pause();
    };

    parser.onMessageComplete = () => {
      if (!incoming) return;
      deadline.requestComplete = true;
      incoming.complete = true;
      incoming.push(null);
    };

    socket.on("error", onSocketError);

    socket.on("data", (chunk: unknown) => {
      if (chunk instanceof Buffer) {
        feed(chunk);
      } else if (typeof chunk === "string" || chunk instanceof Uint8Array) {
        feed(Buffer.from(chunk));
      } else {
        throw new TypeError("HTTP socket produced a non-byte data chunk");
      }
    });

    socket.on("end", () => {
      if (parser.finish() < 0) {
        const error = parser.error;
        if (error === null) throw new Error("HTTP parser failed without an error");
        handleParseError(error, Buffer.alloc(0));
      }
    });

    void pending;
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
    socket: Socket,
    parser: HTTPParser,
    deadline: ConnectionDeadline,
    message: IncomingMessage,
    response: ServerResponse,
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
      message.once("end", () => this.#afterResponse(socket, parser, deadline, message, response));
      return;
    }

    parser.continueAfterMessage();
    this.#beginRequest(deadline);
    socket.resume();

    // Idle now: usable if the client sends another request, but not a reason
    // for the process to stay alive. A keep-alive server that refed its idle
    // connections would never let a program exit, which is not what keeping
    // them open is for.
    this.#idle.add(socket);
    socket.unref();

    // And if the server has stopped accepting, there will be no next request
    // on it worth waiting for.
    if (!this.listening) socket.end();
  }

  /** Node's name for the idle timeout on accepted connections. */
  setTimeout(msecs: number, callback?: () => void): this {
    void msecs;
    void callback;
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
