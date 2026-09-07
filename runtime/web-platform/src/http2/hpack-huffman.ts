import { LimitError, ProtocolError } from "../core/errors.ts";

// RFC 7541 Appendix B. Entry 256 is EOS and is valid only as padding.
const HUFFMAN_CODES: readonly number[] = [
  0x1ff8, 0x7fffd8, 0xfffffe2, 0xfffffe3, 0xfffffe4, 0xfffffe5, 0xfffffe6, 0xfffffe7, 0xfffffe8,
  0xffffea, 0x3ffffffc, 0xfffffe9, 0xfffffea, 0x3ffffffd, 0xfffffeb, 0xfffffec, 0xfffffed,
  0xfffffee, 0xfffffef, 0xffffff0, 0xffffff1, 0xffffff2, 0x3ffffffe, 0xffffff3, 0xffffff4,
  0xffffff5, 0xffffff6, 0xffffff7, 0xffffff8, 0xffffff9, 0xffffffa, 0xffffffb, 0x14, 0x3f8, 0x3f9,
  0xffa, 0x1ff9, 0x15, 0xf8, 0x7fa, 0x3fa, 0x3fb, 0xf9, 0x7fb, 0xfa, 0x16, 0x17, 0x18, 0, 1, 2,
  0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x5c, 0xfb, 0x7ffc, 0x20, 0xffb, 0x3fc, 0x1ffa, 0x21,
  0x5d, 0x5e, 0x5f, 0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b, 0x6c,
  0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0xfc, 0x73, 0xfd, 0x1ffb, 0x7fff0, 0x1ffc, 0x3ffc, 0x22,
  0x7ffd, 3, 0x23, 4, 0x24, 5, 0x25, 0x26, 0x27, 6, 0x74, 0x75, 0x28, 0x29, 0x2a, 7, 0x2b, 0x76,
  0x2c, 8, 9, 0x2d, 0x77, 0x78, 0x79, 0x7a, 0x7b, 0x7ffe, 0x7fc, 0x3ffd, 0x1ffd, 0xffffffc, 0xfffe6,
  0x3fffd2, 0xfffe7, 0xfffe8, 0x3fffd3, 0x3fffd4, 0x3fffd5, 0x7fffd9, 0x3fffd6, 0x7fffda, 0x7fffdb,
  0x7fffdc, 0x7fffdd, 0x7fffde, 0xffffeb, 0x7fffdf, 0xffffec, 0xffffed, 0x3fffd7, 0x7fffe0,
  0xffffee, 0x7fffe1, 0x7fffe2, 0x7fffe3, 0x7fffe4, 0x1fffdc, 0x3fffd8, 0x7fffe5, 0x3fffd9,
  0x7fffe6, 0x7fffe7, 0xffffef, 0x3fffda, 0x1fffdd, 0xfffe9, 0x3fffdb, 0x3fffdc, 0x7fffe8, 0x7fffe9,
  0x1fffde, 0x7fffea, 0x3fffdd, 0x3fffde, 0xfffff0, 0x1fffdf, 0x3fffdf, 0x7fffeb, 0x7fffec,
  0x1fffe0, 0x1fffe1, 0x3fffe0, 0x1fffe2, 0x7fffed, 0x3fffe1, 0x7fffee, 0x7fffef, 0xfffea, 0x3fffe2,
  0x3fffe3, 0x3fffe4, 0x7ffff0, 0x3fffe5, 0x3fffe6, 0x7ffff1, 0x3ffffe0, 0x3ffffe1, 0xfffeb,
  0x7fff1, 0x3fffe7, 0x7ffff2, 0x3fffe8, 0x1ffffec, 0x3ffffe2, 0x3ffffe3, 0x3ffffe4, 0x7ffffde,
  0x7ffffdf, 0x3ffffe5, 0xfffff1, 0x1ffffed, 0x7fff2, 0x1fffe3, 0x3ffffe6, 0x7ffffe0, 0x7ffffe1,
  0x3ffffe7, 0x7ffffe2, 0xfffff2, 0x1fffe4, 0x1fffe5, 0x3ffffe8, 0x3ffffe9, 0xffffffd, 0x7ffffe3,
  0x7ffffe4, 0x7ffffe5, 0xfffec, 0xfffff3, 0xfffed, 0x1fffe6, 0x3fffe9, 0x1fffe7, 0x1fffe8,
  0x7ffff3, 0x3fffea, 0x3fffeb, 0x1ffffee, 0x1ffffef, 0xfffff4, 0xfffff5, 0x3ffffea, 0x7ffff4,
  0x3ffffeb, 0x7ffffe6, 0x3ffffec, 0x3ffffed, 0x7ffffe7, 0x7ffffe8, 0x7ffffe9, 0x7ffffea, 0x7ffffeb,
  0xffffffe, 0x7ffffec, 0x7ffffed, 0x7ffffee, 0x7ffffef, 0x7fffff0, 0x3ffffee, 0x3fffffff,
];

