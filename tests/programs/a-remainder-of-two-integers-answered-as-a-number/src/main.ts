// A `%` over two integers whose result is a number, answered from the
// integers.
//
// `(a | 0) % (b | 0)` is `rem f64 (convert a) (convert b)` with `a` and `b`
// already `i32`: the result stays a double because it can be NaN or `-0`, and
// a reader can tell. `specialize::integral_remainder` names that shape, and the
// C, LLVM and JVM backends answer it with the integers' remainder and three
// tests rather than `fmod` or `drem`. `edge` walks one of those tests per
// input:
//
//   `-5 % 5`           -0   a zero remainder of a negative dividend
//   `5 % 0`            NaN  a zero divisor
//   `MIN % -1`         -0   the division that overflows: undefined in C and in
//                           LLVM's `srem`, and a trap on x86
//   `-7 % 3`, `7 % -3` -1, 1  the sign follows the dividend
//
// `1 / r` shows a `-0` as `-Infinity`, so the zero's sign is printed rather
// than assumed. `table` walks every divisor from -3 to 3 for each dividend,
// through the same function, each remainder weighted by its dividend so that
// two wrong answers cannot cancel.
//
// The control is `remOfNumbers`, the same operator over operands that are not
// truncated -- `7.5 % 2` is among the edges -- so it stays the floating-point
// remainder, and its answers are the ones the integer form must reproduce.

function remOfInts(a: number, b: number): number {
  return (a | 0) % (b | 0);
}

function remOfNumbers(a: number, b: number): number {
  return a % b;
}

function show(r: number): string {
  return `${Object.is(r, -0) ? "-0" : String(r)} (1/r ${1 / r})`;
}

const dividends = [-5, 5, -2147483648, -7, 7, 0, 0, 2147483647, -2147483648, -2147483648, -6, 7.5];
const divisors = [5, 0, -1, 3, -3, 5, -5, 2, 2147483647, 1, -3, 2];

export function ints(a: number, b: number): string {
  return show(remOfInts(a, b));
}

export function numbers(a: number, b: number): string {
  return show(remOfNumbers(a, b));
}

export function edge(n: number): string {
  const at = (n >>> 0) % dividends.length;
  const a = dividends[at];
  const b = divisors[at];
  return `${a} % ${b}: ints ${show(remOfInts(a, b))}, numbers ${show(remOfNumbers(a, b))}`;
}

export function table(n: number): string {
  const span = 40 + ((n >>> 0) & 7);
  let total = 0;
  let negativeZeros = 0;
  let nans = 0;
  for (let a = -span; a <= span; a++) {
    for (let b = -3; b <= 3; b++) {
      const r = remOfInts(a, b);
      if (r !== r) {
        nans++;
      } else if (Object.is(r, -0)) {
        negativeZeros++;
      } else {
        total += r * (a + 100);
      }
    }
  }
  return `table over ${span}: total ${total}, -0 ${negativeZeros}, NaN ${nans}`;
}
