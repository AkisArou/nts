import { ReadableStream, bytesStream, tee, transfer } from "../streams/readable.ts";
import { concatBytes, decodeUTF8, utf8 } from "../core/encoding.ts";
import { LimitError } from "../core/errors.ts";
import type { RandomSource } from "../provider/ports.ts";
import { Blob } from "../forms/blob.ts";
import { FormData } from "../forms/form-data.ts";
import { URLSearchParams } from "../forms/search-params.ts";
import { decodeMultipart } from "../forms/multipart-decode.ts";
import { encodeMultipart } from "../forms/multipart.ts";

export type BodyInit =
  | string
  | Uint8Array
  | ArrayBuffer
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
/** Internal body representation: replay source is separate from one-shot stream state. */
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

  static extract(
    input: BodyInit | null | undefined,
    random: RandomSource,
    policy: BodyPolicy,
  ): BodyState {
    if (input === undefined || input === null) return BodyState.empty(policy);
    if (input instanceof ReadableStream) {
      if (input.locked || input.disturbed) throw new TypeError("Body stream is unusable");
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
    } else blob = new Blob([input]);
    return new BodyState(blob.stream(), type, blob.size, blob, policy);
  }

  get used(): boolean {
    return this.stream?.disturbed ?? false;
  }

  get unusable(): boolean {
    return this.used || (this.stream?.locked ?? false);
  }

  get replayable(): boolean {
    return this.stream === null || this.replaySource !== null;
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
        total += result.value.length;
        if (total > this.policy.maxConsumeBytes)
          throw new LimitError("Body consumption exceeded configured limit");
        chunks.push(result.value);
      }
    } catch (error) {
      reader.cancel(error).catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
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
    const value: unknown = JSON.parse(await this.text());
    return value;
  }
  async jsonAs<T>(decode: (value: unknown) => T): Promise<T> {
    return decode(await this.json());
  }
  async blob(): Promise<Blob> {
    return new Blob([await this.bytes()], { type: this.contentType() ?? "" });
  }
  async formData(): Promise<FormData> {
    const contentType = (this.contentType() ?? "").split(";")[0]?.trim().toLowerCase();
    if (contentType === "multipart/form-data")
      return decodeMultipart(await this.bytes(), this.contentType() ?? "");
    if (contentType !== "application/x-www-form-urlencoded")
      throw new TypeError("Unsupported form Content-Type");
    const result = new FormData();
    for (const [name, value] of new URLSearchParams(await this.text())) result.append(name, value);
    return result;
  }
  protected abstract contentType(): string | null;
  /** @internal */ getState(): BodyState {
    return this.bodyState;
  }
}

export function bodyFromBytes(
  bytes: Uint8Array,
  policy: BodyPolicy = standardBodyPolicy,
): BodyState {
  const copy = bytes.slice();
  return new BodyState(bytesStream(copy), null, copy.length, new Blob([copy]), policy);
}
