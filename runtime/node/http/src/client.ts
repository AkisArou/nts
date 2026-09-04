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
import { Socket } from "../../net/src/main.ts";
import { nextTick } from "../../internal/tick.ts";
import { ERR_INVALID_ARG_TYPE } from "../../internal/errors.ts";
import { HTTPParser, RESPONSE } from "./parser.ts";
import { IncomingMessage } from "./incoming.ts";
import { OutgoingMessage } from "./outgoing.ts";
import { Agent, globalAgent } from "./agent.ts";

export interface RequestOptions {
  host?: string | undefined;
  hostname?: string | undefined;
  port?: number | string | undefined;
  path?: string | undefined;
  method?: string | undefined;
  headers?: Record<string, string | number | string[]> | undefined;
  auth?: string | undefined;
  agent?: Agent | false | undefined;
  timeout?: number | undefined;
  setHost?: boolean | undefined;
  createConnection?: ((options: RequestOptions) => Socket) | undefined;
  /** Node's name for "do not add a body framing", used by GET and HEAD. */
  maxHeaderSize?: number | undefined;
}

export type ResponseListener = (response: IncomingMessage) => void;

/** Methods that carry no body, so no framing header should be added. */
const BODILESS = new Set(["GET", "HEAD", "DELETE", "OPTIONS", "TRACE", "CONNECT"]);

export class ClientRequest extends OutgoingMessage {
  method: string;
  path: string;
  host: string;
  port: number;
  agent: Agent | null;

  aborted = false;
  reusedSocket = false;
  /** The response, once its head has arrived. */
  res: IncomingMessage | null = null;

  #options: RequestOptions;
  #timeoutMs: number | undefined;

  constructor(options: RequestOptions | string, callback?: ResponseListener) {
    super();

    const opts: RequestOptions = typeof options === "string"
      ? parseUrlish(options)
      : { ...options };
    this.#options = opts;

    this.method = (opts.method ?? "GET").toUpperCase();
    this.path = opts.path ?? "/";
    this.host = opts.hostname ?? opts.host ?? "localhost";
    this.port = Number(opts.port ?? 80);
    this.#timeoutMs = opts.timeout;

    if (callback) this.once("response", callback);

    // A client's request is chunked only if it says so; a GET with no body
    // must not carry a framing header at all, or a server will wait for one.
    this.hasBody = !BODILESS.has(this.method);
    this.useChunkedEncodingByDefault = this.hasBody;
    this.shouldKeepAlive = true;

    if (opts.headers) {
      for (const [name, value] of Object.entries(opts.headers)) {
        this.setHeader(name, value);
      }
    }

    // `Host` identifies which site on a shared address the request is for, and
    // is mandatory in HTTP/1.1. Added unless the caller set it or opted out.
    if (opts.setHost !== false && !this.hasHeader("host")) {
      const needsPort = this.port !== 80;
      this.setHeader("Host", needsPort ? `${this.host}:${this.port}` : this.host);
    }

    if (opts.auth && !this.hasHeader("authorization")) {
      this.setHeader("Authorization", `Basic ${Buffer.from(opts.auth).toString("base64")}`);
    }

    this.statusLine = `${this.method} ${this.path} HTTP/1.1`;

    this.agent = opts.agent === false ? null : (opts.agent ?? globalAgent);
    if (this.agent) {
      this.agent.addRequest(this, { host: this.host, port: this.port });
    } else {
      const socket = opts.createConnection
        ? opts.createConnection(opts)
        : globalAgent.createConnection({ host: this.host, port: this.port });
      nextTick(() => this.onSocket(socket));
    }
  }

  protected override _implicitHeader(): void {
    this.statusLine = `${this.method} ${this.path} HTTP/1.1`;
  }

