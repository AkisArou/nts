// `node:stream/promises`, from node v24.20.0 `lib/stream/promises.js`.
//
// Two functions, and both are the callback forms with the callback removed.
// `pipeline` in particular is much easier to get right this way: the callback
// version has to be given a function as its last argument and silently does
// the wrong thing if you forget, while `await pipeline(a, b, c)` cannot be
// written incorrectly in that way.

import { isIterable, isNodeStream, isWebStream } from "./utils.ts";
import { pipelineImpl } from "./pipeline.ts";
import type { PipelineOptions } from "./pipeline.ts";
import { finished } from "./end-of-stream.ts";
import type { AbortSignalLike } from "./end-of-stream.ts";
import { ERR_INVALID_ARG_TYPE } from "../../internal/errors.ts";
import { validateBoolean } from "../../internal/validators.ts";

export { finished };

function isAbortSignalLike(value: unknown): value is AbortSignalLike {
  return value !== null && typeof value === "object" &&
    "aborted" in value && typeof value.aborted === "boolean" &&
    "reason" in value &&
    "addEventListener" in value && typeof value.addEventListener === "function" &&
    "removeEventListener" in value && typeof value.removeEventListener === "function";
}

function readOptions(value: object): PipelineOptions {
  let signal: AbortSignalLike | undefined;
  if ("signal" in value && value.signal !== undefined) {
    if (!isAbortSignalLike(value.signal)) {
      throw new ERR_INVALID_ARG_TYPE("options.signal", "AbortSignal", value.signal);
    }
    signal = value.signal;
  }

  let end: boolean | undefined;
  if ("end" in value && value.end !== undefined) {
    validateBoolean(value.end, "options.end");
    end = value.end;
  }
  return { signal, end };
}

export function pipeline(...streams: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let signal: PipelineOptions["signal"];
    let end: boolean | undefined;

    // The options object is identified by *not* being any of the things a
    // stage can be. There is no other way: `pipeline` is variadic, so the
    // last argument's position tells you nothing, and an options object and a
    // plain iterable are both objects.
    const last = streams[streams.length - 1];
    if (
      last &&
      typeof last === "object" &&
      !isNodeStream(last) &&
      !isIterable(last) &&
      !isWebStream(last)
    ) {
      streams.pop();
      const options = readOptions(last);
      signal = options.signal;
      end = options.end;
    }

    pipelineImpl(
      streams,
      (error, value) => {
        if (error) reject(error);
        else resolve(value);
      },
      { signal, end },
    );
  });
}
