import { utf8Length, utf8Write } from "./utf8.ts";
import { trimASCIIWhitespace } from "./ascii.ts";
import {
  coerceToBoolean,
  coerceToDOMString,
  coerceToUSVString,
  requireArguments,
  requireDictionary,
} from "./webidl.ts";

export type AllowSharedBufferSource = ArrayBufferLike | ArrayBufferView<ArrayBufferLike>;

export interface TextEncoderEncodeIntoResult {
  read: number;
  written: number;
}

const emptyBytes = new Uint8Array(0);

function requireUint8Array(value: Uint8Array, name: string): void {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(name + " must be a Uint8Array");
  }
}

function bufferSourceBytes(
  input: AllowSharedBufferSource | undefined,
): Uint8Array<ArrayBufferLike> {
  if (input === undefined) {
    return emptyBytes;
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer || input instanceof SharedArrayBuffer) {
    return new Uint8Array(input);
  }
  throw new TypeError("TextDecoder input must be an ArrayBuffer or ArrayBufferView");
}

function utf8Label(label: string): boolean {
  return (
    label === "unicode-1-1-utf-8" ||
    label === "unicode11utf8" ||
    label === "unicode20utf8" ||
    label === "utf-8" ||
    label === "utf8" ||
    label === "x-unicode20utf8"
  );
}

/** UTF-8 algorithms; no host TextEncoder/TextDecoder or Buffer. */
export class TextEncoder {
  get encoding(): "utf-8" {
    return "utf-8";
  }

  encode(input = ""): Uint8Array<ArrayBuffer> {
    const text = coerceToUSVString(input);
    const output = new Uint8Array(utf8Length(text));
    utf8Write(output, text, 0, output.length);
    return output;
  }

  encodeInto(...args: [source: string, destination: Uint8Array]): TextEncoderEncodeIntoResult {
    requireArguments(args, 2, "TextEncoder.encodeInto");
    const input = coerceToUSVString(args[0]);
    const destination = args[1];
    requireUint8Array(destination, "TextEncoder.encodeInto destination");
    const progress = { read: 0, written: 0 };
    utf8Write(destination, input, 0, destination.length, progress);
    return progress;
  }
}

export interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

export interface TextDecodeOptions {
  stream?: boolean;
}

interface ConvertedTextDecoderOptions {
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
}

function convertTextDecoderOptions(
  options: TextDecoderOptions | null | undefined,
): ConvertedTextDecoderOptions {
  requireDictionary(options, "TextDecoder options");
  if (options === undefined || options === null) {
    return { fatal: false, ignoreBOM: false };
  }

  // Web IDL dictionary members are read and converted lexicographically.
  const fatal = coerceToBoolean(options.fatal);
  const ignoreBOM = coerceToBoolean(options.ignoreBOM);
  return { fatal, ignoreBOM };
}

function convertTextDecodeOptions(options: TextDecodeOptions | null | undefined): boolean {
  requireDictionary(options, "TextDecoder decode options");
  return options === undefined || options === null ? false : coerceToBoolean(options.stream);
}

export class TextDecoder {
  private readonly decoderFatal: boolean;
  private readonly decoderIgnoreBOM: boolean;
  private needed = 0;
  private seen = 0;
  private code = 0;
  private lower = 0x80;
  private upper = 0xbf;
  private bomSeen = false;
  private doNotFlush = false;

  constructor(label = "utf-8", options?: TextDecoderOptions) {
    const convertedLabel = coerceToDOMString(label);
    const convertedOptions = convertTextDecoderOptions(options);
    const normalized = trimASCIIWhitespace(convertedLabel).toLowerCase();
    if (!utf8Label(normalized)) {
      throw new RangeError("Only UTF-8 is implemented by this decoder");
    }
    this.decoderFatal = convertedOptions.fatal;
    this.decoderIgnoreBOM = convertedOptions.ignoreBOM;
  }
  get encoding(): "utf-8" {
    return "utf-8";
  }
  get fatal(): boolean {
    return this.decoderFatal;
  }
  get ignoreBOM(): boolean {
    return this.decoderIgnoreBOM;
  }
  private resetSequence(): void {
    this.needed = 0;
    this.seen = 0;
    this.code = 0;
    this.lower = 0x80;
    this.upper = 0xbf;
  }
  private replacement(): void {
    this.resetSequence();
    if (this.decoderFatal) {
      throw new TypeError("Invalid UTF-8");
    }
  }

  decode(...args: [input?: AllowSharedBufferSource, options?: TextDecodeOptions]): string {
    const input = bufferSourceBytes(args[0]);
    const stream = convertTextDecodeOptions(args[1]);
    if (!this.doNotFlush) {
      this.resetSequence();
      this.bomSeen = false;
    }
    this.doNotFlush = stream;

    let bomSeen = this.bomSeen;
    const pieces: string[] = [];
    let ascii = "";
    const emit = (code: number): void => {
      if (!bomSeen) {
        bomSeen = true;
        if (code === 0xfeff && !this.decoderIgnoreBOM) return;
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
        } else {
          this.replacement();
          emit(0xfffd);
        }
      } else {
        if (byte < this.lower || byte > this.upper) {
          this.replacement();
          emit(0xfffd);
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
    if (!stream) {
      if (this.needed !== 0) {
        this.replacement();
        emit(0xfffd);
      }
      this.resetSequence();
      bomSeen = false;
    }
    this.bomSeen = bomSeen;
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
