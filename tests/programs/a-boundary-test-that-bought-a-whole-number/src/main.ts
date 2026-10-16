// The control for `a-boundary-test-that-bought-nothing`: the same function
// stepping by one rather than a half. Its copy behind the boundary test gets
// an integer parameter, so the test is kept, and this compiled even while a
// retracted test left its blocks unreachable.

export function halves(c: number): number {
  if (!(c > -8 && c < 7)) {
    return c;
  }
  return halves(c + 1);
}
