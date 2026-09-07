import { LimitError } from "../core/errors.ts";
import { ReadableStream } from "../streams/readable.ts";
import type { ContentDecoder } from "./transport.ts";

/** Resource policy applied to the final body produced by a content-coding stack. */
export interface ContentCodingPolicy {
  /** Maximum decoded bytes exposed by one response body. */
  readonly maxDecodedBytes: number;
  /** Maximum final-decoded/wire-byte expansion after the grace allowance. */
  readonly maxExpansionRatio: number;
  /** Decoded bytes allowed before the expansion ratio becomes binding. */
  readonly ratioGraceBytes: number;
}

/**
 * Server/mobile defaults. They are a configurable safety policy, not a Fetch
 * standard limit: providers that intentionally accept larger bodies can raise or
 * disable either bound explicitly.
 */
export const standardContentCodingPolicy: ContentCodingPolicy = {
  maxDecodedBytes: 256 * 1024 * 1024,
  maxExpansionRatio: 100,
  ratioGraceBytes: 1024 * 1024,
};

export function readContentCodingPolicy(
  input: Partial<ContentCodingPolicy> | undefined,
): ContentCodingPolicy {
  const policy: ContentCodingPolicy = {
    maxDecodedBytes: input?.maxDecodedBytes ?? standardContentCodingPolicy.maxDecodedBytes,
    maxExpansionRatio: input?.maxExpansionRatio ?? standardContentCodingPolicy.maxExpansionRatio,
    ratioGraceBytes: input?.ratioGraceBytes ?? standardContentCodingPolicy.ratioGraceBytes,
  };
  validateByteLimit(policy.maxDecodedBytes);
  validateByteLimit(policy.ratioGraceBytes);
  if (
    Number.isNaN(policy.maxExpansionRatio) ||
    policy.maxExpansionRatio < 1 ||
    (policy.maxExpansionRatio !== Infinity && !Number.isFinite(policy.maxExpansionRatio))
  ) {
    throw new RangeError("Invalid content-coding expansion ratio");
  }
  return policy;
}

/** Decode in HTTP order while enforcing one budget around the complete stack. */
export function decodeContentCodings(
  source: ReadableStream<Uint8Array>,
  codings: readonly string[],
  decoder: ContentDecoder,
  policy: ContentCodingPolicy,
): ReadableStream<Uint8Array> {
  if (codings.length === 0) return source;

  const budget = { encodedBytes: 0, decodedBytes: 0 };
  let decoded = countBytes(source, (length) => {
    budget.encodedBytes += length;
  });
  for (let index = codings.length - 1; index >= 0; --index) {
    const coding = codings[index];
    if (coding !== undefined) decoded = decoder.decode(coding, decoded);
  }
  return countBytes(decoded, (length) => {
    budget.decodedBytes += length;
    if (budget.decodedBytes > policy.maxDecodedBytes) {
      throw new LimitError("Decoded response exceeded configured byte limit");
    }
    const ratioLimit = budget.encodedBytes * policy.maxExpansionRatio + policy.ratioGraceBytes;
    if (budget.decodedBytes > ratioLimit) {
      throw new LimitError("Decoded response exceeded configured expansion ratio");
    }
  });
}

function countBytes(
  source: ReadableStream<Uint8Array>,
  observe: (length: number) => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    reader.releaseLock();
  };
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const result = await reader.read();
          if (result.done) {
            release();
            controller.close();
            return;
          }
          if (!(result.value instanceof Uint8Array)) {
            throw new TypeError("Content decoder produced a non-byte chunk");
          }
          observe(result.value.length);
          controller.enqueue(result.value);
        } catch (error) {
          try {
            await reader.cancel(error);
          } catch {
            /* The source may already have failed while the limit was observed. */
          } finally {
            release();
          }
          controller.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          release();
        }
      },
    },
    { highWaterMark: 0, size: (value) => value.length },
  );
}

function validateByteLimit(limit: number): void {
  if (Number.isNaN(limit) || limit < 0 || (limit !== Infinity && !Number.isSafeInteger(limit))) {
    throw new RangeError("Invalid content-coding byte limit");
  }
}
