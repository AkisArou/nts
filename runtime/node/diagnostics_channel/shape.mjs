// The object Node's tests see as `require('diagnostics_channel')`.
//
// `TracingChannel` is an implementation class, not a module export. Its five
// channel slots remain ordinary fixed fields in the typed implementation;
// Node's private property descriptors are outside the compiled object model.

export function shape(exports) {
  return {
    channel: exports.channel,
    hasSubscribers: exports.hasSubscribers,
    subscribe: exports.subscribe,
    tracingChannel: exports.tracingChannel,
    unsubscribe: exports.unsubscribe,
    Channel: exports.Channel,
  };
}
