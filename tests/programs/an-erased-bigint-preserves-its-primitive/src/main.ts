function held(value: unknown): unknown {
  const box: { value: unknown } = { value };
  return box.value;
}

function input(n: number): bigint {
  return n > 0 ? 9007199254740993n : -9223372036854775809n;
}

export function recovered(n: number): number {
  const value = held(input(n));
  return typeof value === "bigint" ? String(value).length : -1;
}

export function checked(n: number): number {
  const value = held(input(n)) as bigint;
  return String(value + 1n).length;
}

export function truthiness(n: number): number {
  const value: unknown = held(n > 0 ? 0n : 9007199254740993n);
  return value ? 1 : 0;
}

export function equality(n: number): number {
  return held(input(n)) === held(input(n)) ? 1 : 0;
}

export function differentHighWord(n: number): number {
  const a = held(n > 0 ? 18446744073709551623n : 7n);
  return a === held(7n) ? 1 : 0;
}

export function numberDiffers(n: number): number {
  return held(n > 0 ? 7n : 0n) === held(n > 0 ? 7 : 0) ? 1 : 0;
}

export function explicitNumber(n: number): number {
  return Number(n > 0 ? 9007199254740993n : -9223372036854775809n);
}

function mixedNumber(value: number | bigint): number {
  return Number(value);
}

export function explicitUnionNumber(n: number): number {
  return mixedNumber(n > 0 ? 9007199254740993n : 0.125);
}

export function dynamicArrayRead(n: number): number {
  const values: unknown = n > 0 ? [9007199254740993n] : [-9223372036854775809n];
  if (!Array.isArray(values)) return -1;
  const value: unknown = values[0];
  return typeof value === "bigint" ? String(value).length : -2;
}

export function mapKeys(n: number): number {
  const map = new Map<unknown, number>();
  map.set(held(input(n)), 2);
  map.set(held(input(n)), 3);
  map.set(held(Number(input(n))), 4);
  return map.size * 10 + (map.get(held(input(n))) ?? -1);
}

export function caughtPrimitive(n: number): string {
  const value: unknown = held(input(n));
  try {
    throw value;
  } catch (caught) {
    return typeof caught === "bigint" ? `bigint:${String(caught)}` : "other";
  }
}

function identity<T>(value: T): T { return value; }
const bigintIdentity: (value: bigint) => bigint = identity;
const literalIdentity: (value: 9007199254740993n) => 9007199254740993n = identity;

export function genericValue(n: number): number {
  return String(bigintIdentity(input(n))).length;
}

export function literalValue(n: number): number {
  return String(literalIdentity(9007199254740993n)).length + (n > 0 ? 1 : 0);
}

function apply(fn: (value: bigint) => bigint, value: bigint): bigint {
  return fn(value);
}

function applyLiteral(fn: (value: 9007199254740993n) => 9007199254740993n): bigint {
  return fn(9007199254740993n);
}

export function genericArgument(n: number): number {
  return String(apply(identity, input(n))).length;
}

export function literalArgument(n: number): number {
  return String(applyLiteral(identity)).length + (n > 0 ? 1 : 0);
}

async function settled(value: bigint): Promise<bigint> { return value; }

export async function typedPromise(n: number): Promise<number> {
  const value = await settled(input(n));
  return String(value + 1n).length;
}

export async function erasedPromise(n: number): Promise<number> {
  const value: unknown = await Promise.resolve<unknown>(input(n));
  return typeof value === "bigint" ? String(value).length : -1;
}

export async function typedReaction(n: number): Promise<number> {
  return await settled(input(n)).then(value => String(value + 1n).length);
}
