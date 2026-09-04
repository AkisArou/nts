// `node:stream/consumers`, from Node v24.20.0 `lib/stream/consumers.js`.
//
// These functions deliberately consume the source themselves. The Blob and
// TextDecoder constructors are Web-platform primitives supplied by the host;
// they are seams, not substitutes for the stream algorithms below.

import { Buffer } from "../../buffer/src/main.ts";
import { ERR_INVALID_ARG_TYPE } from "../../internal/errors.ts";

export interface ConsumerBlob {
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

interface ConsumerBlobConstructor {
  new (parts?: Iterable<unknown>): ConsumerBlob;
}

interface DecodeOptions {
  stream?: boolean;
}

interface ConsumerTextDecoder {
  decode(
    input?: ArrayBuffer | ArrayBufferView<ArrayBufferLike>,
    options?: DecodeOptions,
  ): string;
}

interface ConsumerTextDecoderConstructor {
  new (): ConsumerTextDecoder;
}

declare const Blob: ConsumerBlobConstructor;
declare const TextDecoder: ConsumerTextDecoderConstructor;

export type ConsumerSource = AsyncIterable<unknown>;

/** Consume every chunk and return a host Web `Blob`. */
export async function blob(stream: ConsumerSource): Promise<ConsumerBlob> {
  const chunks: unknown[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return new Blob(chunks);
}

/** Consume every chunk into one exact-length `ArrayBuffer`. */
export async function arrayBuffer(stream: ConsumerSource): Promise<ArrayBuffer> {
  return (await blob(stream)).arrayBuffer();
}

/** Consume every chunk into a `Buffer` sharing the resulting `ArrayBuffer`. */
export async function buffer(stream: ConsumerSource): Promise<Buffer> {
  return Buffer.from(await arrayBuffer(stream));
}

/** Consume every chunk into a plain `Uint8Array`. */
export async function bytes(stream: ConsumerSource): Promise<Uint8Array> {
  return new Uint8Array(await arrayBuffer(stream));
}

function decoderInput(chunk: unknown): ArrayBuffer | ArrayBufferView<ArrayBufferLike> {
  if (chunk instanceof ArrayBuffer) return chunk;
  if (ArrayBuffer.isView(chunk) && chunk.buffer instanceof ArrayBuffer) return chunk;
  throw new ERR_INVALID_ARG_TYPE(
    "input",
    ["ArrayBuffer", "Buffer", "TypedArray", "DataView"],
    chunk,
  );
}

/** Decode byte chunks incrementally while appending string chunks verbatim. */
export async function text(stream: ConsumerSource): Promise<string> {
  const decoder = new TextDecoder();
  let result = "";
  for await (const chunk of stream) {
    if (typeof chunk === "string") {
      result += chunk;
    } else {
      result += decoder.decode(decoderInput(chunk), { stream: true });
    }
  }
  // Flush an incomplete final code point as U+FFFD, matching TextDecoder's
  // non-fatal default.
  return result + decoder.decode(undefined, { stream: false });
}

/** Parse the UTF-8 text yielded by the source as JSON. */
export async function json(stream: ConsumerSource): Promise<unknown> {
  return JSON.parse(await text(stream));
}
