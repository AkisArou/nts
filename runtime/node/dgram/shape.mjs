// The object node's tests see as `require('dgram')`.
//
// Node exports `Socket` and `createSocket`, plus `_createSocketHandle`, which
// is `cluster`'s and is deliberately absent: a throwing stand-in would be a
// worse answer than no property, because a test that checks for it would see
// something that looks implemented.
export function shape(exports) {
  return {
    Socket: exports.Socket,
    createSocket: exports.createSocket,
  };
}
