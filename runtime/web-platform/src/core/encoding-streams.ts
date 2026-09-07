// `TextDecoderStream` and `TextEncoderStream`, from the Encoding standard.
//
// Both are `GenericTransformStream`: a `TransformStream` held privately, with `readable`
// and `writable` forwarded. Neither adds a codec -- the decoder is the same `TextDecoder`
// with `stream: true`, which is why pinning the eleven upstream `encoding/streams` fixtures
// tests the existing codec through a new seam rather than a second implementation.
//
// The part that is genuinely new is the encoder's surrogate handling, and it is the reason
// `TextEncoder.encode` cannot simply be called per chunk: `encode` performs USVString
// conversion, which replaces a lone surrogate with U+FFFD immediately. A high surrogate at
// the end of one chunk must instead be **held** and joined with a low surrogate at the start
// of the next. Encoding each chunk independently would turn one astral character split
// across a boundary into two replacement characters, and every value would still round-trip
// for input that happened not to straddle one.
import { requireDictionary } from "./webidl.ts";
import { TextDecoder, TextEncoder } from "./encoding.ts";
import type {
  AllowSharedBufferSource,
  DecoderEncoding,
  TextDecoderOptions,
} from "./encoding.ts";
import { TransformStream } from "../streams/transform.ts";
import type { ReadableStream } from "../streams/readable.ts";
import type { WritableStream } from "../streams/writable.ts";

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/**
 * A `TransformStream` whose chunks are decoded text.
 *
 * The decode is incremental: a multi-byte sequence split across chunks is held rather than
 * replaced, which is the whole point of the class and the thing a per-chunk `decode()`
 * without `stream: true` gets wrong.
 */
export class TextDecoderStream {
  readonly #decoder: TextDecoder;
  readonly #transform: TransformStream<AllowSharedBufferSource, string>;

  constructor(label = "utf-8", options?: TextDecoderOptions) {
    requireDictionary(options, "TextDecoderOptions");
    // Constructed first, so an unsupported label throws before any stream exists. A
    // half-built stream whose constructor threw is observable through nothing here, and
    // the standard orders it this way.
    const decoder = new TextDecoder(label, options);
    this.#decoder = decoder;
    this.#transform = new TransformStream<AllowSharedBufferSource, string>({
      transform(chunk, controller) {
        // `TextDecoder.decode()` accepts an omitted argument and answers the empty string,
        // which is right for the codec and wrong here: a stream chunk must be a buffer
        // source, so `undefined` has to error rather than decode to nothing. Every other
        // bad chunk is already refused inside `decode`; this one is not, because for the
        // codec it is not bad.
        if (chunk === undefined) {
          throw new TypeError("TextDecoderStream chunk must be a buffer source");
        }
        const text = decoder.decode(chunk, { stream: true });
        // An empty result is not enqueued. A chunk that completes nothing must not push a
        // zero-length string at the reader, which is observable as an extra read.
        if (text !== "") controller.enqueue(text);
      },
      flush(controller) {
        const text = decoder.decode();
        if (text !== "") controller.enqueue(text);
      },
    });
  }

  get encoding(): DecoderEncoding {
    return this.#decoder.encoding;
  }

  get fatal(): boolean {
    return this.#decoder.fatal;
  }

  get ignoreBOM(): boolean {
    return this.#decoder.ignoreBOM;
  }

  get readable(): ReadableStream<string> {
    return this.#transform.readable;
  }

  get writable(): WritableStream<AllowSharedBufferSource> {
    return this.#transform.writable;
  }

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
      value: "TextDecoderStream",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

/**
 * A `TransformStream` whose chunks are UTF-8 bytes.
 *
 * Holds a trailing high surrogate between chunks; see the module header for why
 * `TextEncoder.encode` cannot be used per chunk.
 */
export class TextEncoderStream {
  readonly #encoding = "utf-8" as const;
  readonly #encoder = new TextEncoder();
  #pendingHighSurrogate: number = -1;
  readonly #transform: TransformStream<string, Uint8Array>;

  constructor() {
    const encode = (input: string): Uint8Array => this.#encodeChunk(input);
    const flush = (): Uint8Array => this.#flushPending();
    this.#transform = new TransformStream<string, Uint8Array>({
      transform(chunk, controller) {
        const bytes = encode(String(chunk));
        if (bytes.length > 0) controller.enqueue(bytes);
      },
      flush(controller) {
        const bytes = flush();
        if (bytes.length > 0) controller.enqueue(bytes);
      },
    });
  }

  /**
   * Resolve one chunk into scalar values, carrying a split surrogate pair across the join.
   *
   * Lone surrogates become U+FFFD here rather than being left for `encode`, so that the
   * only surrogate still unresolved when this returns is a trailing high one that may yet
   * find its pair in the next chunk.
   */
  #encodeChunk(input: string): Uint8Array {
    let text = "";
    let pending = this.#pendingHighSurrogate;
    for (let index = 0; index < input.length; index++) {
      const unit = input.charCodeAt(index);
      if (pending >= 0) {
        if (isLowSurrogate(unit)) {
          text += String.fromCharCode(pending, unit);
          pending = -1;
          continue;
        }
        // The held high surrogate never found a pair. It is replaced, and the current unit
        // is still unprocessed -- so this falls through rather than continuing.
        text += "�";
        pending = -1;
      }
      if (isHighSurrogate(unit)) {
        pending = unit;
        continue;
      }
      text += isLowSurrogate(unit) ? "�" : String.fromCharCode(unit);
    }
    this.#pendingHighSurrogate = pending;
    return this.#encoder.encode(text);
  }

  #flushPending(): Uint8Array {
    if (this.#pendingHighSurrogate < 0) return new Uint8Array(0);
    this.#pendingHighSurrogate = -1;
    return this.#encoder.encode("�");
  }

  get encoding(): "utf-8" {
    // Through a private field, so the getter throws on a foreign receiver as Web IDL
    // requires; see the note on `TextEncoder.encoding`.
    return this.#encoding;
  }

  get readable(): ReadableStream<Uint8Array> {
    return this.#transform.readable;
  }

  get writable(): WritableStream<string> {
    return this.#transform.writable;
  }

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
      value: "TextEncoderStream",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}