  /** Given a connection by the agent, or made one. Everything starts here. */
  onSocket(socket: Socket): void {
    this.socket = socket;

    const parser = new HTTPParser();
    parser.initialize(RESPONSE, this.#options.maxHeaderSize);

    let response: IncomingMessage | null = null;

    const onData = (chunk: Buffer): void => {
      const consumed = parser.execute(chunk);
      if (consumed < 0) {
        const error = parser.error;
        cleanupSocketListeners();
        this.#fail(Object.assign(new Error(error?.reason ?? "Parse Error"), {
          code: error?.code,
          bytesParsed: error?.bytesParsed,
        }));
      }
    };

    const onEnd = (): void => {
      // A response with no framing ends when the connection does, so the end
      // of the socket is what completes the message.
      if (parser.finish() < 0 && !response) {
        cleanupSocketListeners();
        this.#fail(new Error("socket hang up"));
      }
    };

    const onError = (error: unknown): void => {
      cleanupSocketListeners();
      this.#fail(error);
    };

    const onClose = (): void => {
      cleanupSocketListeners();
      // The response parser is finished with the connection.
      parser.free();
      if (!this.res && !this.aborted) {
        // The connection went before any response arrived, which is the one
        // case a client cannot recover from on its own.
        this.#fail(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
      }
    };

    const cleanupSocketListeners = (): void => {
      socket.removeListener("data", onData);
      socket.removeListener("end", onEnd);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    };

    parser.onHeadersComplete = (info) => {
      const message = new IncomingMessage(socket);
      message.httpVersionMajor = info.versionMajor;
      message.httpVersionMinor = info.versionMinor;
      message.httpVersion = `${info.versionMajor}.${info.versionMinor}`;
      message.statusCode = info.statusCode;
      message.statusMessage = info.statusMessage;
      message.keepAlive = info.shouldKeepAlive;
      message._addHeaders(info.headers);
      message.setSource(() => socket.resume());

      // An informational response is not *the* response: the real one follows
      // on the same connection, so the parser has to carry on rather than
      // treat this as the message.
      if (info.statusCode >= 100 && info.statusCode < 200) {
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

      response = message;
      this.res = message;
      this.emit("response", message);

      // The reply to a HEAD carries the length the body *would* have had. A
      // parser that believed it would wait for bytes that never come.
      return this.method === "HEAD" ? 1 : 0;
    };

    parser.onBody = (chunk) => {
      if (response && !response.push(Buffer.from(chunk))) socket.pause();
    };

    parser.onMessageComplete = () => {
      if (!response) return;
      response.complete = true;
      response.push(null);
      // A client parser belongs to this request, not to a pooled socket. The
      // socket may survive for another request, but this parser's async
      // resource is finished as soon as the response is complete.
      parser.free();
      cleanupSocketListeners();
      this.#finishResponse(socket, response);
    };

    socket.on("data", onData);
    socket.on("end", onEnd);
    socket.on("error", onError);
    socket.on("close", onClose);

    if (this.#timeoutMs !== undefined) {
      socket.setTimeout(this.#timeoutMs, () => this.emit("timeout"));
    }

    this.emit("socket", socket);
  }

  #finishResponse(socket: Socket, response: IncomingMessage): void {
    const reusable = this.shouldKeepAlive && response.keepAlive && !this.destroyed;
    if (this.agent) {
      this.agent.release(
        this.agent.getName({ host: this.host, port: this.port }),
        socket,
        reusable,
      );
      return;
    }
    // No agent means nothing owns this socket. Keeping it open because both
    // ends agreed to keep-alive would leave it open forever with nobody to
    // reuse it -- and, because a socket holds the loop, would stop the process
    // from ever exiting. `agent: false` means "this connection is mine and it
    // ends with this request".
    socket.destroy();
  }

  #fail(error: unknown): void {
    if (this.aborted) return;
    this.emit("error", error);
    this.destroy();
  }

  /** Node's older name for `destroy`, kept because programs call it. */
  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.emit("abort");
    this.destroy();
  }

  override setTimeout(msecs: number, callback?: () => void): this {
    this.#timeoutMs = msecs;
    if (callback) this.once("timeout", callback);
    this.socket?.setTimeout(msecs, () => this.emit("timeout"));
    return this;
  }

  /** Disable Nagle on the underlying socket once there is one. */
  setNoDelay(enable = true): void {
    this.socket?.setNoDelay(enable);
  }

  setSocketKeepAlive(enable = true, initialDelay = 0): void {
    this.socket?.setKeepAlive(enable, initialDelay);
  }
}

/** `http.request("http://host/path")`, taken apart. */
function parseUrlish(url: string): RequestOptions {
  const match = /^https?:\/\/([^/:?#]+)(?::(\d+))?([^#]*)?$/.exec(url);
  if (!match) throw new ERR_INVALID_ARG_TYPE("url", "a valid URL", url);
  return {
    hostname: match[1],
    port: match[2] ? Number(match[2]) : 80,
    path: match[3] || "/",
  };
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
