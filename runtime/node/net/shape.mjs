// The object node's tests see as `require('net')`.
export function shape(exports) {
  const net = { ...exports };
  delete net.default;
  return net;
}
