import { DOMException } from "../core/errors.ts";
import { utf8Length } from "../core/utf8.ts";
import {
  coerceToDOMString,
  coerceToUSVString,
  requireDictionary,
  toClampedUnsignedShort,
} from "../core/webidl.ts";
import { isToken } from "../fetch/headers.ts";
import type { URLParser, URLRecord } from "../provider/primitives.ts";

export interface WebSocketURLContext {
  readonly urls: URLParser;
  readonly baseURL?: string;
}

export interface WebSocketCloseInfo {
  closeCode?: number;
  reason?: string;
}

export interface NormalizedWebSocketClose {
  readonly closeCode: number | null;
  readonly reason: string;
}

function isObject(value: unknown): value is object {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

/** Convert the WebSocket constructor's DOMString-or-sequence union. */
export function convertWebSocketProtocolUnion(input: unknown): string[] {
  // Only undefined selects the optional argument's default sequence.
  // https://webidl.spec.whatwg.org/#es-overloads
  if (input === undefined) return [];
  // GetMethod selects the sequence branch only for an object with an iterator.
  // https://webidl.spec.whatwg.org/#es-union
  if (isObject(input)) {
    const method = (input as { [Symbol.iterator]?: unknown })[Symbol.iterator];
    if (method !== undefined && method !== null) {
      if (typeof method !== "function") throw new TypeError("WebSocket protocols iterator must be callable");
      const iterator = method.call(input) as Iterator<unknown>;
      if (!isObject(iterator)) throw new TypeError("WebSocket protocols iterator must be an object");
      const next = iterator.next;
      if (typeof next !== "function") throw new TypeError("WebSocket protocols iterator must have a next method");
      const values: string[] = [];
      // Convert every element before token validation. Web IDL sequence conversion
      // does not IteratorClose when an element conversion throws.
      // https://webidl.spec.whatwg.org/#create-sequence-from-iterable
      while (true) {
        const result = next.call(iterator) as IteratorResult<unknown>;
        if (!isObject(result)) throw new TypeError("WebSocket protocols iterator result must be an object");
        if (result.done) return values;
        values.push(coerceToDOMString(result.value));
      }
    }
  }
  return [coerceToDOMString(input)];
}

/** Apply the URL conversion and validation shared by both WebSocket APIs. */
export function normalizeWebSocketURL(input: unknown, context: WebSocketURLContext): URLRecord {
  const value = coerceToUSVString(input);
  let parsed: URLRecord;
  try {
    parsed = context.urls.parse(value, context.baseURL);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      parsed = context.urls.parse(
        (parsed.protocol === "http:" ? "ws:" : "wss:") + parsed.href.slice(parsed.protocol.length),
      );
    }
  } catch {
    throw new DOMException("Invalid WebSocket URL", "SyntaxError");
  }
  if ((parsed.protocol !== "ws:" && parsed.protocol !== "wss:") || parsed.href.includes("#")) {
    throw new DOMException("WebSocket requires a ws(s) URL without a fragment", "SyntaxError");
  }
  return parsed;
}

/** Convert and validate the RFC 6455 protocol offer list. */
export function normalizeWebSocketProtocols(input: string | Iterable<string>): string[] {
  const values = typeof input === "string" ? [input] : input;
  const protocols: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const protocol = coerceToDOMString(value);
    if (!isToken(protocol)) {
      throw new DOMException("Invalid or duplicate WebSocket subprotocol", "SyntaxError");
    }
    // The token is ASCII. Match deployed duplicate detection without changing
    // its spelling in the offer; WebSockets 3.1 step 9 does not specify folding.
    const key = protocol.toLowerCase();
    if (seen.has(key)) {
      throw new DOMException("Invalid or duplicate WebSocket subprotocol", "SyntaxError");
    }
    protocols.push(protocol);
    seen.add(key);
  }
  return protocols;
}

/** Convert a WebSocketStream close dictionary, including reason-only defaulting. */
export function normalizeWebSocketCloseInfo(
  input: WebSocketCloseInfo | null | undefined,
): NormalizedWebSocketClose {
  requireDictionary(input, "WebSocket close options");
  const closeCode = input?.closeCode;
  const reasonValue = input?.reason;
  const reason = coerceToUSVString(reasonValue === undefined ? "" : reasonValue);
  return validateWebSocketClose(
    closeCode === undefined ? null : toClampedUnsignedShort(closeCode),
    reason,
  );
}

/** Convert the positional WebSocket.close() arguments. */
export function normalizeWebSocketCloseArguments(
  code: number | undefined,
  reason: string,
): NormalizedWebSocketClose {
  return validateWebSocketClose(
    code === undefined ? null : toClampedUnsignedShort(code),
    coerceToUSVString(reason),
  );
}

function validateWebSocketClose(
  closeCode: number | null,
  reason: string,
): NormalizedWebSocketClose {
  let code = closeCode;
  if (code !== null && code !== 1000 && (code < 3000 || code > 4999)) {
    throw new DOMException("Close code must be 1000 or 3000..4999", "InvalidAccessError");
  }
  if (utf8Length(reason) > 123) {
    throw new DOMException("Close reason exceeds 123 UTF-8 bytes", "SyntaxError");
  }
  if (code === null && reason !== "") code = 1000;
  return { closeCode: code, reason };
}
