import { isHTTPTabOrSpace } from "../core/ascii.ts";
import { Headers } from "../fetch/headers.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import type {
  FetchTransport,
  TransportRequest,
  TransportResponse,
} from "../fetch/transport.ts";
import type { FetchInterceptor } from "./interceptor.ts";
import { collectResponseBody } from "./response-body.ts";
import { headersRawEntries } from "../fetch/headers.ts";

/**
 * One challenge from a `WWW-Authenticate` field.
 *
 * `token68` and `parameters` are alternatives in the grammar, not a pair: a challenge
 * carries either a single opaque credential-like token or a set of named parameters,
 * and a challenge that appeared to have both would be malformed. Keeping them separate
 * rather than folding token68 into a nameless parameter means an authenticator can tell
 * `Negotiate abc==` from a parameter it does not recognise.
 */
export interface AuthenticationChallenge {
  /** Lower-cased, because schemes are case-insensitive and callers compare them. */
  readonly scheme: string;
  readonly token68: string | null;
  /** Lower-cased names; values exactly as sent, with quoted pairs unescaped. */
  readonly parameters: readonly HeaderEntry[];
}

export interface AuthenticationContext {
  readonly request: TransportRequest;
  readonly status: number;
  readonly headers: readonly HeaderEntry[];
  readonly challenges: readonly AuthenticationChallenge[];
  /** One for the first challenge answered, not the original request. */
  readonly attempt: number;
}

/** Return a complete `Authorization` value, or null to decline every challenge. */
export type OriginAuthenticator = (
  context: AuthenticationContext,
) => string | null | Promise<string | null>;

export interface AuthenticationOptions {
  readonly authenticate: OriginAuthenticator;
  /** Defaults to 1. A second failure with the same credentials is not a third chance. */
  readonly maximumAttempts?: number;
  /**
   * Statuses that carry a challenge. Defaults to `[401]`.
   *
   * `407` is deliberately not here: proxy authentication belongs to the proxy layer,
   * which knows which hop the challenge came from. An interceptor answering it would
   * send origin credentials to a proxy.
   */
  readonly statuses?: readonly number[];
  /** Bytes of the challenge response read and discarded. Defaults to 64 KiB. */
  readonly maxDiscardedBytes?: number;
}

const isTokenChar = (code: number): boolean =>
  (code >= 0x30 && code <= 0x39) ||
  (code >= 0x41 && code <= 0x5a) ||
  (code >= 0x61 && code <= 0x7a) ||
  code === 0x21 ||
  (code >= 0x23 && code <= 0x27) ||
  code === 0x2a ||
  code === 0x2b ||
  code === 0x2d ||
  code === 0x2e ||
  code === 0x5e ||
  code === 0x5f ||
  code === 0x60 ||
  code === 0x7c ||
  code === 0x7e;

/** token68 adds the base64 alphabet and its padding to the token characters. */
const isToken68Char = (code: number): boolean =>
  (code >= 0x30 && code <= 0x39) ||
  (code >= 0x41 && code <= 0x5a) ||
  (code >= 0x61 && code <= 0x7a) ||
  code === 0x2d ||
  code === 0x2e ||
  code === 0x5f ||
  code === 0x7e ||
  code === 0x2b ||
  code === 0x2f;

class ChallengeReader {
  readonly #value: string;
  #index = 0;

  constructor(value: string) {
    this.#value = value;
  }

  get done(): boolean {
    return this.#index >= this.#value.length;
  }

  get position(): number {
    return this.#index;
  }

