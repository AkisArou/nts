// A primitive, which C prints with `%g`.
console.log("before");
function fail(n: number): void {
  if (n > 0) throw 1000000 * n;
}
fail(1);
