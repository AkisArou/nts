import { concatBytes, decodeUTF8, utf8 } from "../core/encoding.ts";
import { LimitError } from "../core/errors.ts";
import { coerceToUSVString } from "../core/webidl.ts";
import { Blob } from "../file/blob.ts";
import { FormData } from "../forms/form-data.ts";
import { decodeMultipart } from "../forms/multipart-decode.ts";
import { encodeMultipart } from "../forms/multipart.ts";
import { parseMIMEType } from "../forms/mime.ts";
import { URLSearchParams } from "../forms/search-params.ts";
import { parsePlainText } from "../json/plain.ts";
import type { RandomSource } from "../provider/primitives.ts";
import {
  ReadableStream,
  kStreamDisturbed,
  tee,
  transfer,
} from "../streams/readable.ts";
import type { TransportBodySource } from "./transport.ts";

export type BodyInit =
  | string
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | FormData
  | URLSearchParams
  | ReadableStream<Uint8Array>;

export interface BodyPolicy {
  maxConsumeBytes: number;
  maxCloneBufferBytes: number;
}

export const standardBodyPolicy: BodyPolicy = {
  maxConsumeBytes: Infinity,
  maxCloneBufferBytes: Infinity,
};

class BlobTransportBodySource implements TransportBodySource {
  readonly length: number;
  private readonly blob: Blob;

  constructor(blob: Blob) {
    this.blob = blob;
    this.length = blob.size;
  }

  open(): ReadableStream<Uint8Array> {
    return this.blob.stream();
  }
}

/** Convert the Web IDL `BodyInit?` union without consuming streams or copying buffers. */
export function convertBodyInit(input: BodyInit | null | undefined): BodyInit | null | undefined {
  if (input === undefined || input === null) {
    return input;
  }
  if (
    input instanceof ReadableStream ||
    input instanceof URLSearchParams ||
    input instanceof FormData ||
    input instanceof Blob ||
    input instanceof ArrayBuffer ||
    ArrayBuffer.isView(input)
  ) {
    return input;
  }
  return coerceToUSVString(input);
}

/** Internal body representation: replay source is separate from one-shot stream state. */
/**
 * The body's own MIME type, supplied by whichever interface extends it.
 *
 * Symbol-keyed for the same reason as the `Headers` internals: `protected` is a
 * compile-time notion that leaves an ordinary method on the prototype, and Web IDL says an
 * interface prototype carries the interface's members and nothing else.
 */
export const bodyContentType: unique symbol = Symbol("Body content type");

export class BodyState {
  stream: ReadableStream<Uint8Array> | null;
  readonly type: string | null;
  readonly length: number | null;
  private readonly replaySource: Blob | null;
  readonly policy: BodyPolicy;

  constructor(
    stream: ReadableStream<Uint8Array> | null,
    type: string | null,
    length: number | null,
    replaySource: Blob | null,
    policy: BodyPolicy = standardBodyPolicy,
  ) {
    this.stream = stream;
    this.type = type;
    this.length = length;
    this.replaySource = replaySource;
    this.policy = policy;
  }

  static empty(policy: BodyPolicy = standardBodyPolicy): BodyState {
    return new BodyState(null, null, 0, null, policy);
  }

  /** @internal Materialize a body whose Web IDL union conversion already ran. */
  static fromConvertedBody(
    input: BodyInit | null | undefined,
    random: RandomSource,
    policy: BodyPolicy,
  ): BodyState {
    if (input === undefined || input === null) return BodyState.empty(policy);
    if (input instanceof ReadableStream) {
      if (input.locked || input[kStreamDisturbed]) throw new TypeError("Body stream is unusable");
      return new BodyState(input, null, null, null, policy);
    }
    let blob: Blob;
    let type: string | null = null;
    if (typeof input === "string") {
      type = "text/plain;charset=UTF-8";
      blob = new Blob([utf8.encode(input)]);
    } else if (input instanceof URLSearchParams) {
      type = "application/x-www-form-urlencoded;charset=UTF-8";
      blob = new Blob([input.toString()]);
    } else if (input instanceof FormData) {
      const encoded = encodeMultipart(input, random);
      blob = encoded.blob;
      type = encoded.contentType;
    } else if (input instanceof Blob) {
      blob = input;
      type = input.type || null;
    } else {
      blob = new Blob([input]);
    }
    return new BodyState(blob.stream(), type, blob.size, blob, policy);
  }

  get used(): boolean {
    return this.stream?.[kStreamDisturbed] ?? false;
  }

