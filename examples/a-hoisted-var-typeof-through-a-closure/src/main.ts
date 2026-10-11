// A var is undefined at function entry; assignment makes typeof number.
export function before(n: number): string {
  function reader() { return typeof value; }
  const seen = reader();
  var value = n;
  return seen + ":" + reader();
}

export function after(n: number): string {
  function readerAfter() { return typeof value; }
  var value = n;
  return readerAfter();
}

export function assignmentBeforeDeclaration(n: number): string {
  function readerAssigned() { return typeof value; }
  value = n;
  const seen = readerAssigned();
  var value: number;
  return seen;
}
