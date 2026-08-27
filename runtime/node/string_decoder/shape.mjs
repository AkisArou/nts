// The object node's tests see as `require('string_decoder')`.
export function shape(exports) {
  return { StringDecoder: exports.StringDecoder };
}
