// This guards the new computed-record membership path. An absent receiver
// is not an empty table: node throws, while this slice stops by name until
// that TypeError is lowered. The control changes only the receiver.
function contains(values: Record<string, unknown> | null, key: any): string {
  try { return String(key in values!); }
  catch (error) { return (error as Error).name + ": " + (error as Error).message; }
}
const values: Record<string, unknown> = { x: 7 };
observe("present record control", contains(values, "x"));
observe("absent record", contains(null, "x"));
done();
