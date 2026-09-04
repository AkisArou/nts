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

export { finished };

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
      const options = streams.pop() as PipelineOptions;
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
