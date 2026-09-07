import type { AbortSignal } from "../core/abort.ts";
import type { HeldRequestBody, RequestBodyStore } from "../fetch/transport.ts";
import type { ReadableStream } from "../streams/readable.ts";
import type { DurableSpillArea } from "../storage/spill.ts";

/**
 * Holds streaming request bodies in a spill area so they can be replayed.
 *
 * This lives in `dispatch` rather than in `storage` on purpose. A policy may know about
 * storage; storage must not know about dispatch, or the byte store ends up carrying the
 * vocabulary of every consumer that ever wanted bytes.
 *
 * The spill area's own threshold still applies, so a small body is held in memory and a
 * large one goes to the store — the caller chooses somewhere to put the body, not how
 * big a body has to be before it costs anything.
 */
export function spilledRequestBodyStore(area: DurableSpillArea): RequestBodyStore {
  return {
    async hold(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<HeldRequestBody> {
      const spilled = await area.spill(body, signal);
      const blob = spilled.blob;
      return {
        source: {
          length: blob.size,
          open(): ReadableStream<Uint8Array> {
            return blob.stream();
          },
        },
        release(): Promise<void> {
          return spilled.release();
        },
      };
    },
  };
}
