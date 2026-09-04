// A transform that transforms nothing, from node v24.20.0
// `lib/internal/streams/passthrough.js`.
//
// Trivial and genuinely useful: it is the simplest thing that is both a
// `Readable` and a `Writable`, so it is what a test writes into and reads
// from, and what a program uses to join two pipelines that would otherwise
// have to be connected by hand.

import { Transform } from "./transform.ts";
import type { TransformCallback, TransformOptions } from "./transform.ts";

export class PassThrough extends Transform {
  constructor(options?: TransformOptions) {
    super(options);
  }

  override _transform(
    chunk: unknown,
    _encoding: string | undefined,
    callback: TransformCallback,
  ): void {
    callback(null, chunk);
  }
}
