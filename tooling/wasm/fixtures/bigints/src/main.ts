// bigint as 128 bits: arithmetic and its signs, the edges at -2^127 and
// 2^127 - 1, shifts by negative and huge counts, conversion to and from a
// number, asIntN/asUintN, and an erased bigint. Where node's answer passes
// 128 bits, Wasm refuses by name ("a bigint past 128 bits, which this runtime
// does not hold"): those cases are declined, never a different number.

function big(v: number): bigint {
  return BigInt(v | 0);
}

const TOP = (1n << 126n) - 1n + (1n << 126n); // 2^127 - 1
const BOTTOM = -TOP - 1n; // -2^127

export function arithmetic(v: number): string {
  const a = big(v) * 1000000007n + 12345678901234567890n;
  const b = big(v) - 98765432109876543210n;
  return `${a + b}|${a - b}|${a * 3n}|${a / 7n}|${a % 7n}|${-a / 13n}|${-a % 13n}|${b / -9n}|${b % -9n}`;
}

export function wideDivision(v: number): string {
  const a = (1n << 100n) + big(v) * 99991n;
  const b = (1n << 70n) + 12345n;
  return `${a / b}|${a % b}|${-a / b}|${-a % b}|${a / -b}|${a % -b}`;
}

export function nearTheWidth(v: number): string {
  const k = big(v) & 7n;
  return `${TOP - k}|${BOTTOM + k}|${TOP / (k + 1n)}|${BOTTOM / (k + 2n)}|${(BOTTOM + k) % 1000n}|${BOTTOM % 3n}`;
}

// 2^120 * 128 is 2^127: past for a positive product, exactly the bottom for
// a negative one.
export function multipliedToTheEdge(v: number): string {
  const k = big(v) & 255n;
  return `${-(1n << 120n) * 128n}|${(1n << 120n) * k}`;
}

export function addedPast(v: number): string {
  return `${TOP + big(v) - big(v)}|${TOP + (big(v) & 1n)}`;
}

export function shifts(v: number): string {
  const k = big(v) & 127n;
  return `${1n << k}|${8n >> -2n}|${5n << -1n}|${-1n >> 300n}|${7n >> 300n}|${-8n >> 1n}|${(1n << 126n) >> k}`;
}

export function toNumber(v: number): number {
  const k = big(v) & 3n;
  const tie = (1n << 100n) + (1n << 47n); // halfway: ties to even, down
  const above = tie + 1n; // just above halfway: up
  return Number(tie + k * 0n) + Number(above) * 2 + Number(BOTTOM) + Number(TOP) + Number(-(1n << 64n) - 1n - k);
}

export function fromNumber(v: number): string {
  return `${BigInt(v)}`;
}

export function asN(v: number): string {
  const x = big(v) * 37n + (1n << 70n);
  return `${BigInt.asIntN(8, x)}|${BigInt.asUintN(8, x)}|${BigInt.asIntN(64, -x)}|${BigInt.asUintN(64, -1n)}|${BigInt.asIntN(127, 1n << 126n)}|${BigInt.asIntN(200, -x)}`;
}

export function asUintPast(v: number): string {
  return `${BigInt.asUintN(128 + (v | 0) * 0, -1n - big(v) * 0n)}`;
}

function open(value: unknown): unknown {
  return value;
}

export function erased(v: number): string {
  const value = open(big(v) << 70n);
  const zero = open(big(v) * 0n);
  return `${value === open(big(v) << 70n)}|${typeof value}|${String(value)}|${zero ? 1 : 0}|${value ? 1 : 0}|${value === open(1)}`;
}

// The one-word paths at the site: operands either side of 2^31 for a
// product, a product that overflows a word, and the quotients a word holds
// only in part (-2^63 / -1), with negative divisors.
export function wordEdges(v: number): string {
  const k = BigInt(v | 0);
  const edge = 2147483647n + (k & 1n);
  const low = -2147483648n - (k & 1n);
  const wide = (1n << 40n) + k;
  const min = -9223372036854775808n;
  const d = k === 0n ? 3n : k;
  return `${edge * edge}|${low * low}|${edge * low}|${low * -1n}|${wide * wide}|${wide * -wide}|${(min + (k & 1n)) / -1n}|${min % -1n}|${min / d}|${min % d}|${(-7n - k) / 2n}|${(-7n - k) % 2n}|${(7n + k) % -3n}|${(k * 1000003n) % 65537n}`;
}
