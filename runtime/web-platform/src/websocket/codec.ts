import { ProtocolError, LimitError } from "../core/errors.ts";
import type { RandomSource } from "../core/platform.ts";
import type { BufferedReader } from "../http1/io.ts";
import { decodeUTF8, utf8 } from "../core/encoding.ts";

export type Opcode = 0 | 1 | 2 | 8 | 9 | 10;

export interface Frame {
  fin: boolean;
  opcode: Opcode;
  payload: Uint8Array;
}

function opcode(value: number): Opcode {

  switch (value) {
    case 0:
    case 1:
    case 2:
    case 8:
    case 9:
    case 10:
      return value;
    default:
      throw new ProtocolError("Reserved WebSocket opcode");
  }
}
export async function readFrame(
  reader: BufferedReader,
  expectMasked = false,
  maxFrameBytes = 16 * 1024 * 1024,
): Promise<Frame> {
  const base = await reader.exact(2);
  const a = base[0] ?? 0;
  const b = base[1] ?? 0;
  const fin = (a & 128) !== 0;
  const code = opcode(a & 15);

  if ((a & 0x70) !== 0) throw new ProtocolError("RSV bit set without an extension");

  if (((b & 128) !== 0) !== expectMasked)
    throw new ProtocolError("Invalid WebSocket masking direction");
  let length = b & 127;

  if (code >= 8 && (!fin || length > 125))
    throw new ProtocolError("Fragmented or oversized control frame");

  if (length === 126) {
    const bytes = await reader.exact(2);
    length = (bytes[0] ?? 0) * 256 + (bytes[1] ?? 0);
    if (length < 126) throw new ProtocolError("Nonminimal frame length");
  } else if (length === 127) {
    const bytes = await reader.exact(8);
    if (((bytes[0] ?? 0) & 128) !== 0) throw new ProtocolError("Invalid 64-bit frame length");
    length = 0;
    for (const byte of bytes) {
      length = length * 256 + byte;
      if (!Number.isSafeInteger(length))
        throw new LimitError("Frame length exceeds safe integer range");
    }
    if (length < 65536) throw new ProtocolError("Nonminimal frame length");
  }

  if (length > maxFrameBytes) throw new LimitError("WebSocket frame exceeds configured limit");
  const mask = expectMasked ? await reader.exact(4) : null;
  const payload = await reader.exact(length);

  if (mask !== null)
    for (let i = 0; i < payload.length; i++) payload[i] = (payload[i] ?? 0) ^ (mask[i & 3] ?? 0);
  return { fin, opcode: code, payload };
}
/** Returned chunks may be gathered by native writev. ownPayload allows in-place masking. */
export function encodeFrame(
  frame: Frame,
  random: RandomSource,
  masked = true,
  ownPayload = false,
): readonly Uint8Array[] {
  const size = frame.payload.length;

  if (frame.opcode >= 8 && (!frame.fin || size > 125))
    throw new ProtocolError("Invalid control frame");
  const extended = size < 126 ? 0 : size < 65536 ? 2 : 8;
  const header = new Uint8Array(2 + extended + (masked ? 4 : 0));
  header[0] = (frame.fin ? 128 : 0) | frame.opcode;
  header[1] = (masked ? 128 : 0) | (size < 126 ? size : size < 65536 ? 126 : 127);

  if (extended === 2) {
    header[2] = size >>> 8;
    header[3] = size & 255;
  } else if (extended === 8) {
    let remaining = size;
    for (let i = 9; i >= 2; --i) {
      header[i] = remaining % 256;
      remaining = Math.floor(remaining / 256);
    }
  }
  let payload = frame.payload;

  if (masked) {
    const mask = header.subarray(2 + extended);
    random.fill(mask);
    if (!ownPayload) payload = payload.slice();
    for (let i = 0; i < size; i++) payload[i] = (payload[i] ?? 0) ^ (mask[i & 3] ?? 0);
  }
  return [header, payload];
}

export function validWireCloseCode(code: number): boolean {

  return (
    (code >= 3000 && code <= 4999) ||
    [1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014].includes(code)
  );
}

export function closePayload(code: number | null, reason: string): Uint8Array {

  if (code === null) {
    if (reason !== "") throw new ProtocolError("A close reason needs a code");
    return new Uint8Array(0);
  }

  if (!validWireCloseCode(code)) throw new ProtocolError("Invalid close code");
  const text = utf8.encode(reason);

  if (text.length > 123) throw new LimitError("WebSocket close reason exceeds 123 UTF-8 bytes");
  const payload = new Uint8Array(2 + text.length);
  payload[0] = code >>> 8;
  payload[1] = code & 255;

  payload.set(text, 2);
  return payload;
}

export function parseClose(payload: Uint8Array): { code: number; reason: string } {

  if (payload.length === 0) return { code: 1005, reason: "" };

  if (payload.length === 1) throw new ProtocolError("One-byte close payload");
  const code = (payload[0] ?? 0) * 256 + (payload[1] ?? 0);

  if (!validWireCloseCode(code)) throw new ProtocolError("Invalid peer close code");
  return { code, reason: decodeUTF8(payload.subarray(2), true, true) };
}