const HUFFMAN_LENGTHS: readonly number[] = [
  13, 23, 28, 28, 28, 28, 28, 28, 28, 24, 30, 28, 28, 30, 28, 28, 28, 28, 28, 28, 28, 28, 30, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 6, 10, 10, 12, 13, 6, 8, 11, 10, 10, 8, 11, 8, 6, 6, 6, 5, 5, 5,
  6, 6, 6, 6, 6, 6, 6, 7, 8, 15, 6, 12, 10, 13, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 8, 7, 8, 13, 19, 13, 14, 6, 15, 5, 6, 5, 6, 5, 6, 6, 6, 5, 7, 7, 6, 6, 6, 5, 6,
  7, 6, 5, 5, 6, 7, 7, 7, 7, 7, 15, 11, 14, 13, 28, 20, 22, 20, 20, 22, 22, 22, 23, 22, 23, 23, 23,
  23, 23, 24, 23, 24, 24, 22, 23, 24, 23, 23, 23, 23, 21, 22, 23, 22, 23, 23, 24, 22, 21, 20, 22,
  22, 23, 23, 21, 23, 22, 22, 24, 21, 22, 23, 23, 21, 21, 22, 21, 23, 22, 23, 23, 20, 22, 22, 22,
  23, 22, 22, 23, 26, 26, 20, 19, 22, 23, 22, 25, 26, 26, 26, 27, 27, 26, 24, 25, 19, 21, 26, 27,
  27, 26, 27, 24, 21, 21, 26, 26, 28, 27, 27, 27, 20, 24, 20, 21, 22, 21, 21, 23, 22, 22, 25, 25,
  24, 24, 26, 23, 26, 27, 26, 26, 27, 27, 27, 27, 27, 28, 27, 27, 27, 27, 27, 26, 30,
];

const zeroChildren: number[] = [-1];
const oneChildren: number[] = [-1];
const symbols: number[] = [-1];

function appendNode(): number {
  zeroChildren.push(-1);
  oneChildren.push(-1);
  symbols.push(-1);
  return symbols.length - 1;
}

function buildTree(): void {
  for (let symbol = 0; symbol < HUFFMAN_CODES.length; symbol++) {
    const code = HUFFMAN_CODES[symbol] ?? 0;
    const length = HUFFMAN_LENGTHS[symbol] ?? 0;
    let node = 0;

    for (let bitIndex = length - 1; bitIndex >= 0; bitIndex--) {
      const bit = (code >>> bitIndex) & 1;
      let child = (bit === 0 ? zeroChildren[node] : oneChildren[node]) ?? -1;
      if (child < 0) {
        child = appendNode();
        if (bit === 0) zeroChildren[node] = child;
        else oneChildren[node] = child;
      }
      node = child;
    }
    symbols[node] = symbol;
  }
}

buildTree();

export function hpackHuffmanEncodedLength(input: Uint8Array): number {
  let bits = 0;
  for (const byte of input) {
    bits += HUFFMAN_LENGTHS[byte] ?? 0;
    if (!Number.isSafeInteger(bits)) throw new LimitError("HPACK Huffman string is too large");
  }
  return Math.ceil(bits / 8);
}

export function encodeHpackHuffman(input: Uint8Array): Uint8Array {
  const output = new Uint8Array(hpackHuffmanEncodedLength(input));
  let current = 0;
  let currentBits = 0;
  let outputIndex = 0;

  for (const byte of input) {
    const code = HUFFMAN_CODES[byte] ?? 0;
    const length = HUFFMAN_LENGTHS[byte] ?? 0;
    for (let bitIndex = length - 1; bitIndex >= 0; bitIndex--) {
      current = (current << 1) | ((code >>> bitIndex) & 1);
      currentBits++;
      if (currentBits === 8) {
        output[outputIndex++] = current;
        current = 0;
        currentBits = 0;
      }
    }
  }

  if (currentBits !== 0)
    output[outputIndex] = (current << (8 - currentBits)) | (255 >>> currentBits);
  return output;
}

export function decodeHpackHuffman(input: Uint8Array, maxOutputBytes: number): Uint8Array {
  const output: number[] = [];
  let node = 0;
  let trailing = 0;
  let trailingBits = 0;

  for (const byte of input) {
    for (let bitIndex = 7; bitIndex >= 0; bitIndex--) {
      const bit = (byte >>> bitIndex) & 1;
      trailing = (trailing << 1) | bit;
      trailingBits++;
      node = (bit === 0 ? zeroChildren[node] : oneChildren[node]) ?? -1;
      if (node < 0) throw new ProtocolError("Invalid HPACK Huffman code");

      const symbol = symbols[node] ?? -1;
      if (symbol < 0) continue;
      if (symbol === 256) throw new ProtocolError("HPACK Huffman EOS appeared in a string");
      if (output.length >= maxOutputBytes) {
        throw new LimitError("HPACK Huffman string exceeds configured limit");
      }
      output.push(symbol);
      node = 0;
      trailing = 0;
      trailingBits = 0;
    }
  }

  if (node !== 0 && (trailingBits > 7 || trailing !== (1 << trailingBits) - 1)) {
    throw new ProtocolError("Invalid HPACK Huffman padding");
  }
  return new Uint8Array(output);
}
