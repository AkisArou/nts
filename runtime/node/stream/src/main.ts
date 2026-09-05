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
import { eos as finished, kSynchronousCallback } from "./end-of-stream.ts";
import { addAbortSignal, addAbortSignalNoValidate } from "./add-abort-signal.ts";
import { destroyer as destroy } from "./destroy.ts";
import { pipeline, pipelineImpl } from "./pipeline.ts";
import * as promises from "./promises.ts";
import * as consumers from "./consumers.ts";
import * as iter from "./iter/main.ts";
// This side effect installs `Duplex.from` after the stream class graph has
// initialized. See the TDZ boundary documented in `duplex.ts`.
import "./duplexify.ts";
import { compose } from "./compose.ts";
import { duplexPair } from "./duplexpair.ts";
import { setCompose } from "./readable.ts";
import { newDuplexFromWeb, newDuplexToWeb } from "./web-adapters.ts";
import type {
  DuplexFromWebOptions,
  DuplexToWebOptions,
  WebDuplexPair,
} from "./web-adapters.ts";

// Install only after the stream class graph has initialized; see the TDZ
// boundary documented beside `setCompose` in `readable.ts`.
setCompose(compose);

export function duplexFromWeb(
  pair: unknown,
  options?: DuplexFromWebOptions,
): Duplex {
  return newDuplexFromWeb(Duplex, pair, options);
}

export function duplexToWeb(
  duplex: unknown,
  options?: DuplexToWebOptions,
): WebDuplexPair {
  return newDuplexToWeb(duplex, options);
}
import { getDefaultHighWaterMark, setDefaultHighWaterMark } from "./state.ts";
import {
  isDestroyed,
  isDisturbed,
  isErrored,
  isReadable,
  isWritable,
} from "./utils.ts";

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
  consumers,
  iter,
  compose,
  duplexPair,
  addAbortSignal,
  destroy,
  getDefaultHighWaterMark,
  setDefaultHighWaterMark,
  isDestroyed,
  isDisturbed,
  isErrored,
  isReadable,
  isWritable,
  kSynchronousCallback,
  addAbortSignalNoValidate,
};

export default Stream;
