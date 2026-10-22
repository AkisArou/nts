// An accumulator carried round a loop past INT32_MAX: `(total + 7) | 0`
// wraps, so its sign after a thousand steps is negative. A backend that
// promised the add could not overflow (`nsw`) let the optimizer keep the
// sum positive; only arithmetic proved to fit its type may carry that promise
// (`hir::exact`). The control stays far below the limit and agrees either way.

export function wrappedTotal(seed: number): number {
  let total = 2147483000 + (seed & 7);
  for (let i = 0; i < 1000; i = i + 1) {
    total = (total + 7) | 0;
  }
  return total > 0 ? 1 : 0;
}

export function boundedTotal(seed: number): number {
  let total = seed & 7;
  for (let i = 0; i < 1000; i = i + 1) {
    total = (total + 7) | 0;
  }
  return total > 0 ? 1 : 0;
}
