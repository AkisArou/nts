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
import type { LookupFunction } from "../../net/src/main.ts";
import type { AbortSignalLike } from "../../internal/abort.ts";
import { nextTick } from "../../internal/tick.ts";
import {
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_HTTP_TOKEN,
  ERR_UNESCAPED_CHARACTERS,
} from "../../internal/errors.ts";
import { validateBoolean, validateOneOf } from "../../internal/validators.ts";
import { HTTPParser, RESPONSE } from "./parser.ts";
import { IncomingMessage } from "./incoming.ts";
import { checkIsHttpToken, OutgoingMessage } from "./outgoing.ts";
import type { OutgoingHeaders, OutgoingHeaderValue } from "./outgoing.ts";
import { Agent, globalAgent } from "./agent.ts";

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
  method?: string | undefined;
  headers?: RequestHeaders | undefined;
  auth?: string | undefined;
  agent?: Agent | false | undefined;
  defaultPort?: number | undefined;
  timeout?: number | undefined;
  setHost?: boolean | undefined;
  httpValidation?: "strict" | "relaxed" | "insecure" | undefined;
  insecureHTTPParser?: boolean | undefined;
  createConnection?:
    | ((
        options: RequestOptions,
        callback: (error: unknown, socket?: Socket) => void,
      ) => Socket | undefined)
    | undefined;
  lookup?: LookupFunction | undefined;
  localAddress?: string | undefined;
  localPort?: number | undefined;
  family?: number | undefined;
  hints?: number | undefined;
  socketPath?: string | undefined;
  signal?: AbortSignalLike | undefined;
  /** Node's name for "do not add a body framing", used by GET and HEAD. */
  maxHeaderSize?: number | undefined;
}

export type ResponseListener = (response: IncomingMessage) => void;

/** Methods that carry no body, so no framing header should be added. */
const BODILESS = new Set(["GET", "HEAD", "DELETE", "OPTIONS", "TRACE", "CONNECT"]);
const INVALID_PATH = /[^\u0021-\u00ff]/;

function requestHeadersAreArray(headers: RequestHeaders): headers is RequestHeaderArray {
  return Array.isArray(headers);
}

function requestHeaderIsPair(header: string | RequestHeaderPair): header is RequestHeaderPair {
  return Array.isArray(header);
}

function applyRequestHeaderArray(request: OutgoingMessage, headers: RequestHeaderArray): void {
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
    }
    return;
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
  }
}

export class ClientRequest extends OutgoingMessage {
  method: string;
  path: string;
  host: string;
  agent: Agent | null;

  aborted = false;
  reusedSocket = false;
  timeout: number | undefined;
  timeoutCb: (() => void) | null = null;
  /** The response, once its head has arrived. */
  res: IncomingMessage | null = null;

  #options: RequestOptions;
  #closeEmitted = false;
  #port: number;

