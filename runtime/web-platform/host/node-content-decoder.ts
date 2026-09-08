import type { Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate, createInflateRaw } from "node:zlib";
import { ReadableStream } from "../src/streams/readable.ts";
import type { ContentDecoder } from "../src/provider.ts";
import { HostNodeReadable } from "./node-primitives.ts";

type ByteReader = ReturnType<ReadableStream<Uint8Array>["getReader"]>;

/** Native zlib is a codec primitive; HTTP policy and header handling remain shared. */
export class HostNodeContentDecoder implements ContentDecoder {
  readonly codings = ["br", "gzip", "deflate"];

  supports(coding: string): boolean {
    return coding === "gzip" || coding === "deflate" || coding === "br";
  }

  decode(coding: string, source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    switch (coding) {
      case "gzip":
        return decodeThroughTransform(
          source.getReader(),
          createGunzip({ chunkSize: 65536 }),
          [],
          false,
        );
      case "deflate":
        return decodeDeflate(source);
      case "br":
        return decodeThroughTransform(
          source.getReader(),
          createBrotliDecompress({ chunkSize: 65536 }),
          [],
          false,
        );
      default:
        throw new TypeError("Unsupported content coding");
    }
  }
}

function decodeThroughTransform(
  input: ByteReader,
  transform: Transform,
  initial: readonly Uint8Array[],
  inputEnded: boolean,
): ReadableStream<Uint8Array> {
  const output = new HostNodeReadable(transform);
  let canceled = false;
  const write = (bytes: Uint8Array): Promise<void> =>
    new Promise<void>((resolve, reject) =>
      transform.write(bytes, (error) => (error ? reject(error) : resolve())),
    );

  const feed = async (): Promise<void> => {
    try {
      for (const bytes of initial) {
        if (canceled) return;
        await write(bytes);
      }
      if (inputEnded) {
        transform.end();
        return;
      }
      while (!canceled) {
        const result = await input.read();
        if (result.done) {
          transform.end();
          return;
        }
        await write(result.value);
      }
    } catch (error) {
      transform.destroy(
        error instanceof Error
          ? error
          : new TypeError("Decompression input failed", { cause: error }),
      );
    } finally {
      input.releaseLock();
    }
  };

  feed().catch((error) => output.fail(error));
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const bytes = await output.read(65536);
          if (bytes === null) controller.close();
          else controller.enqueue(bytes);
        } catch (error) {
          canceled = true;
          input.cancel(error).catch(() => {});
          controller.error(error);
        }
      },
      async cancel(reason) {
        canceled = true;
        transform.destroy();
        try {
          await input.cancel(reason);
        } catch {
          /* Already released or errored. */
        }
      },
    },
    { highWaterMark: 0, size: (value) => value.length },
  );
}

/** HTTP peers still send both zlib-wrapped and raw streams under `deflate`. */
function decodeDeflate(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const input = source.getReader();
  let reader: ByteReader | undefined;
  let initialization: Promise<void> | undefined;
  let canceled = false;
  let inputHandedOff = false;
  let decodedReleased = false;
  const releaseDecoded = (): void => {
    if (reader === undefined || decodedReleased) return;
    decodedReleased = true;
    reader.releaseLock();
  };

  const initialize = async (): Promise<void> => {
    const initial: Uint8Array[] = [];
    let byteCount = 0;
    let ended = false;
    while (byteCount < 2 && !canceled) {
      const result = await input.read();
      if (result.done) {
        ended = true;
        break;
      }
      initial.push(result.value);
      byteCount += result.value.length;
    }
    if (canceled) return;
    const transform = hasZlibHeader(initial)
      ? createInflate({ chunkSize: 65536 })
      : createInflateRaw({ chunkSize: 65536 });
    inputHandedOff = true;
    reader = decodeThroughTransform(input, transform, initial, ended).getReader();
  };

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          initialization ??= initialize();
          await initialization;
          if (reader === undefined) {
            controller.close();
            return;
          }
          const result = await reader.read();
          if (result.done) {
            releaseDecoded();
            controller.close();
          } else controller.enqueue(result.value);
        } catch (error) {
          try {
            if (reader !== undefined) await reader.cancel(error);
            else await input.cancel(error);
          } catch {
            /* The input may already have been handed to the transform. */
          } finally {
            if (reader !== undefined) releaseDecoded();
            else if (!inputHandedOff) input.releaseLock();
          }
          controller.error(error);
        }
      },
      async cancel(reason) {
        canceled = true;
        if (reader !== undefined) {
          try {
            await reader.cancel(reason);
          } finally {
            releaseDecoded();
          }
        } else {
          try {
            await input.cancel(reason);
          } finally {
            if (!inputHandedOff) input.releaseLock();
          }
        }
      },
    },
    { highWaterMark: 0, size: (value) => value.length },
  );
}

function hasZlibHeader(chunks: readonly Uint8Array[]): boolean {
  let first: number | undefined;
  let second: number | undefined;
  for (const chunk of chunks) {
    for (const byte of chunk) {
      if (first === undefined) first = byte;
      else {
        second = byte;
        break;
      }
    }
    if (second !== undefined) break;
  }
  if (first === undefined || second === undefined) return false;
  return (first & 0x0f) === 8 && first >> 4 <= 7 && ((first << 8) | second) % 31 === 0;
}
