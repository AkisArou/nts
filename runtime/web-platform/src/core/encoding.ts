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
    // A view whose buffer was transferred reports zero length, and constructing over it
    // throws. Web IDL says getting a copy of a detached buffer source yields an empty byte
    // sequence, so an emptied view decodes to nothing rather than failing.
    if (input.byteLength === 0) return emptyBytes;
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer || input instanceof SharedArrayBuffer) {
    if (input.byteLength === 0) return emptyBytes;
    return new Uint8Array(input);
  }
  throw new TypeError("TextDecoder input must be an ArrayBuffer or ArrayBufferView");
}

/** The three encodings this decoder implements, by their canonical names. */
export type DecoderEncoding = "utf-8" | "utf-16le" | "utf-16be";

/**
 * The label sets are the Encoding standard's, verbatim.
 *
 * `utf-16` is a label for UTF-16**LE**, which reads as a mistake and is not one: the
 * standard resolves the ambiguity in favour of little-endian and a decoder that guessed
 * from a BOM instead would disagree with every other implementation.
 */
function utf16Label(label: string): DecoderEncoding | null {
  if (label === "unicodefffe" || label === "utf-16be") return "utf-16be";
  if (
    label === "csunicode" ||
    label === "iso-10646-ucs-2" ||
    label === "ucs-2" ||
    label === "unicode" ||
    label === "unicodefeff" ||
    label === "utf-16" ||
    label === "utf-16le"
  ) {
    return "utf-16le";
  }
  return null;
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
  readonly #encoding = "utf-8" as const;

  get encoding(): "utf-8" {
    // Read through a private field on purpose. Web IDL requires an attribute getter to
    // throw when its receiver is not an instance -- reading `TextEncoder.prototype.encoding`
    // must be a TypeError -- and a literal return answers for any receiver at all.
    return this.#encoding;
  }

  /**
   * The Web IDL brand check, as a private member read.
   *
   * Reading any private member throws `TypeError` on a receiver that is not an instance,
   * which is what Web IDL requires of every operation. `encode` otherwise never touches
   * `this`, so without this it answers happily for `null`.
   */
  #brand(): void {}

  encode(input = ""): Uint8Array<ArrayBuffer> {
    this.#brand();
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

  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    // Web IDL gives operations `{ writable: true, enumerable: true, configurable: true }`
    // and attribute accessors `{ enumerable: true, configurable: true }`; ES class members
    // are non-enumerable, so every one of these was wrong. Safe to do here and not
    // everywhere, because this class has no non-standard members left on its prototype --
    // its internals are private identifiers. Doing it on a class that still exposes
    // internals would enumerate those too, making one deviation worse to fix the other.
    for (const key of Object.getOwnPropertyNames(this.prototype)) {
      if (key === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(this.prototype, key);
      if (descriptor === undefined || descriptor.enumerable) continue;
      descriptor.enumerable = true;
      Object.defineProperty(this.prototype, key, descriptor);
    }
    // Web IDL: an operation's `length` is its required-argument count. The `...args` tuple
    // that keeps an omitted argument distinguishable from an explicit `undefined` reports
    // zero, so the two required arguments are declared.
    Object.defineProperty(this.prototype.encodeInto, "length", {
      value: 2,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    // Web IDL member attributes; this prototype carries no non-standard names.
    for (const key of Object.getOwnPropertyNames(this.prototype)) {
      if (key === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(this.prototype, key);
      if (descriptor === undefined || descriptor.enumerable) continue;
      descriptor.enumerable = true;
      Object.defineProperty(this.prototype, key, descriptor);
    }
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "TextEncoder",
      writable: false,
      enumerable: false,
      configurable: true,
    });
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
  #decoderEncoding: DecoderEncoding;
  #decoderFatal: boolean;
  #decoderIgnoreBOM: boolean;
  /** The odd byte of a UTF-16 code unit split across chunks, or -1. */
  private pendingByte = -1;
  /** A high surrogate waiting for its low half, or -1. */
  private pendingLead = -1;
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
    const utf16 = utf16Label(normalized);
    if (utf16 === null && !utf8Label(normalized)) {
      throw new RangeError("This decoder implements UTF-8, UTF-16LE and UTF-16BE");
    }
    this.#decoderEncoding = utf16 ?? "utf-8";
    this.#decoderFatal = convertedOptions.fatal;
    this.#decoderIgnoreBOM = convertedOptions.ignoreBOM;
  }
  get encoding(): DecoderEncoding {
    return this.#decoderEncoding;
  }
  get fatal(): boolean {
    return this.#decoderFatal;
  }
  get ignoreBOM(): boolean {
    return this.#decoderIgnoreBOM;
  }
  #resetSequence(): void {
    this.needed = 0;
    this.seen = 0;
    this.code = 0;
    this.lower = 0x80;
    this.upper = 0xbf;
    this.pendingByte = -1;
    this.pendingLead = -1;
  }
  #replacement(): void {
    this.#resetSequence();
    if (this.#decoderFatal) {
      throw new TypeError("Invalid UTF-8");
    }
  }

  /**
   * UTF-16, either endianness, with the same streaming discipline as the UTF-8 machine.
   *
   * Two pieces of state survive a chunk boundary and both are error cases at the end of
   * a non-streaming decode: a single byte with no partner, and a lead surrogate with no
   * trail. A decoder that dropped either would turn a truncated stream into a shorter
   * valid one, which is the failure the `fatal` flag exists to make visible.
   */
  #decodeUTF16(
    input: Uint8Array,
    stream: boolean,
    emit: (code: number) => void,
  ): void {
    const bigEndian = this.#decoderEncoding === "utf-16be";
    for (let index = 0; index < input.length; index++) {
      const byte = input[index];
      if (byte === undefined) break;
      if (this.pendingByte === -1) {
        this.pendingByte = byte;
        continue;
      }
      const unit = bigEndian ? (this.pendingByte << 8) | byte : (byte << 8) | this.pendingByte;
      this.pendingByte = -1;

      if (this.pendingLead !== -1) {
        const lead = this.pendingLead;
        this.pendingLead = -1;
        if (unit >= 0xdc00 && unit <= 0xdfff) {
          emit(0x10000 + ((lead - 0xd800) << 10) + (unit - 0xdc00));
          continue;
        }
        // The lead was unpaired. It is an error on its own, and the unit that revealed
        // it is then processed as a fresh one rather than swallowed with it.
        this.#utf16Error();
        emit(0xfffd);
      }

      if (unit >= 0xd800 && unit <= 0xdbff) {
        this.pendingLead = unit;
        continue;
      }
      if (unit >= 0xdc00 && unit <= 0xdfff) {
        this.#utf16Error();
        emit(0xfffd);
        continue;
      }
      emit(unit);
    }

    if (stream) return;
    if (this.pendingLead !== -1 || this.pendingByte !== -1) {
      this.pendingLead = -1;
      this.pendingByte = -1;
      this.#utf16Error();
      emit(0xfffd);
    }
  }

  #utf16Error(): void {
    if (this.#decoderFatal) throw new TypeError("Invalid UTF-16");
  }

  decode(...args: [input?: AllowSharedBufferSource, options?: TextDecodeOptions]): string {
    const input = bufferSourceBytes(args[0]);
    const stream = convertTextDecodeOptions(args[1]);
    if (!this.doNotFlush) {
      this.#resetSequence();
      this.bomSeen = false;
    }
    this.doNotFlush = stream;

    let bomSeen = this.bomSeen;
    const pieces: string[] = [];
    let ascii = "";
    const emit = (code: number): void => {
      if (!bomSeen) {
        bomSeen = true;
        if (code === 0xfeff && !this.#decoderIgnoreBOM) return;
      }
      ascii += String.fromCodePoint(code);
      if (ascii.length >= 4096) {
        pieces.push(ascii);
        ascii = "";
      }
    };
    if (this.#decoderEncoding !== "utf-8") {
      this.#decodeUTF16(input, stream, emit);
      this.bomSeen = bomSeen;
      pieces.push(ascii);
      return pieces.join("");
    }
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
          this.#replacement();
          emit(0xfffd);
        }
      } else {
        if (byte < this.lower || byte > this.upper) {
          this.#replacement();
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
          this.#resetSequence();
          emit(code);
        }
      }
    }
    if (!stream) {
      if (this.needed !== 0) {
        this.#replacement();
        emit(0xfffd);
      }
      this.#resetSequence();
      bomSeen = false;
    }
    this.bomSeen = bomSeen;
    pieces.push(ascii);
    return pieces.join("");
  }

  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    // Web IDL gives operations `{ writable: true, enumerable: true, configurable: true }`
    // and attribute accessors `{ enumerable: true, configurable: true }`; ES class members
    // are non-enumerable, so every one of these was wrong. Safe to do here and not
    // everywhere, because this class has no non-standard members left on its prototype --
    // its internals are private identifiers. Doing it on a class that still exposes
    // internals would enumerate those too, making one deviation worse to fix the other.
    for (const key of Object.getOwnPropertyNames(this.prototype)) {
      if (key === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(this.prototype, key);
      if (descriptor === undefined || descriptor.enumerable) continue;
      descriptor.enumerable = true;
      Object.defineProperty(this.prototype, key, descriptor);
    }
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "TextDecoder",
      writable: false,
      enumerable: false,
      configurable: true,
    });
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
