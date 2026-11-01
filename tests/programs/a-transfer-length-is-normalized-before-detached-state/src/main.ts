// Node26 deps/v8/src/builtins/builtins-arraybuffer.cc:649-729 converts the
// length before testing detached state. Each control differs only in -1 -> 0.
// Node24 uses the official recorded oracle. Node26 re-recording waits for
// tsrs's authoritative transform/launch path.
function classify(error: unknown): number {
  if (error instanceof RangeError) return 1;
  if (error instanceof TypeError) return 2;
  return 3;
}

export function invalidTransferLength(): number {
  const buffer = new ArrayBuffer(8);
  buffer.transfer();
  try { buffer.transfer(-1); return 0; } catch (error) { return classify(error); }
}

export function validTransferLength(): number {
  const buffer = new ArrayBuffer(8);
  buffer.transfer();
  try { buffer.transfer(0); return 0; } catch (error) { return classify(error); }
}

export function invalidFixedTransferLength(): number {
  const buffer = new ArrayBuffer(8);
  buffer.transfer();
  try { buffer.transferToFixedLength(-1); return 0; } catch (error) { return classify(error); }
}

export function validFixedTransferLength(): number {
  const buffer = new ArrayBuffer(8);
  buffer.transfer();
  try { buffer.transferToFixedLength(0); return 0; } catch (error) { return classify(error); }
}
