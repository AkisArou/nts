// The object Node's tests see as `require('diagnostics_channel')`.
//
// `TracingChannel` is an implementation class, not a module export. Its five
// channel slots are fixed, non-enumerable values in Node; the TypeScript marks
// them readonly, and this host boundary restores the descriptor half that NTS
// intentionally does not model.
const TRACE_EVENTS = ["start", "end", "asyncStart", "asyncEnd", "error"];

export function shape(exports) {
  function tracingChannel(nameOrChannels) {
    const tracing = exports.tracingChannel(nameOrChannels);
    for (const name of TRACE_EVENTS) {
      Object.defineProperty(tracing, name, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: tracing[name],
      });
    }
    return tracing;
  }

  return {
    channel: exports.channel,
    hasSubscribers: exports.hasSubscribers,
    subscribe: exports.subscribe,
    tracingChannel,
    unsubscribe: exports.unsubscribe,
    Channel: exports.Channel,
  };
}
