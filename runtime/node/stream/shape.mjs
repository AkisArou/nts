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
  // A compiled module may not publish this yet. Reaching through an absent
  // export turns "one export is missing" into "the module did not load" -- one
  // message for every test in the module, naming nothing.
  if (Class === undefined) return undefined;
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

  // A compiled module may not publish `Stream` yet, and when it does not, the
  // rest of what it publishes is still real.
  //
  // This used to `return {}`. `os/shape.mjs` records the same mistake from the
  // other side -- "a shape that throws on a missing export reports one fact
  // about the addon and hides seven" -- and this was the silent version of it:
  // the compiled `stream` publishes `getDefaultHighWaterMark`, it answers
  // 65536 / 16 / 65536 for `false` / `true` / `undefined` exactly as node does,
  // and **the shape threw it away** because `Stream` was missing. Measured
  // against the raw `.node` with `process.dlopen`, which is how it was found;
  // through the shim the name was simply not there.
  //
  // The wiring below genuinely needs `Stream` -- prototype aliasing, the
  // `promisify.custom` links, `Duplex.fromWeb`. So the early exit stays, and
  // hands back the names that do not depend on it instead of nothing.
  if (Stream === undefined) {
    const partial = {};
    for (const [name, value] of Object.entries(exports)) {
      if (name === "default" || name === "Stream") continue;
      partial[name] = shapedConstructors[name] ?? value;
    }
    return partial;
  }
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
      name === "default" ||
      name === "Stream" ||
      name === "kSynchronousCallback" ||
      name === "addAbortSignalNoValidate" ||
      name === "duplexFromWeb" ||
      name === "duplexToWeb" ||
      // Node keeps these two off the module object and on the constructors:
      // `"WritableState" in require("node:stream")` is false there, while
      // `Object.keys(stream.Writable)` is `["WritableState", "fromWeb", "toWeb"]`.
      name === "ReadableState" ||
      name === "WritableState"
    )
      continue;
    Stream[name] = shapedConstructors[name] ?? value;
  }

  // The state classes, as statics, where node puts them.
  if (Writable !== undefined && exports.WritableState !== undefined) {
    Writable.WritableState = exports.WritableState;
  }
  if (Readable !== undefined && exports.ReadableState !== undefined) {
    Readable.ReadableState = exports.ReadableState;
  }

  // `duplex instanceof Writable` is **true** on node and was false here.
  //
  // Node's `Duplex extends Readable`, not `Writable`, so an ordinary prototype
  // walk says no -- and node adds a `Symbol.hasInstance` to `Writable` that says
  // yes for anything carrying a real `WritableState`:
  //
  //     if (FunctionPrototypeSymbolHasInstance(this, instance)) return true;
  //     if (this !== Writable) return false;
  //     return instance && instance._writableState instanceof WritableState;
  //
  // Measured before it was copied: a plain object with `_writableState: {}` is
  // **not** an instance there, and neither is one with `write`, `end` and `on`,
  // so this is not duck-typing -- the state has to be a real `WritableState`.
  //
  // The prototype walk is written out rather than delegated, because the shaped
  // `Writable` is a callable facade over the real class and the question is about
  // `Writable.prototype`, which the facade shares.
  if (Writable !== undefined && exports.WritableState !== undefined) {
    const WritableStateClass = exports.WritableState;
    Object.defineProperty(Writable, Symbol.hasInstance, {
      value: function (instance) {
        const target = this === undefined ? Writable : this;
        const proto = target.prototype;
        if (instance !== null && (typeof instance === "object" || typeof instance === "function")) {
          for (let p = Object.getPrototypeOf(instance); p !== null; p = Object.getPrototypeOf(p)) {
            if (p === proto) return true;
          }
        }
        if (target !== Writable) return false;
        return Boolean(instance) && instance._writableState instanceof WritableStateClass;
      },
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }
  // These symbol-keyed links are CommonJS function-object metadata. They
  // belong in the Node shape bridge, not in the statically compiled stream
  // implementation.
  exports.pipeline[promisify.custom] = exports.promises.pipeline;
  exports.finished[promisify.custom] = exports.promises.finished;
  // `promises.ts` is reached with `import * as promises`, so what the loop above
  // copied is an **ESM module namespace object**: frozen, null-prototyped and
  // carrying `Symbol.toStringTag` of `"Module"`. Node's `stream.promises` is an
  // ordinary object over `Object.prototype` with no tag.
  //
  // `{ ... }` rather than the null-prototype form used for `fs.constants`,
  // because node's two differ: `fs.constants` really is null-prototyped and this
  // one is not. Measured, not assumed.
  //
  // Third of these found, after `util.types` and `fs.constants`. Representation
  // shaping only: the values are the same function objects.
  if (exports.promises !== undefined) Stream.promises = { ...exports.promises };
  Duplex.fromWeb = exports.duplexFromWeb;
  Duplex.toWeb = exports.duplexToWeb;
  // The Web Stream classes are platform objects supplied by Node. The
  // TypeScript implementation owns the adapters; this bridge only makes the
  // platform module reachable under its `stream/web` spelling in the test.
  Stream.web = webStreams;
  return Stream;
}

/** Public subpath modules that share this stream implementation and state. */
export function subpaths(exports, shaped) {
  return {
    // `shaped.promises`, so that `require('stream/promises')` is the same object
    // as `require('stream').promises`. The shape rebuilds it, and returning the
    // raw namespace here would hand the subpath a different object.
    "stream/promises": shaped?.promises ?? exports.promises,
    "stream/consumers": exports.consumers,
    "stream/iter": exports.iter,
    "stream/web": webStreams,
  };
}

/** Node's test-only internal name for the synchronous finished option. */
export function internals(exports) {
  return {
    _stream_readable: callableConstructor(exports.Readable, "Readable"),
    _stream_writable: callableConstructor(exports.Writable, "Writable"),
    _stream_duplex: callableConstructor(exports.Duplex, "Duplex"),
    _stream_transform: callableConstructor(exports.Transform, "Transform"),
    _stream_passthrough: callableConstructor(exports.PassThrough, "PassThrough"),
    "internal/streams/end-of-stream": {
      kEosNodeSynchronousCallback: exports.kSynchronousCallback,
    },
    "internal/streams/add-abort-signal": {
      addAbortSignalNoValidate: exports.addAbortSignalNoValidate,
    },
    "internal/streams/state": {
      getDefaultHighWaterMark: exports.getDefaultHighWaterMark,
      setDefaultHighWaterMark: exports.setDefaultHighWaterMark,
    },
  };
}
