// The object Node's tests see as `require('string_decoder')`.
//
// The typed class is the implementation. Node's legacy callable constructor
// and arbitrary-receiver prototype methods require function/prototype
// metaobjects and are deliberately not reconstructed at this boundary.
export function shape(exports) {
  return { StringDecoder: exports.StringDecoder };
}
