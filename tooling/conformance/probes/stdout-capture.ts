// Does the compiled `nts_write_stdout` observe a reassigned `process.stdout.write`?
//
// Node's console tests capture output by replacing `process.stdout.write`, and
// seven of `console`'s pinned files do it. Our `console` calls
// `nts_write_stdout`, whose interpreted stand-in is
// `(text) => { process.stdout.write(text); return 0; }` -- a live closure, so
// the reassignment is observed. The C writes to descriptor 1.
//
// If the compiled binding cannot be captured, those seven files can never pass
// as a compiled addon whatever else is fixed, and `console`'s ceiling is not 19.
// This turns that from a prediction into a measurement, without waiting for
// `console` to publish anything.
declare function nts_write_stdout(text: string): number;

export function writeThroughTheBinding(text: string): number {
  return nts_write_stdout(text);
}
