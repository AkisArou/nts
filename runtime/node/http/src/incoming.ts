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

/**
 * Fields that may appear more than once and are joined with a comma.
 *
 * Everything not named here keeps its *first* value and discards later ones,
 * which is node's rule and the one that matters for `Host`: a request with two
 * of those is ambiguous about which server it is for, and taking the first is
 * at least deterministic.
 */
const commaJoined = new Set([
  "accept", "accept-charset", "accept-encoding", "accept-language",
  "access-control-request-headers", "cache-control", "connection",
  "cookie", "dav", "expect", "forwarded", "if-match", "if-none-match",
  "link", "pragma", "proxy-authenticate", "public", "sec-websocket-extensions",
  "sec-websocket-protocol", "te", "trailer", "transfer-encoding", "upgrade",
  "vary", "via", "warning", "www-authenticate", "x-forwarded-for",
]);

/**
 * Fields that keep only the first value, silently.
 *
 * Node's list. The reason these are singled out rather than falling under the
 * general rule is that they are the ones where a duplicate is most likely to
 * be an attack rather than a mistake.
 */
const firstWins = new Set([
  "age", "authorization", "content-length", "content-type", "etag", "expires",
  "from", "host", "if-modified-since", "if-unmodified-since", "last-modified",
  "location", "max-forwards", "proxy-authorization", "referer",
  "retry-after", "server", "user-agent",
]);

export interface IncomingSocket {
  remoteAddress?: string | undefined;
  remotePort?: number | undefined;
  destroy(error?: unknown, callback?: (error?: unknown) => void): unknown;
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

  socket: IncomingSocket | null;
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

  constructor(socket?: IncomingSocket) {
    // The stream's own defaults, which is what node uses here. `autoDestroy`
    // in particular: a message that has been read to the end is finished, and
    // destroying it is what emits `close`. Programs listen for that to learn
    // that a request is over -- including that a client hung up mid-request --
    // so suppressing it removes the event most servers rely on.
    super();
    this.socket = socket ?? null;
  }

  get connection(): IncomingSocket | null {
    return this.socket;
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
  _addHeaderLine(name: string, value: string, dest: Record<string, string | string[] | undefined>): void {
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
    if (commaJoined.has(key)) {
      dest[key] = `${existing}, ${value}`;
      return;
    }
    // Not in either list: node keeps the first, so that an unknown field
    // behaves like the cautious case rather than the permissive one.
    dest[key] = existing;
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

  /**
   * Stop the socket's idle timer for this message.
   *
   * Node exposes it because a request whose handling is slow -- a long upload,
   * a slow database call -- should not be killed by a timeout meant for an
   * idle connection.
   */
  setTimeout(msecs: number, callback?: () => void): this {
    this.socket?.setTimeout?.(msecs, callback);
    return this;
  }

  override _destroy(error: unknown, callback: (error?: unknown) => void): void {
    if (!this.readableEnded || !this.complete) {
      // Destroyed mid-message: the connection cannot be reused, because the
      // rest of this message is still coming and would be read as the next
      // one.
      this.aborted = true;
      this.emit("aborted");
      this.socket?.destroy(error);
    }
    callback(error);
  }
}
