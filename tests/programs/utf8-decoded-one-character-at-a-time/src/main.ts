// A UTF-8 decoder that builds its output a character at a time, as
// runtime/web-platform's `utf8Decode` does, over text spanning every width:
// ASCII, Latin-1 (still one byte as a string, two as UTF-8), CJK (past the
// one-byte table) and an emoji (a surrogate pair from a four-byte sequence).
//
// `String.fromCharCode(byte)` takes a byte the typed array read, an integer
// converted to `number`; the code points past it are computed integers. On
// Wasm a byte is read from the one-byte string table with no call, another
// integer goes to the table or the host without a double's `ToInt32`, and a
// unit past U+00FF is the host's `String.fromCharCode`, not the
// `wasm:js-string` builtin V8 makes by internalizing a string per call
// (`node-utf8`, 2026-10-20). Every backend answers as node does.

function encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) {
      code = 0x10000 + ((code - 0xd800) << 10) + (text.charCodeAt(i + 1) - 0xdc00);
      i++;
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out[i]!;
  return bytes;
}

function decode(bytes: Uint8Array): string {
  let output = "";
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index]!;
    if (byte < 0x80) {
      output += String.fromCharCode(byte);
      index += 1;
    } else if (byte < 0xe0) {
      output += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[index + 1]! & 0x3f));
      index += 2;
    } else if (byte < 0xf0) {
      output += String.fromCharCode(
        ((byte & 0x0f) << 12) | ((bytes[index + 1]! & 0x3f) << 6) | (bytes[index + 2]! & 0x3f),
      );
      index += 3;
    } else {
      const point =
        ((byte & 0x07) << 18) |
        ((bytes[index + 1]! & 0x3f) << 12) |
        ((bytes[index + 2]! & 0x3f) << 6) |
        (bytes[index + 3]! & 0x3f);
      const supplementary = point - 0x10000;
      output += String.fromCharCode(0xd800 + (supplementary >> 10), 0xdc00 + (supplementary & 0x3ff));
      index += 4;
    }
  }
  return output;
}

const samples = ["plain ascii", "café naïve ÿ", "你好世界 こんにちは", "😀 and 🌍", "mixed: é 你 😀 z"];

function sample(which: number): string {
  return samples[Math.abs(which | 0) % samples.length]!;
}

export function decoded(which: number): string {
  return decode(encode(sample(which)));
}

export function units(which: number): string {
  const text = decoded(which);
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i).toString(16));
  return out.join(" ");
}

export function roundTrips(which: number): boolean {
  return decoded(which) === sample(which);
}

// One code unit by each road a code takes: a byte a typed array read, an
// integer, and a double `ToUint16` reduces (negative, fractional, past 2^16).
export function byteUnit(code: number): string {
  const bytes = new Uint8Array(1);
  bytes[0] = code;
  return String.fromCharCode(bytes[0]!);
}

export function intUnit(code: number): string {
  return String.fromCharCode((code | 0) & 0xffff);
}

export function numberUnit(code: number): string {
  return String.fromCharCode(code);
}