  skipSpace(): void {
    while (this.#index < this.#value.length && isHTTPTabOrSpace(this.#value.charCodeAt(this.#index)))
      this.#index++;
  }

  /** Skips commas and whitespace, reporting whether any comma was there. */
  skipCommas(): boolean {
    let found = false;
    for (;;) {
      this.skipSpace();
      if (this.#index < this.#value.length && this.#value.charCodeAt(this.#index) === 0x2c) {
        found = true;
        this.#index++;
        continue;
      }
      return found;
    }
  }

  peek(): number {
    return this.#index < this.#value.length ? this.#value.charCodeAt(this.#index) : -1;
  }

  advance(): void {
    this.#index++;
  }

  /** Only ever backwards, to a position this reader has already returned. */
  rewind(position: number): void {
    if (position > this.#index) throw new RangeError("A challenge reader only rewinds");
    this.#index = position;
  }

  token(): string {
    const start = this.#index;
    while (this.#index < this.#value.length && isTokenChar(this.#value.charCodeAt(this.#index)))
      this.#index++;
    return this.#value.slice(start, this.#index);
  }

  token68(): string {
    const start = this.#index;
    while (this.#index < this.#value.length && isToken68Char(this.#value.charCodeAt(this.#index)))
      this.#index++;
    const end = this.#index;
    // Padding is trailing only, and a token68 that is all padding is not one.
    while (this.#index < this.#value.length && this.#value.charCodeAt(this.#index) === 0x3d)
      this.#index++;
    return end === start ? "" : this.#value.slice(start, this.#index);
  }

  /** A quoted string with `\` pairs unescaped, or null when it is unterminated. */
  quotedString(): string | null {
    if (this.peek() !== 0x22) return null;
    this.#index++;
    let out = "";
    while (this.#index < this.#value.length) {
      const code = this.#value.charCodeAt(this.#index);
      if (code === 0x5c && this.#index + 1 < this.#value.length) {
        out += this.#value.charAt(this.#index + 1);
        this.#index += 2;
        continue;
      }
      if (code === 0x22) {
        this.#index++;
        return out;
      }
      out += this.#value.charAt(this.#index);
      this.#index++;
    }
    return null;
  }
}

/**
 * Parses one or more challenges from a `WWW-Authenticate` field value.
 *
 * The grammar's difficulty is entirely that a comma separates both challenges and
 * auth-params, so `Basic realm="a", Bearer` is two challenges and `Digest realm="a",
 * qop="auth"` is one. The rule that resolves it: after a parameter, a comma followed by
 * `token=` continues the same challenge and a comma followed by a bare token starts a
 * new one. Lookahead is the only way to tell, which is why this is a reader and not a
 * split.
 *
 * A malformed tail ends parsing and keeps what was already understood. A field that
 * cannot be fully parsed is not a reason to discard a challenge the server did send.
 */
export function parseChallenges(value: string): readonly AuthenticationChallenge[] {
  const reader = new ChallengeReader(value);
  const challenges: AuthenticationChallenge[] = [];

  reader.skipCommas();
  while (!reader.done) {
    const scheme = reader.token();
    if (scheme === "") break;
    const parameters: HeaderEntry[] = [];
    let token68: string | null = null;
    // Set when the challenge ended because the next one had already begun, in which
    // case its separating comma has been consumed and must not be demanded again.
    let ranOn = false;

    reader.skipSpace();

    // token68 comes first, and only directly after the scheme. It is decided by what
    // follows rather than by its own characters: `realm` and `abc` are both valid
    // token68 syntax, and only the `=` after `realm` says which one this is. So it is
    // accepted just when the whole run reaches a comma or the end.
    if (!reader.done && reader.peek() !== 0x2c) {
      const mark = reader.position;
      const opaque = reader.token68();
      reader.skipSpace();
      if (opaque !== "" && (reader.done || reader.peek() === 0x2c)) {
        token68 = opaque;
      } else {
        reader.rewind(mark);
      }
    }

    while (token68 === null) {
      const before = reader.position;
      const hadComma = reader.skipCommas();
      if (reader.done) break;

      const mark = reader.position;
      const name = reader.token();
      if (name === "") break;

      reader.skipSpace();
      if (reader.peek() !== 0x3d) {
        // A bare token is the next challenge's scheme. It only reads as one once this
        // challenge has something of its own; directly after the scheme there is no
        // comma yet and the token68 attempt above has already had its turn.
        if (!hadComma && parameters.length === 0) break;
        reader.rewind(mark);
        ranOn = true;
        break;
      }
      reader.advance();
      reader.skipSpace();

      const quoted = reader.quotedString();
      if (quoted !== null) {
        parameters.push([name.toLowerCase(), quoted]);
        continue;
      }
      const bare = reader.token();
      if (bare === "") {
        // `name=` with nothing usable after it. Keep what is understood and stop.
        reader.rewind(before);
        break;
      }
      parameters.push([name.toLowerCase(), bare]);
    }

    challenges.push({ scheme: scheme.toLowerCase(), token68, parameters });
    if (ranOn) continue;
    if (!reader.skipCommas() && !reader.done) break;
  }
  return challenges;
}

/**
 * Answers origin authentication challenges by consulting an injected authenticator.
 *
 * Credentials are never invented and never sent before they are asked for: the first
 * request goes out as the caller wrote it, and only a challenge produces a second one.
 * That is the whole difference between an authentication hook and a credential leak —
 * a preemptive `Authorization` header goes to whoever answers the address, including
 * whoever answers it wrongly.
 */
export class AuthenticationInterceptor implements FetchInterceptor {
  readonly #authenticate: OriginAuthenticator;
  readonly #maximumAttempts: number;
  readonly #statuses: readonly number[];
  readonly #maxDiscardedBytes: number;

  constructor(options: AuthenticationOptions) {
    this.#authenticate = options.authenticate;
    this.#maximumAttempts = options.maximumAttempts ?? 1;
    this.#statuses = options.statuses ?? [401];
    this.#maxDiscardedBytes = options.maxDiscardedBytes ?? 64 * 1024;
    if (!Number.isSafeInteger(this.#maximumAttempts) || this.#maximumAttempts < 1) {
      throw new RangeError("maximumAttempts must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.#maxDiscardedBytes) || this.#maxDiscardedBytes < 0) {
      throw new RangeError("maxDiscardedBytes must be a non-negative safe integer");
    }
    for (const status of this.#statuses) {
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        throw new RangeError("Authentication status is invalid");
      }
      if (status === 407) {
        throw new RangeError(
          "407 is proxy authentication and belongs to the proxy layer, which knows the hop",
        );
      }
    }
  }

  async dispatch(request: TransportRequest, next: FetchTransport): Promise<TransportResponse> {
    let attempt = 0;
    let current = request;
    for (;;) {
      const response = await next.dispatch(current);
      if (!this.#challenged(response.status)) return response;
      if (attempt >= this.#maximumAttempts) return response;

      const challenges = collectChallenges(response.headers);
      attempt++;
      const credential = await this.#authenticate({
        request,
        status: response.status,
        headers: response.headers,
        challenges,
        attempt,
      });
      if (credential === null) return response;

      // The body of a challenge is an explanation nobody is going to read, but it has
      // to be consumed or cancelled before the connection can carry the next attempt.
      await this.#discard(response, request);

      const headers = new Headers(current.headers);
      headers.set("authorization", credential);
      current = {
        url: request.url,
        method: request.method,
        headers: headers[headersRawEntries](),
        body: replayBody(request),
        bodyLength: request.bodyLength,
        replayBody: request.replayBody,
        signal: request.signal,
        ...(request.onInformational === undefined
          ? {}
          : { onInformational: request.onInformational }),
      };
    }
  }

  #challenged(status: number): boolean {
    for (const candidate of this.#statuses) if (candidate === status) return true;
    return false;
  }

  async #discard(response: TransportResponse, request: TransportRequest): Promise<void> {
    try {
      await collectResponseBody(response, request.signal, this.#maxDiscardedBytes);
    } catch {
      // A challenge body that is too large, or fails, changes nothing about the
      // challenge itself. The connection is the transport's to give up on.
    }
  }
}

/**
 * The request body for a second attempt.
 *
 * A request that cannot replay its body has nothing to send twice, and answering a
 * challenge with an empty body would be worse than not answering it: the server would
 * see an authenticated request that is not the one the caller made.
 */
function replayBody(request: TransportRequest): TransportRequest["body"] {
  if (request.body === null) return null;
  const source = request.replayBody;
  if (source === undefined || source === null) {
    throw new TypeError("Cannot answer an authentication challenge for a one-shot body");
  }
  return source.open();
}

/** Every challenge across every `WWW-Authenticate` field, in the order sent. */
function collectChallenges(headers: readonly HeaderEntry[]): readonly AuthenticationChallenge[] {
  const challenges: AuthenticationChallenge[] = [];
  for (const [name, value] of headers) {
    if (name.toLowerCase() !== "www-authenticate") continue;
    for (const challenge of parseChallenges(value)) challenges.push(challenge);
  }
  return challenges;
}