  get unusable(): boolean {
    return this.used || (this.stream?.locked ?? false);
  }

  get replayable(): boolean {
    return this.stream === null || this.replaySource !== null;
  }

  /** @internal Preserve replayability across the provider-neutral transport boundary. */
  transportBodySource(): TransportBodySource | null {
    return this.replaySource === null ? null : new BlobTransportBodySource(this.replaySource);
  }

  replay(): BodyState {
    if (this.stream === null) return BodyState.empty(this.policy);
    if (this.replaySource === null) throw new TypeError("Cannot replay a streaming request body");
    return new BodyState(
      this.replaySource.stream(),
      this.type,
      this.length,
      this.replaySource,
      this.policy,
    );
  }

  clone(): BodyState {
    if (this.unusable) throw new TypeError("Body is already used or locked");
    if (this.stream === null) return BodyState.empty(this.policy);
    const branches = tee(this.stream, {
      clone: (bytes) => bytes.slice(),
      size: (bytes) => bytes.length,
      maxBufferedSize: this.policy.maxCloneBufferBytes,
    });
    this.stream = branches[0];
    return new BodyState(branches[1], this.type, this.length, this.replaySource, this.policy);
  }

  transfer(): BodyState {
    if (this.unusable) throw new TypeError("Body is already used or locked");
    return new BodyState(
      this.stream === null ? null : transfer(this.stream),
      this.type,
      this.length,
      this.replaySource,
      this.policy,
    );
  }

  async consume(): Promise<Uint8Array> {
    if (this.unusable) throw new TypeError("Body is already used or locked");
    if (this.stream === null) return new Uint8Array(0);
    const reader = this.stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) return concatBytes(chunks, total);
        if (!(result.value instanceof Uint8Array)) {
          throw new TypeError("Response body stream chunks must be Uint8Array values");
        }
        total += result.value.length;
        if (total > this.policy.maxConsumeBytes)
          throw new LimitError("Body consumption exceeded configured limit");
        chunks.push(result.value);
      }
    } catch (error) {
      reader.cancel(error).catch(() => {});
      throw error;
    }
  }
}

/** Common methods for Request/Response. json() returns unknown, never a fictitious caller-chosen T. */
export abstract class Body {
  /** @internal */ protected bodyState: BodyState;

  constructor(state: BodyState) {
    this.bodyState = state;
  }

  get body(): ReadableStream<Uint8Array> | null {
    return this.bodyState.stream;
  }

  get bodyUsed(): boolean {
    return this.bodyState.used;
  }

  async bytes(): Promise<Uint8Array> {
    return this.bodyState.consume();
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = await this.bytes();
    const output = new ArrayBuffer(bytes.length);
    new Uint8Array(output).set(bytes);
    return output;
  }

  async text(): Promise<string> {
    return decodeUTF8(await this.bytes());
  }

  async json(): Promise<unknown> {
    // The shared implementation rather than the host's, because there is no host `JSON` on a
    // compiled target -- which made this method the functional hole that the JSON work exists
    // to close. `parse a JSON string` in the Fetch specification is `JSON.parse` with no
    // reviver, so the graph is materialized straight into ordinary values.
    //
    // The materialization is the host-only step. At a typed boundary -- `await r.json() as T`
    // -- the compiler generates a parser that builds `T` directly and this generic path is not
    // reached; see the note at the head of `json/plain.ts`.
    // One pass. `toPlainValue(parseJsonText(...))` builds the erased graph and then
    // walks it into ordinary objects, and nothing between those two passes is
    // observable at a boundary that takes no reviver -- 23.681ms against 8.450ms on
    // a 1.67MB document. `parsePlainText` shares the scanner, so the grammar, the
    // error text and the number conversion are still spelled once.
    return parsePlainText(await this.text());
  }

  async blob(): Promise<Blob> {
    return new Blob([await this.bytes()], { type: this[bodyContentType]() ?? "" });
  }

  async formData(): Promise<FormData> {
    const bytes = await this.bytes();
    const mime = parseMIMEType(this[bodyContentType]() ?? "");

    if (mime?.essence === "multipart/form-data") return decodeMultipart(bytes, mime);
    if (mime?.essence !== "application/x-www-form-urlencoded")
      throw new TypeError("Unsupported form Content-Type");
    const result = new FormData();
    for (const [name, value] of new URLSearchParams(decodeUTF8(bytes))) result.append(name, value);
    return result;
  }

  protected abstract [bodyContentType](): string | null;

  /** @internal */ getState(): BodyState {
    return this.bodyState;
  }
}