  constructor(options: RequestOptions | string, callback?: ResponseListener) {
    super();

    const opts: RequestOptions =
      typeof options === "string"
        ? parseUrlish(options)
        : options.href === undefined
          ? { ...options }
          : { ...parseUrlish(options.href), ...options };
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
    if (INVALID_PATH.test(this.path)) {
      throw new ERR_UNESCAPED_CHARACTERS("Request path");
    }
    this.host = opts.hostname ?? opts.host ?? "localhost";

    const selectedAgent =
      opts.agent === false || (opts.agent === undefined && opts.createConnection !== undefined)
        ? null
        : (opts.agent ?? globalAgent);
    const defaultPort = opts.defaultPort || selectedAgent?.defaultPort || 80;
    this.#port = Number(opts.port || defaultPort);
    this.timeout = opts.timeout;

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

    if (callback) this.once("response", callback);

    // Node permits an explicit body even on methods such as GET. Such methods
    // merely default to *no framing*: an empty request is self-delimiting, but
    // writing bytes without a Content-Length or Transfer-Encoding makes the
    // connection close-delimited and therefore ineligible for reuse.
    this.hasBody = true;
    this.useChunkedEncodingByDefault = !BODILESS.has(this.method);
    this.keepAliveWithoutFramingWhenEmpty = BODILESS.has(this.method);
    this.shouldKeepAlive = true;

    const rawHeaderArray = opts.headers !== undefined && requestHeadersAreArray(opts.headers);
    if (opts.headers !== undefined) {
      if (requestHeadersAreArray(opts.headers)) {
        applyRequestHeaderArray(this, opts.headers);
      } else {
        for (const [name, value] of Object.entries(opts.headers)) {
          this.setHeader(name, value);
        }
      }
    }

    // `Host` identifies which site on a shared address the request is for, and
    // is mandatory in HTTP/1.1. Added unless the caller set it or opted out.
    if (!rawHeaderArray && opts.setHost !== false && !this.hasHeader("host")) {
      const needsPort = this.#port !== defaultPort;
      this.setHeader("Host", needsPort ? `${this.host}:${this.#port}` : this.host);
    }

    if (opts.auth && !this.hasHeader("authorization")) {
      this.setHeader("Authorization", `Basic ${Buffer.from(opts.auth).toString("base64")}`);
    }

    this.statusLine = `${this.method} ${this.path} HTTP/1.1`;

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
      signal: opts.signal,
    };
    if (this.agent) {
      this.agent.addRequest(this, connectionOptions);
    } else {
      const createConnection = opts.createConnection;
      if (createConnection === undefined) {
        const socket = globalAgent.createConnection(connectionOptions);
        nextTick(() => this.onSocket(socket));
      } else {
        let completed = false;
        const onCreated = (error: unknown, socket?: Socket): void => {
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
        try {
          const socket = createConnection(opts, onCreated);
          if (socket !== undefined) onCreated(null, socket);
        } catch (error) {
          onCreated(error);
        }
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
  onSocket(socket: Socket | null, error?: unknown): void {
    if (error !== undefined || socket === null) {
      this.#fail(error ?? new Error("Agent did not provide a socket"));
      return;
    }
    this.socket = socket;

    const parser = new HTTPParser();
    parser.initialize(
      RESPONSE,
      this.#options.maxHeaderSize,
      undefined,
      this.#options.httpValidation === "relaxed" ||
        this.#options.httpValidation === "insecure" ||
        this.#options.insecureHTTPParser === true,
      this.#options.httpValidation === "insecure" || this.#options.insecureHTTPParser === true,
    );

    let response: IncomingMessage | null = null;

    const onData = (chunk: Buffer): void => {
      const consumed = parser.execute(chunk);
      if (consumed < 0) {
        const error = parser.error;
        cleanupSocketListeners();
        this.#fail(
          Object.assign(new Error(error?.reason ?? "Parse Error"), {
            code: error?.code,
            bytesParsed: error?.bytesParsed,
          }),
        );
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
      this.#emitClose();
    };

    const cleanupSocketListeners = (): void => {
      socket.removeListener("data", onData);
      socket.removeListener("end", onEnd);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
      if (this.timeoutCb !== null) {
        socket.removeListener("timeout", this.timeoutCb);
        this.timeoutCb = null;
      }
    };

    parser.onHeadersComplete = (info) => {
      if (info.type !== RESPONSE) {
        throw new Error("response parser produced request metadata");
      }
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
      message.once("end", () => {
        // Registered before the response is exposed, so this schedules the
        // pool transition before next-tick work queued by user `end`
        // listeners. The transition itself is still deferred, which means
        // every listener in the current `end` emission sees the socket busy.
        nextTick(() => this.#finishResponse(socket, message));
      });
      if (!this.emit("response", message)) message._dump();

      // The reply to a HEAD carries the length the body *would* have had. A
      // parser that believed it would wait for bytes that never come.
      return this.method === "HEAD" ? 1 : 0;
    };

    parser.onBody = (chunk) => {
      if (response && !response.push(Buffer.from(chunk))) socket.pause();
    };

    parser.onMessageComplete = () => {
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
      // A client parser belongs to this request, not to a pooled socket. The
      // socket may survive for another request, but this parser's async
      // resource is finished as soon as the response is complete.
      parser.free();
      cleanupSocketListeners();
    };

    socket.on("data", onData);
    socket.on("end", onEnd);
    socket.on("error", onError);
    socket.on("close", onClose);

    const timeout = this.timeout ?? this.agent?.options.timeout;
    if (timeout !== undefined) {
      socket.setTimeout(timeout);
      this.timeoutCb = () => {
        this.emit("timeout");
      };
      socket.once("timeout", this.timeoutCb);
    }

    this.emit("socket", socket);
  }

  #finishResponse(socket: Socket, response: IncomingMessage): void {
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
    this.#emitClose();
    if (this.agent) {
      this.agent.release(
        this.agent.getName({ host: this.host, port: this.#port }),
        socket,
        reusable,
        typeof response.headers["keep-alive"] === "string"
          ? response.headers["keep-alive"]
          : undefined,
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

  #emitClose(): void {
    if (this.#closeEmitted) return;
    this.#closeEmitted = true;
    this.destroyed = true;
    this.emit("close");
  }

  override destroy(error?: unknown): this {
    const socket = this.socket;
    super.destroy(error);
    if (socket === null) nextTick(() => this.#emitClose());
    return this;
  }

  /** Node's older name for `destroy`, kept because programs call it. */
  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.emit("abort");
    this.destroy();
  }

  override setTimeout(msecs: number, callback?: () => void): this {
    this.timeout = msecs;
    if (callback) this.once("timeout", callback);
    const socket = this.socket;
    if (socket !== null) {
      if (this.timeoutCb !== null) socket.removeListener("timeout", this.timeoutCb);
      socket.setTimeout(msecs);
      this.timeoutCb = () => {
        this.emit("timeout");
      };
      socket.once("timeout", this.timeoutCb);
    }
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
