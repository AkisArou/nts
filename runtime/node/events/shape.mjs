// The object node's tests see as `require('events')`.
//
// Node's module *is* the `EventEmitter` constructor, with the helpers hung off
// it — `require('events')` is callable and `require('events').once` is a
// function on it. This assembles that shape; the class and the helpers are the
// implementation's.
export function shape(exports) {
  const EventEmitter = exports.EventEmitter ?? exports.default;
  EventEmitter.EventEmitter = EventEmitter;
  EventEmitter.usingDomains = false;
  // `getEventListeners` and the module-level `listenerCount` are node's
  // module-level helpers. `setMaxListeners` is *not* copied: the class already
  // has a static of that name, and the module-level wrapper calls it — copying
  // the wrapper over the static makes it call itself.
  for (const name of ["addAbortListener", "getEventListeners", "getMaxListeners", "listenerCount", "once", "on"]) {
    if (exports[name]) EventEmitter[name] = exports[name];
  }
  return EventEmitter;
}
