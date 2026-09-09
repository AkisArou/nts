// The object node's tests see as `require('events')`.
//
// Node's module *is* the `EventEmitter` constructor, with the helpers hung off
// it — `require('events')` is callable and `require('events').once` is a
// function on it. This assembles that shape; the class and the helpers are the
// implementation's.
export function shape(exports) {
  const EventEmitter = exports.EventEmitter ?? exports.default;
  // // A compiled module may publish none of this yet, and reaching through an
  // absent export turns "one export is missing" into "the module did not load"
  // -- one message for every test in the module, naming nothing. Every test
  // still fails; they fail saying which export they wanted.
  if (EventEmitter === undefined) return {};
  EventEmitter.EventEmitter = EventEmitter;
  EventEmitter.usingDomains = false;
  // `getEventListeners` and the module-level `listenerCount` are node's
  // module-level helpers. `addAbortListener` and `setMaxListeners` are not
  // copied because their module exports are already the class's static values.
  for (const name of [
    "getEventListeners",
    "getMaxListeners",
    "listenerCount",
    "once",
    "on",
  ]) {
    if (exports[name]) EventEmitter[name] = exports[name];
  }
  // Class methods and accessors are non-enumerable by default. Node's module
  // is the same constructor populated through ordinary CommonJS assignments,
  // so these implemented members are enumerable on the public namespace.
  for (const [name, configurable] of [
    ["captureRejections", false],
    ["EventEmitterAsyncResource", true],
    ["defaultMaxListeners", false],
    ["setMaxListeners", true],
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(EventEmitter, name);
    if (descriptor !== undefined) {
      Object.defineProperty(EventEmitter, name, {
        ...descriptor,
        enumerable: true,
        configurable,
      });
    }
  }
  return EventEmitter;
}
