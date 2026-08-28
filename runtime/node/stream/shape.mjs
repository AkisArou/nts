// The object node's tests see as `require('stream')`.
//
// Node's module is the `Stream` constructor with everything else as
// properties on it, and `require('stream').Stream === require('stream')` is
// true. Programs rely on both halves of that.

export function shape(exports) {
  const Stream = exports.Stream ?? exports.default;
  Stream.Stream = Stream;
  for (const [name, value] of Object.entries(exports)) {
    if (name === "default" || name === "Stream") continue;
    Stream[name] = value;
  }
  return Stream;
}
