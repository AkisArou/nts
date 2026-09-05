// `http.IncomingMessage`, from node v24.20.0 `lib/_http_incoming.js`.
//
// The readable half of a message: a request as the server sees it, or a
// response as the client sees it. It is a `Readable` whose source is the
// parser, so a body arrives as it does on the wire rather than after the whole
// message has been buffered — which is the difference between streaming a
// gigabyte upload and holding it in memory.
//
// The header handling is where the specification's awkwardness lives. Field
// names are case-insensitive, most may appear once, a few may appear many
// times and mean a list, and `Set-Cookie` is a list even though nothing else
// is. Node encodes those rules in `_addHeaderLine`, and they are transcribed
// here because they are the rules, not an implementation.

import { Readable } from "../../stream/src/main.ts";
import type { AbortSignalLike } from "../../internal/abort.ts";

/** The public part of the host AbortSignal exposed by IncomingMessage. */
export interface IncomingAbortSignal extends AbortSignalLike {
  onabort: ((event: unknown) => void) | null;
}

interface IncomingAbortController {
  readonly signal: IncomingAbortSignal;
  abort(reason?: unknown): void;
}

declare const AbortController: {
  new (): IncomingAbortController;
};

/**
 * Fields that keep only the first value, silently.
 *
 * Node's list. The reason these are singled out rather than falling under the
 * general rule is that they are the ones where a duplicate is most likely to
 * be an attack rather than a mistake.
 */
const firstWins = new Set([
  "age",
  "authorization",
  "content-length",
  "content-type",
  "etag",
  "expires",
  "from",
  "host",
  "if-modified-since",
  "if-unmodified-since",
  "last-modified",
  "location",
  "max-forwards",
  "proxy-authorization",
  "referer",
  "retry-after",
  "server",
  "user-agent",
]);

export interface IncomingSocket {
  readonly destroyed: boolean;
  remoteAddress?: string | undefined;
  remotePort?: number | undefined;
  destroy(error?: unknown, callback?: (error?: unknown) => void): unknown;
  once(event: "close", listener: () => void): unknown;
  removeListener(event: "close", listener: () => void): unknown;
  setTimeout?(msecs: number, callback?: () => void): unknown;
}

export class IncomingMessage extends Readable {
  httpVersionMajor = 1;
  httpVersionMinor = 1;
  httpVersion = "1.1";

  /** Header names lowercased, values joined per the rules above. */
  headers: Record<string, string | string[] | undefined> = {};
  /** The same, in the order and case they arrived: `[name, value, ...]`. */
  rawHeaders: string[] = [];
  trailers: Record<string, string | string[] | undefined> = {};
  rawTrailers: string[] = [];

  /** Set on a request. */
  method: string | null = null;
  url = "";

  /** Set on a response. */
  statusCode: number | null = null;
  statusMessage: string | null = null;

  socket: IncomingSocket | null | undefined;
  complete = false;

  /**
   * Whether the message ended before it was complete.
   *
   * Set when the message is destroyed with bytes still outstanding, which is
   * how a program tells a client that hung up from one that finished.
   */
  aborted = false;

  /** Whether the readable side has ever asked the parser for bytes. */
  _consuming = false;
  /** The server has decided that user code will not consume this body. */
  _dumped = false;

  /** Whether the sender said it wanted the connection kept open. */
  #keepAlive = true;
  #inTrailers = false;
  #destroySocketOnDestroy = true;
  #abortController: IncomingAbortController | null = null;
  #abortSignalSocket: IncomingSocket | null = null;
  #abortSignalListener: (() => void) | null = null;
  #abortSignalDetached = false;

  constructor(socket?: IncomingSocket | null) {
    // The stream's own defaults, which is what node uses here. `autoDestroy`
    // in particular: a message that has been read to the end is finished, and
    // destroying it is what emits `close`. Programs listen for that to learn
    // that a request is over -- including that a client hung up mid-request --
    // so suppressing it removes the event most servers rely on.
    super();
    this.socket = socket;
  }

  get connection(): IncomingSocket | null | undefined {
    return this.socket;
  }

  set connection(socket: IncomingSocket | null | undefined) {
    this.socket = socket;
  }

  /**
   * Cancellation for the lifetime of this individual HTTP message.
   *
   * The host controller is allocated only when observed. A normally completed
   * message detaches before its keep-alive socket can be reused; a premature
   * socket close aborts exactly this message's stable signal.
   */
  get signal(): IncomingAbortSignal {
    if (this.#abortController === null) {
      const controller = new AbortController();
      this.#abortController = controller;
      if (this.destroyed && (!this.readableEnded || !this.complete)) {
        controller.abort();
      } else {
        this.#attachAbortSignal();
      }
    }
    return this.#abortController.signal;
  }

  #attachAbortSignal(): void {
    const controller = this.#abortController;
    if (
      controller === null ||
      controller.signal.aborted ||
      this.#abortSignalDetached ||
      this.#abortSignalListener !== null
    ) {
      return;
    }

