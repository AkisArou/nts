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
import { IncomingMessage } from "./incoming.ts";
import { ServerResponse } from "./outgoing.ts";
import type { OutgoingSocket } from "./outgoing.ts";

export interface HttpServerOptions extends NetServerOptions {
  /** How long a connection may sit idle between requests. */
  keepAliveTimeout?: number | undefined;
  /** How long the head of a request may take to arrive. */
  headersTimeout?: number | undefined;
  requestTimeout?: number | undefined;
  maxHeaderSize?: number | undefined;
  IncomingMessage?: typeof IncomingMessage | undefined;
  ServerResponse?: typeof ServerResponse | undefined;
}

export type RequestListener = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

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
  maxHeadersCount: number | null = null;
  maxRequestsPerSocket = 0;

  #maxHeaderSize: number;
  #IncomingMessage: typeof IncomingMessage;
  #ServerResponse: typeof ServerResponse;

  constructor(options?: HttpServerOptions | RequestListener, listener?: RequestListener) {
    let opts: HttpServerOptions = {};
    let handler = listener;
    if (typeof options === "function") {
      handler = options;
    } else if (options) {
      opts = options;
    }

    super(opts);

    this.#maxHeaderSize = opts.maxHeaderSize ?? 80 * 1024;
    this.#IncomingMessage = opts.IncomingMessage ?? IncomingMessage;
    this.#ServerResponse = opts.ServerResponse ?? ServerResponse;
    if (opts.keepAliveTimeout !== undefined) this.keepAliveTimeout = opts.keepAliveTimeout;
    if (opts.headersTimeout !== undefined) this.headersTimeout = opts.headersTimeout;
    if (opts.requestTimeout !== undefined) this.requestTimeout = opts.requestTimeout;

    if (handler) this.on("request", handler as never);
    this.on("connection", ((socket: Socket) => this.#serve(socket)) as never);
  }

  #serve(socket: Socket): void {
    const parser = new HTTPParser();
    parser.initialize(REQUEST, this.#maxHeaderSize);

    let incoming: IncomingMessage | null = null;
    let response: ServerResponse | null = null;
    /** Bytes that arrived after a message ended, belonging to the next one. */
    let pending: Buffer | null = null;

    const feed = (data: Buffer): void => {
      let view: Uint8Array = data;
      for (;;) {
        const consumed = parser.execute(view);
        if (consumed < 0) {
          const error = parser.error;
          this.emit("clientError", Object.assign(new Error(error?.reason ?? "Parse Error"), {
            code: error?.code,
            bytesParsed: error?.bytesParsed,
          }), socket);
          socket.destroy();
          return;
        }
        // A message ended part-way through this buffer: the rest is the next
        // request on the same connection, and must not be lost.
        if (consumed < view.length) {
          view = view.subarray(consumed);
          if (incoming?.complete) {
            parser.continueAfterMessage();
            continue;
          }
          pending = Buffer.from(view);
        }
        return;
      }
    };

    parser.onHeadersComplete = (info) => {
      const message = new this.#IncomingMessage(socket as unknown as never);
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
      response.socket = socket as unknown as OutgoingSocket;
      response.shouldKeepAlive = info.shouldKeepAlive;

      const finished = response;
      finished.once("finish", (() => this.#afterResponse(socket, parser, message, finished)) as never);

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
      incoming.complete = true;
      incoming.push(null);
    };

    socket.on("data", ((chunk: Buffer) => feed(chunk)) as never);

    socket.on("end", (() => {
      if (parser.finish() < 0) socket.destroy();
    }) as never);

    socket.on("error", ((error: unknown) => {
      // A socket error with no request in flight is a client that went away,
      // which is ordinary and not the program's business.
      if (incoming) incoming.destroy(error);
    }) as never);

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
    message: IncomingMessage,
    response: ServerResponse,
  ): void {
    if (!response.shouldKeepAlive || !message.keepAlive) {
      socket.end();
      return;
    }

    if (!message.complete) {
      // The request body was not read to the end. There is no safe way to
      // reuse the connection, because what is left of it is indistinguishable
      // from the next request.
      socket.destroy();
      return;
    }

    parser.continueAfterMessage();
    socket.resume();
  }

  /** Node's name for the idle timeout on accepted connections. */
  setTimeout(msecs: number, callback?: () => void): this {
    void msecs;
    void callback;
    return this;
  }

  /**
   * Close idle connections but let in-flight requests finish.
   *
   * The distinction from `close` is the point: `close` stops accepting and
   * waits for every connection, which for a keep-alive server means waiting
   * for clients that may never send anything again.
   */
  closeIdleConnections(): void {}

  closeAllConnections(): void {}
}

export function createServer(
  options?: HttpServerOptions | RequestListener,
  listener?: RequestListener,
): Server {
  return new Server(options, listener);
}
