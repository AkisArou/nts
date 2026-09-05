// Attaching an `AbortSignal` to a stream, from node v24.20.0
// `lib/internal/streams/add-abort-signal.js`.
//
// Aborting a stream means destroying it with an `AbortError`, and the only
// subtlety is the listener's lifetime: a signal that outlives the stream --
// one controller cancelling a hundred requests, say -- would otherwise
// accumulate one listener per stream and never drop them. So the listener is
// removed when the stream ends, which is what `eos` is for here.

import { AbortError, ERR_INVALID_ARG_TYPE } from "../../internal/errors.ts";
import { addTrackedAbortListener } from "../../events/src/main.ts";
import { isNodeStream, isWebStream, kControllerErrorFunction } from "./utils.ts";
import { eos } from "./end-of-stream.ts";
import type { AbortSignalLike } from "./end-of-stream.ts";

/**
 * Duck-typed rather than `instanceof`, and inlined rather than imported.
 *
 * Node keeps its own copy here with a note that it must not allow the signal
 * to be absent, unlike the shared validator. A stream given
 * `{ signal: undefined }` by mistake would otherwise be silently
 * uncancellable.
 */
function requireAbortSignal(signal: unknown, name: string): void {
  if (typeof signal !== "object" || signal === null || !("aborted" in signal)) {
    throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
  }
}

interface DestroyableNodeStream {
  destroy(error?: unknown): unknown;
}

interface WebErrorTarget {
  [kControllerErrorFunction](error: unknown): void;
}

function isDestroyableNodeStream(value: unknown): value is DestroyableNodeStream {
  return isNodeStream(value) &&
    "destroy" in value && typeof value.destroy === "function";
}

function isWebErrorTarget(value: unknown): value is WebErrorTarget {
  return isWebStream(value) &&
    kControllerErrorFunction in value &&
    typeof value[kControllerErrorFunction] === "function";
}

export function addAbortSignal<T>(signal: AbortSignalLike, stream: T): T {
  requireAbortSignal(signal, "signal");
  if (!isDestroyableNodeStream(stream) && !isWebErrorTarget(stream)) {
    throw new ERR_INVALID_ARG_TYPE(
      "stream",
      ["ReadableStream", "WritableStream", "Stream"],
      stream,
    );
  }
  return addAbortSignalNoValidate(signal, stream);
}

/**
 * The same, for callers that have already checked.
 *
 * Separate because the constructors call it on every stream that was given a
 * signal, and the validation is the expensive half.
 */
export function addAbortSignalNoValidate<T>(signal: AbortSignalLike, stream: T): T {
  if (typeof signal !== "object" || signal === null || !("aborted" in signal)) {
    return stream;
  }

  const onAbort = isDestroyableNodeStream(stream)
    ? (): void => {
      stream.destroy(new AbortError(undefined, { cause: signal.reason }));
    }
    : (): void => {
      // A web stream has no `destroy`; erroring its controller is the
      // equivalent, and the function to do it is left on the stream by
      // whoever built it.
      if (isWebErrorTarget(stream)) {
        stream[kControllerErrorFunction](
          new AbortError(undefined, { cause: signal.reason }),
        );
      }
    };

  if (signal.aborted) {
    onAbort();
  } else {
    const removeAbortListener = addTrackedAbortListener(signal, onAbort);
    // Dropped when the stream is finished, so a long-lived signal does not
    // accumulate a listener per stream it ever cancelled.
    eos(stream, removeAbortListener);
  }

  return stream;
}
