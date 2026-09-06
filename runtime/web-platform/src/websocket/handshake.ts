import { asciiBytes } from "../core/encoding.ts";
import type { RandomSource } from "../core/platform.ts";
import { Headers } from "../fetch/headers.ts";
import { hasToken } from "../http1/parser.ts";
import { ProtocolError } from "../core/errors.ts";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function base64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    result += alphabet.charAt(a >>> 2) + alphabet.charAt(((a & 3) << 4) | (b >>> 4));
    result += i + 1 < bytes.length ? alphabet.charAt(((b & 15) << 2) | (c >>> 6)) : "=";
    result += i + 2 < bytes.length ? alphabet.charAt(c & 63) : "=";
  }
  return result;
}
function rotate(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}
/** SHA-1 is used ONLY for RFC 6455's fixed handshake, not for security signatures. */
export function websocketAccept(key: string): string {
  const input = asciiBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
  const length = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(length);
  bytes.set(input);
  bytes[input.length] = 128;
  const view = new DataView(bytes.buffer);
  view.setUint32(length - 4, input.length * 8, false);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const words = new Int32Array(80);
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getInt32(offset + i * 4, false);
    for (let i = 16; i < 80; i++)
      words[i] = rotate(
        (words[i - 3] ?? 0) ^ (words[i - 8] ?? 0) ^ (words[i - 14] ?? 0) ^ (words[i - 16] ?? 0),
        1,
      );
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      const f =
        i < 20
          ? (b & c) | (~b & d)
          : i < 40
            ? b ^ c ^ d
            : i < 60
              ? (b & c) | (b & d) | (c & d)
              : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const next = (rotate(a, 5) + f + e + k + (words[i] ?? 0)) | 0;
      e = d;
      d = c;
      c = rotate(b, 30);
      b = a;
      a = next;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  const output = new Uint8Array(20);
  const out = new DataView(output.buffer);
  out.setInt32(0, h0);
  out.setInt32(4, h1);
  out.setInt32(8, h2);
  out.setInt32(12, h3);
  out.setInt32(16, h4);
  return base64(output);
}
export function createKey(random: RandomSource): string {
  const bytes = new Uint8Array(16);
  random.fill(bytes);
  return base64(bytes);
}
export function validateHandshake(
  status: number,
  headers: Headers,
  key: string,
  protocols: readonly string[],
): string {
  if (
    status !== 101 ||
    !hasToken(headers, "connection", "upgrade") ||
    headers.get("upgrade")?.toLowerCase() !== "websocket"
  ) {
    throw new ProtocolError("Server did not perform a WebSocket upgrade");
  }
  if (headers.get("sec-websocket-accept") !== websocketAccept(key))
    throw new ProtocolError("Invalid Sec-WebSocket-Accept");
  if (headers.has("sec-websocket-extensions"))
    throw new ProtocolError("Unsolicited WebSocket extension");
  const selected = headers.get("sec-websocket-protocol");
  if (selected === null) {
    if (protocols.length !== 0)
      throw new ProtocolError("Server did not select an offered subprotocol");
    return "";
  }
  if (!protocols.includes(selected))
    throw new ProtocolError("Unsolicited or ambiguous subprotocol");
  return selected;
}