    const socket = this.socket;
    if (socket == null) return;
    if (socket.destroyed) {
      this.#abortSignal();
      return;
    }

    const onClose = (): void => this.#abortSignal();
    this.#abortSignalSocket = socket;
    this.#abortSignalListener = onClose;
    socket.once("close", onClose);
  }

  /** Stop observing the transport after this message completes normally. */
  _detachAbortSignal(): void {
    const socket = this.#abortSignalSocket;
    const listener = this.#abortSignalListener;
    this.#abortSignalDetached = true;
    this.#abortSignalSocket = null;
    this.#abortSignalListener = null;
    if (socket !== null && listener !== null) {
      socket.removeListener("close", listener);
    }
  }

  #abortSignal(): void {
    this._detachAbortSignal();
    this.#abortController?.abort();
  }

  /**
   * The parser drives this; there is nothing to ask the socket for.
   *
   * A readable normally pulls from its source, but this one is pushed to. The
   * pull that matters is the *socket's*, and the server resumes it when this
   * message's buffer drains.
   */
  override _read(): void {
    if (!this._consuming) {
      this._readableState.readingMore = false;
      this._consuming = true;
    }
    if (!this.complete) {
      this.#resumeSource?.();
    }
  }

  /**
   * Drain a request body that its handler ignored.
   *
   * Node does this when the response finishes before user code starts reading
   * the request.  Resuming is important even when the parser has already
   * reached EOF: it advances the readable through `end`, auto-destroy, and
   * finally `close`.
   */
  _dump(): void {
    if (this._dumped) return;
    this._dumped = true;
    this.removeAllListeners("data");
    this.resume();
  }

  #resumeSource: (() => void) | null = null;

  /** Told by whoever is feeding it how to ask for more. */
  setSource(resume: () => void): void {
    this.#resumeSource = resume;
  }

  /** One header line, folded into `headers` under the rules above. */
  _addHeaderLine(
    name: string,
    value: string,
    dest: Record<string, string | string[] | undefined>,
  ): void {
    const key = name.toLowerCase();

    if (key === "set-cookie") {
      // The one field that is genuinely a list. Joining with a comma would be
      // wrong: a cookie's `Expires` attribute contains a comma, so the result
      // could not be split apart again.
      const existing = dest[key];
      if (Array.isArray(existing)) existing.push(value);
      else dest[key] = [value];
      return;
    }

    const existing = dest[key];
    if (existing === undefined) {
      dest[key] = value;
      return;
    }

    if (firstWins.has(key)) return;

    // Ordinary and extension fields form a comma-delimited list. Cookie is
    // the sole semicolon-delimited exception because each line carries a
    // separate cookie-pair rather than another value in an HTTP list.
    const separator = key === "cookie" ? "; " : ", ";
    dest[key] = `${existing}${separator}${value}`;
  }

  /** Called by the parser's `kOnHeadersComplete` equivalent. */
  _addHeaders(raw: string[]): void {
    const target = this.#inTrailers ? this.trailers : this.headers;
    const rawTarget = this.#inTrailers ? this.rawTrailers : this.rawHeaders;
    for (let i = 0; i < raw.length; i += 2) {
      const name = raw[i];
      const value = raw[i + 1];
      if (name === undefined || value === undefined) {
        throw new Error("raw HTTP headers must contain name/value pairs");
      }
      rawTarget.push(name, value);
      this._addHeaderLine(name, value, target);
    }
  }

  /** Everything after this belongs to the trailers, not the headers. */
  _beginTrailers(): void {
    this.#inTrailers = true;
  }

  set keepAlive(value: boolean) {
    this.#keepAlive = value;
  }

  get keepAlive(): boolean {
    return this.#keepAlive;
  }

  /** The transport ended this message; report it without destroying it again. */
  _destroyFromSocket(error: unknown): void {
    this.#destroySocketOnDestroy = false;
    this.destroy(error);
  }

  /**
   * Stop the socket's idle timer for this message.
   *
   * Node exposes it because a request whose handling is slow -- a long upload,
   * a slow database call -- should not be killed by a timeout meant for an
   * idle connection.
   */
  setTimeout(msecs: number, callback?: () => void): this {
    if (callback !== undefined) this.on("timeout", callback);
    this.socket?.setTimeout?.(msecs);
    return this;
  }

  override _destroy(error: unknown, callback: (error?: unknown) => void): void {
    if (!this.readableEnded || !this.complete) {
      // Destroyed mid-message: the connection cannot be reused, because the
      // rest of this message is still coming and would be read as the next
      // one.
      this.aborted = true;
      this.emit("aborted");
      this.#abortSignal();
      if (this.#destroySocketOnDestroy) this.socket?.destroy(error);
    }
    // Keep IncomingMessage's compatibility rule: unlike a generic Readable,
    // a premature peer close must not turn into an uncaught exception merely
    // because the consumer listened for `aborted` but not `error`.
    callback(this.listenerCount("error") === 0 ? undefined : error);
  }
}
