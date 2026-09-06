import { utf8Length, utf8Write } from "./utf8.ts";
import { trimASCIIWhitespace } from "./ascii.ts";
import { coerceToUSVString } from "./webidl.ts";

/** UTF-8 algorithms; no host TextEncoder/TextDecoder or Buffer. */
export class TextEncoder {
  readonly encoding = "utf-8";

  encode(input = ""): Uint8Array<ArrayBuffer> {
    const text = coerceToUSVString(input);
    const output = new Uint8Array(utf8Length(text));
    utf8Write(output, text, 0, output.length);
    return output;
  }

  encodeInto(input: string, destination: Uint8Array): { read: number; written: number } {
    if (typeof input !== "string") {
      throw new TypeError("TextEncoder.encodeInto source must be a string");
    }
    const progress = { read: 0, written: 0 };
    utf8Write(destination, input, 0, destination.length, progress);
    return progress;
  }
}

export interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

export class TextDecoder {
  readonly encoding = "utf-8";
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  private needed = 0;
  private seen = 0;
  private code = 0;
  private lower = 0x80;
  private upper = 0xbf;
  private bomSeen = false;

  constructor(label = "utf-8", options: TextDecoderOptions = {}) {
    const normalized = trimASCIIWhitespace(label).toLowerCase();
    if (normalized !== "utf-8" && normalized !== "utf8" && normalized !== "unicode-1-1-utf-8") {
      throw new RangeError("Only UTF-8 is implemented by this decoder");
    }
    this.fatal = options.fatal ?? false;
    this.ignoreBOM = options.ignoreBOM ?? false;
  }
  private resetSequence(): void {
    this.needed = 0;
    this.seen = 0;
    this.code = 0;
    this.lower = 0x80;
    this.upper = 0xbf;
  }
  private replacement(): string {
    this.resetSequence();
    if (this.fatal) {
      this.bomSeen = false;
      throw new TypeError("Invalid UTF-8");
    }
    this.bomSeen = true;
    return "\ufffd";
  }

  decode(input: Uint8Array = new Uint8Array(0), options: { stream?: boolean } = {}): string {
    const pieces: string[] = [];
    let ascii = "";
    const emit = (code: number): void => {
      if (!this.bomSeen) {
        this.bomSeen = true;
        if (code === 0xfeff && !this.ignoreBOM) return;
      }
      ascii += String.fromCodePoint(code);
      if (ascii.length >= 4096) {
        pieces.push(ascii);
        ascii = "";
      }
    };
    let i = 0;
    while (i < input.length) {
      const byte = input[i];
      if (byte === undefined) break;
      if (this.needed === 0) {
        i++;
        if (byte <= 0x7f) {
          emit(byte);
          continue;
        }
        if (byte >= 0xc2 && byte <= 0xdf) {
          this.needed = 1;
          this.code = byte & 0x1f;
        } else if (byte >= 0xe0 && byte <= 0xef) {
          this.needed = 2;
          this.code = byte & 0x0f;
          if (byte === 0xe0) this.lower = 0xa0;
          if (byte === 0xed) this.upper = 0x9f;
        } else if (byte >= 0xf0 && byte <= 0xf4) {
          this.needed = 3;
          this.code = byte & 7;
          if (byte === 0xf0) this.lower = 0x90;
          if (byte === 0xf4) this.upper = 0x8f;
        } else ascii += this.replacement();
      } else {
        if (byte < this.lower || byte > this.upper) {
          ascii += this.replacement();
          continue;
        }
        i++;
        this.lower = 0x80;
        this.upper = 0xbf;
        this.code = (this.code << 6) | (byte & 63);
        this.seen++;
        if (this.seen === this.needed) {
          const code = this.code;
          this.resetSequence();
          emit(code);
        }
      }
    }
    if (!options.stream) {
      if (this.needed !== 0) ascii += this.replacement();
      this.resetSequence();
      this.bomSeen = false;
    }
    pieces.push(ascii);
    return pieces.join("");
  }
}

export const utf8 = new TextEncoder();

export function decodeUTF8(bytes: Uint8Array, fatal = false, ignoreBOM = false): string {
  return new TextDecoder("utf-8", { fatal, ignoreBOM }).decode(bytes);
}

export function latin1(bytes: Uint8Array): string {
  let result = "";

  for (const byte of bytes) result += String.fromCharCode(byte);
  return result;
}

export function encodeByteString(text: string): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(text.length);

  for (let i = 0; i < text.length; ++i) {
    const value = text.charCodeAt(i);
    if (value > 255) throw new TypeError("Expected an HTTP ByteString");
    result[i] = value;
  }
  return result;
}

export function concatBytes(
  chunks: readonly Uint8Array[],
  length?: number,
): Uint8Array<ArrayBuffer> {
  let total = length;
  if (total === undefined) {
    total = 0;
    for (const chunk of chunks) {
      total += chunk.length;
    }
  }
  const result = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
