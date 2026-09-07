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
  if (parsed.username !== "" || parsed.password !== "") {
    throw new DOMException("Credentials in a WebSocket URL are not supported", "SyntaxError");
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
    if (!isToken(protocol) || seen.has(protocol)) {
      throw new DOMException("Invalid or duplicate WebSocket subprotocol", "SyntaxError");
    }
    protocols.push(protocol);
    seen.add(protocol);
  }
  return protocols;
}

/** Convert a WebSocketStream close dictionary, including reason-only defaulting. */
export function normalizeWebSocketCloseInfo(
  input: WebSocketCloseInfo | null | undefined,
): NormalizedWebSocketClose {
  requireDictionary(input, "WebSocket close options");
  const closeCode = input?.closeCode;
  const reason = coerceToUSVString(input?.reason ?? "");
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
