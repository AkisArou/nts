// `node:stream`, from node v24.20.0 `lib/stream.js`.
//
// The module *is* the legacy `Stream` constructor, with everything else hung
// off it as properties. That is why `require('stream')` is callable and why
// `require('stream').Readable` works: the shape is from 2010 and every program
// written since depends on it.

import { Stream } from "./legacy.ts";
import { Readable } from "./readable.ts";
import { Writable } from "./writable.ts";
import { Duplex } from "./duplex.ts";
import { Transform } from "./transform.ts";
import { PassThrough } from "./passthrough.ts";
// `stream.finished` is the *callback* form. The promise-returning one of the
// same name lives in `stream/promises`, and exporting that here instead --
// which this did -- makes `finished(stream, cb)` silently ignore the callback
// and hand back a promise nobody awaits.
import { eos as finished } from "./end-of-stream.ts";
import { addAbortSignal } from "./add-abort-signal.ts";
import { destroyer } from "./destroy.ts";
import { from } from "./from.ts";
import { ERR_ILLEGAL_CONSTRUCTOR } from "../../internal/errors.ts";
import { promiseReturningOperators, streamReturningOperators } from "./operators.ts";
import { pipeline, pipelineImpl } from "./pipeline.ts";
import * as promises from "./promises.ts";
// Imported for its side effect: it fills the hole `Duplex.from` calls
// through, which it cannot do by being imported *by* `duplex.ts` without a
// cycle.
import "./duplexify.ts";
import { compose } from "./compose.ts";
import { duplexPair } from "./duplexpair.ts";
import { setCompose } from "./readable.ts";

// `Readable.prototype.compose` calls through this, which `readable.ts` cannot
// import directly: `compose` builds a `Duplex`, which extends `Readable`.
setCompose(compose);
import { getDefaultHighWaterMark, setDefaultHighWaterMark } from "./state.ts";
import {
  isDestroyed,
  isDisturbed,
  isErrored,
  isReadable,
  isWritable,
} from "./utils.ts";

// `Readable.from` lives on the class, but building it needs `Readable`, so it
// is attached here rather than inside the class body.
(Readable as unknown as { from: typeof from }).from = from;

/**
 * The iterator helpers, installed on `Readable.prototype`.
 *
 * Here rather than in the class body because the two families are wrapped
 * differently and the wrapping needs `Readable.from`, which needs `Readable`.
 * A stream-returning operator produces an async generator, which is turned
 * back into a stream so that `.map(...).filter(...)` composes; a
 * promise-returning one is passed straight through.
 *
 * Each refuses `new`. They are methods, and `new stream.map(...)` is a mistake
 * with a confusing failure otherwise -- the generator would be constructed and
 * silently discarded.
 */
for (const [name, op] of Object.entries(streamReturningOperators)) {
  function wrapped(this: Readable, ...args: unknown[]): unknown {
    if (new.target) throw new ERR_ILLEGAL_CONSTRUCTOR();
    return (Readable as unknown as { from: typeof from }).from(
      Reflect.apply(op, this, args) as never,
    );
  }
  Object.defineProperty(wrapped, "name", { value: op.name });
  Object.defineProperty(wrapped, "length", { value: op.length });
  Object.defineProperty(Readable.prototype, name, {
    value: wrapped,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

for (const [name, op] of Object.entries(promiseReturningOperators)) {
  function wrapped(this: Readable, ...args: unknown[]): unknown {
    if (new.target) throw new ERR_ILLEGAL_CONSTRUCTOR();
    return Reflect.apply(op, this, args);
  }
  Object.defineProperty(wrapped, "name", { value: op.name });
  Object.defineProperty(wrapped, "length", { value: op.length });
  Object.defineProperty(Readable.prototype, name, {
    value: wrapped,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

export {
  Stream,
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
  finished,
  pipeline,
  pipelineImpl,
  promises,
  compose,
  duplexPair,
  addAbortSignal,
  destroyer,
  getDefaultHighWaterMark,
  setDefaultHighWaterMark,
  isDestroyed,
  isDisturbed,
  isErrored,
  isReadable,
  isWritable,
};

export default Stream;
