// The object node's tests see as `require('stream')`.
//
// Node's module is the `Stream` constructor with everything else as
// properties on it, and `require('stream').Stream === require('stream')` is
// true. Programs rely on both halves of that.

import { promisify } from "node:util";
import * as webStreams from "node:stream/web";

const callableConstructors = new Map();

/**
 * Node's stream constructors predate `class` and remain callable without
 * `new`. The implementation is a real typed class; this facade supplies only
 * that CommonJS function-object shape.
 *
 * `Reflect.construct` is necessary on the Node side for `class Derived extends
 * Readable`: it lets the real class initialize its fields and private brands
 * while retaining `Derived.prototype`. No stream algorithm runs here.
 */
function callableConstructor(Class, name) {
  const existing = callableConstructors.get(Class);
  if (existing !== undefined) return existing;

  const callable = function (...args) {
    if (new.target === undefined) return new Class(...args);
    return Reflect.construct(Class, args, new.target === callable ? Class : new.target);
  };
  Object.setPrototypeOf(callable, Class);
  callable.prototype = Class.prototype;
  Object.defineProperty(callable, "name", { value: name });
  Class.prototype.constructor = callable;
  callableConstructors.set(Class, callable);
  return callable;
}

export function shape(exports) {
  const Stream = callableConstructor(exports.Stream ?? exports.default, "Stream");
  const Readable = callableConstructor(exports.Readable, "Readable");
  const Writable = callableConstructor(exports.Writable, "Writable");
  const Duplex = callableConstructor(exports.Duplex, "Duplex");
  const Transform = callableConstructor(exports.Transform, "Transform");
  const PassThrough = callableConstructor(exports.PassThrough, "PassThrough");
  const shapedConstructors = { Readable, Writable, Duplex, Transform, PassThrough };

  // `node:stream/iter` is a subpath, represented as a nested export only for
  // the conformance loader. Node freezes its public namespace object; that is
  // host-facing object shape and deliberately stays out of typed algorithms.
  if (exports.iter?.Stream !== undefined) Object.freeze(exports.iter.Stream);

  Stream.Stream = Stream;
  // EventEmitter exposes these as the same function objects. The typed source
  // keeps ordinary statically declared methods; function-object aliasing is a
  // Node object-shape concern and belongs here, with no forwarding call on the
  // hot listener-removal path.
  Stream.prototype.addListener = Stream.prototype.on;
  Stream.prototype.off = Stream.prototype.removeListener;
  // Readable overrides `on` and `removeListener` to update flowing state, so
  // its aliases must point at those overrides rather than the base methods.
  Readable.prototype.addListener = Readable.prototype.on;
  Readable.prototype.off = Readable.prototype.removeListener;
  for (const [name, value] of Object.entries(exports)) {
    if (
      name === "default" || name === "Stream" ||
      name === "kSynchronousCallback" || name === "addAbortSignalNoValidate" ||
      name === "duplexFromWeb" || name === "duplexToWeb"
    ) continue;
    Stream[name] = shapedConstructors[name] ?? value;
  }
  // These symbol-keyed links are CommonJS function-object metadata. They
  // belong in the Node shape bridge, not in the statically compiled stream
  // implementation.
  exports.pipeline[promisify.custom] = exports.promises.pipeline;
  exports.finished[promisify.custom] = exports.promises.finished;
  Duplex.fromWeb = exports.duplexFromWeb;
  Duplex.toWeb = exports.duplexToWeb;
  // The Web Stream classes are platform objects supplied by Node. The
  // TypeScript implementation owns the adapters; this bridge only makes the
  // platform module reachable under its `stream/web` spelling in the test.
  Stream.web = webStreams;
  return Stream;
}

/** Public subpath modules that share this stream implementation and state. */
export function subpaths(exports) {
  return {
    "stream/promises": exports.promises,
    "stream/consumers": exports.consumers,
    "stream/iter": exports.iter,
    "stream/web": webStreams,
  };
}

/** Node's test-only internal name for the synchronous finished option. */
export function internals(exports) {
  return {
    "_stream_readable": callableConstructor(exports.Readable, "Readable"),
    "_stream_writable": callableConstructor(exports.Writable, "Writable"),
    "_stream_duplex": callableConstructor(exports.Duplex, "Duplex"),
    "_stream_transform": callableConstructor(exports.Transform, "Transform"),
    "_stream_passthrough": callableConstructor(exports.PassThrough, "PassThrough"),
    "internal/streams/end-of-stream": {
      kEosNodeSynchronousCallback: exports.kSynchronousCallback,
    },
    "internal/streams/add-abort-signal": {
      addAbortSignalNoValidate: exports.addAbortSignalNoValidate,
    },
  };
}
