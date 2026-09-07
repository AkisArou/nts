import { forgivingBase64Decode } from "../core/base64.ts";
import { encodeByteString } from "../core/encoding.ts";
import { Headers } from "../fetch/headers.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import { hasToken } from "../http/fields.ts";
import { websocketAccept } from "./handshake.ts";

/** The only version RFC 6455 defines, and the only one this server speaks. */
const VERSION = "13";

export interface WebSocketUpgradeOptions {
  /**
   * Subprotocols this server supports, in the server's order of preference.
   *
   * Selection is the server's choice among what the client offered, so the server's
   * order wins rather than the client's. Omitting this declines every offer, which is
   * what a server that speaks no subprotocol must do.
   */
  readonly protocols?: readonly string[];
}

export interface WebSocketUpgradeAccepted {
  readonly accepted: true;
  readonly status: 101;
  readonly statusText: string;
  readonly headers: readonly HeaderEntry[];
  /** The selected subprotocol, or null when none was selected. */
  readonly protocol: string | null;
}

export interface WebSocketUpgradeRefused {
  readonly accepted: false;
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly HeaderEntry[];
  /** Why it was refused. Diagnostic text, not a wire value. */
  readonly reason: string;
}

export type WebSocketUpgradeOutcome = WebSocketUpgradeAccepted | WebSocketUpgradeRefused;

function refuse(
  status: number,
  statusText: string,
  reason: string,
  extra: readonly HeaderEntry[] = [],
): WebSocketUpgradeRefused {
  return {
    accepted: false,
    status,
    statusText,
    reason,
    headers: [...extra, ["connection", "close"]],
  };
}

/**
 * Whether a client's `Sec-WebSocket-Key` is well formed.
 *
 * The RFC defines it as the base64 encoding of sixteen random bytes. The accept value
 * is computed from the literal string either way, so a malformed key would still
 * produce a handshake both sides agree on — which is exactly why it is checked here
 * rather than left to work by accident.
 */
function isWellFormedKey(key: string): boolean {
  if (key.length === 0) return false;
  for (let index = 0; index < key.length; index++) {
    const code = key.charCodeAt(index);
    // No whitespace, and nothing outside the base64 alphabet's byte range.
    if (code <= 0x20 || code > 0x7e) return false;
  }
  const decoded = forgivingBase64Decode(encodeByteString(key));
  return decoded !== null && decoded.length === 16;
}

/** Comma-separated subprotocol tokens, in the order the client offered them. */
function offeredProtocols(header: string | null): readonly string[] {
  if (header === null) return [];
  const offered: string[] = [];
  for (const piece of header.split(",")) {
    const token = piece.trim();
    if (token !== "") offered.push(token);
  }
  return offered;
}

/**
 * Decides a server's response to a WebSocket upgrade request.
 *
 * This is the handshake only: it validates the request and produces the response
 * headers, and performs no I/O. The caller owns reading the request, writing the
 * response, and taking over the connection, because those belong to whatever HTTP
 * server this is embedded in.
 *
 * Every refusal is a real HTTP response rather than a dropped connection, so a client
 * learns why. A wrong version is the one refusal the RFC gives a specific shape: it
 * must advertise the version the server does speak.
 */
export function acceptWebSocketUpgrade(
  method: string,
  requestHeaders: Headers | readonly HeaderEntry[],
  options: WebSocketUpgradeOptions = {},
): WebSocketUpgradeOutcome {
  const headers =
    requestHeaders instanceof Headers ? requestHeaders : new Headers([...requestHeaders]);

  if (method !== "GET") {
    return refuse(405, "Method Not Allowed", "A WebSocket upgrade must be a GET", [
      ["allow", "GET"],
    ]);
  }
  if (!hasToken(headers, "upgrade", "websocket")) {
    return refuse(400, "Bad Request", "Upgrade must name websocket");
  }
  if (!hasToken(headers, "connection", "upgrade")) {
    return refuse(400, "Bad Request", "Connection must contain the Upgrade token");
  }
  const version = headers.get("sec-websocket-version");
  if (version === null || version.trim() !== VERSION) {
    // The RFC requires the supported version to be advertised, so a client can retry
    // knowing what to send rather than guessing.
    return refuse(426, "Upgrade Required", "Unsupported WebSocket version", [
      ["sec-websocket-version", VERSION],
    ]);
  }
  const key = headers.get("sec-websocket-key");
  if (key === null || !isWellFormedKey(key.trim())) {
    return refuse(400, "Bad Request", "Sec-WebSocket-Key must be sixteen base64 bytes");
  }

  const supported = options.protocols ?? [];
  const offered = offeredProtocols(headers.get("sec-websocket-protocol"));
  let protocol: string | null = null;
  for (const candidate of supported) {
    if (offered.includes(candidate)) {
      protocol = candidate;
      break;
    }
  }

  const responseHeaders: HeaderEntry[] = [
    ["upgrade", "websocket"],
    ["connection", "Upgrade"],
    ["sec-websocket-accept", websocketAccept(key.trim())],
  ];
  if (protocol !== null) responseHeaders.push(["sec-websocket-protocol", protocol]);
  // Extensions are declined. A server may always decline, and negotiating
  // permessage-deflate from the server side needs an offer parser this does not have;
  // answering an offer it cannot fully honour would be worse than declining it.
  return {
    accepted: true,
    status: 101,
    statusText: "Switching Protocols",
    headers: responseHeaders,
    protocol,
  };
}

/** Serializes an outcome as an HTTP/1.1 response head, including the blank line. */
export function serializeUpgradeResponse(outcome: WebSocketUpgradeOutcome): string {
  let head = "HTTP/1.1 " + String(outcome.status) + " " + outcome.statusText + "\r\n";
  for (const [name, value] of outcome.headers) head += name + ": " + value + "\r\n";
  return head + "\r\n";
}
