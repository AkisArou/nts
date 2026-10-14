// expect: NTS1001 an `instanceof` against something this compiler has no class for
//
// `Buffer.from` in node tests `isAnyArrayBuffer(value)`: an `ArrayBuffer` or a
// `SharedArrayBuffer` is shared, not copied. runtime/node/buffer tests only
// `instanceof ArrayBuffer`, so `Buffer.from(sab)` throws ERR_INVALID_ARG_TYPE
// where node shares the memory; upstream test-crypto-random.js fails on it.
// Adding `|| value instanceof SharedArrayBuffer` refuses here, and the
// refusal cascades: `Buffer.from`, `Buffer.of`, `Buffer#fill`, `search` and
// `transcode` stop compiling. That patch is parked, not landed
// (~/.cache/nts-nodeport/buffer-sab.patch).
//
// No `SharedArrayBuffer` is constructed: `new SharedArrayBuffer` refuses on
// its own ("would carry `ArrayBuffer`'s descriptor"), and the test only has
// to answer false for everything this program can make.
//
// Control, one difference: delete `|| value instanceof SharedArrayBuffer`
// and this compiles clean and runs without throwing, as it does on node.
// Found by the node-port lane (crypto).
function isAnyArrayBuffer(value: object): boolean {
  return value instanceof ArrayBuffer || value instanceof SharedArrayBuffer;
}
const buffer = isAnyArrayBuffer(new ArrayBuffer(1));
const plain = isAnyArrayBuffer({});
if (!buffer || plain) throw new Error("isAnyArrayBuffer answered wrongly");
