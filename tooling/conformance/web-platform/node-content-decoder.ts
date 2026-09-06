import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import type { Transform } from "node:stream";
import { ReadableStream } from "../../../runtime/web-platform/src/streams/readable.ts";
import type { ContentDecoder } from "../../../runtime/web-platform/src/fetch/transport.ts";
import { HostNodeReadable } from "./node-primitives.ts";

/** Native zlib is a codec primitive; HTTP policy and header handling remain shared. */
export class HostNodeContentDecoder implements ContentDecoder {
  supports(coding: string): boolean {
    return coding === "gzip" || coding === "deflate" || coding === "br";
  }

  decode(coding: string, source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    let transform: Transform;
    switch (coding) {
      case "gzip":
        transform = createGunzip({ chunkSize: 65536 });
        break;
      case "deflate":
        transform = createInflate({ chunkSize: 65536 });
        break;
      case "br":
        transform = createBrotliDecompress({ chunkSize: 65536 });
        break;
      default:
        throw new TypeError("Unsupported content coding");
    }
    const input = source.getReader();
    const output = new HostNodeReadable(transform);
    let canceled = false;

    const feed = async (): Promise<void> => {
      try {
        while (!canceled) {
          const result = await input.read();
          if (result.done) {
            transform.end();
            return;
          }
          await new Promise<void>((resolve, reject) =>
            transform.write(result.value, (error) => (error ? reject(error) : resolve())),
          );
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
}
