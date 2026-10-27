// A summary must reach the first caller even through more than 32 calls.
// The control changes only the owner's entry from f0 to f20 in the same chain.
let saved: { value: number } | undefined;
let count = 0;

function f40(x: { value: number }): void {
  count += 1;
  saved = x;
}

function f39(x: { value: number }): void {
  count += 1;
  f40(x);
}

function f38(x: { value: number }): void {
  count += 3;
  f39(x);
}

function f37(x: { value: number }): void {
  count += 2;
  f38(x);
}

function f36(x: { value: number }): void {
  count += 1;
  f37(x);
}

function f35(x: { value: number }): void {
  count += 3;
  f36(x);
}

function f34(x: { value: number }): void {
  count += 2;
  f35(x);
}

function f33(x: { value: number }): void {
  count += 1;
  f34(x);
}

function f32(x: { value: number }): void {
  count += 3;
  f33(x);
}

function f31(x: { value: number }): void {
  count += 2;
  f32(x);
}

function f30(x: { value: number }): void {
  count += 1;
  f31(x);
}

function f29(x: { value: number }): void {
  count += 3;
  f30(x);
}

function f28(x: { value: number }): void {
  count += 2;
  f29(x);
}

function f27(x: { value: number }): void {
  count += 1;
  f28(x);
}

function f26(x: { value: number }): void {
  count += 3;
  f27(x);
}

function f25(x: { value: number }): void {
  count += 2;
  f26(x);
}

function f24(x: { value: number }): void {
  count += 1;
  f25(x);
}

function f23(x: { value: number }): void {
  count += 3;
  f24(x);
}

function f22(x: { value: number }): void {
  count += 2;
  f23(x);
}

function f21(x: { value: number }): void {
  count += 1;
  f22(x);
}

function f20(x: { value: number }): void {
  count += 3;
  f21(x);
}

function f19(x: { value: number }): void {
  count += 2;
  f20(x);
}

function f18(x: { value: number }): void {
  count += 1;
  f19(x);
}

function f17(x: { value: number }): void {
  count += 3;
  f18(x);
}

function f16(x: { value: number }): void {
  count += 2;
  f17(x);
}

function f15(x: { value: number }): void {
  count += 1;
  f16(x);
}

function f14(x: { value: number }): void {
  count += 3;
  f15(x);
}

function f13(x: { value: number }): void {
  count += 2;
  f14(x);
}

function f12(x: { value: number }): void {
  count += 1;
  f13(x);
}

function f11(x: { value: number }): void {
  count += 3;
  f12(x);
}

function f10(x: { value: number }): void {
  count += 2;
  f11(x);
}

function f9(x: { value: number }): void {
  count += 1;
  f10(x);
}

function f8(x: { value: number }): void {
  count += 3;
  f9(x);
}

function f7(x: { value: number }): void {
  count += 2;
  f8(x);
}

function f6(x: { value: number }): void {
  count += 1;
  f7(x);
}

function f5(x: { value: number }): void {
  count += 3;
  f6(x);
}

function f4(x: { value: number }): void {
  count += 2;
  f5(x);
}

function f3(x: { value: number }): void {
  count += 1;
  f4(x);
}

function f2(x: { value: number }): void {
  count += 3;
  f3(x);
}

function f1(x: { value: number }): void {
  count += 2;
  f2(x);
}

function f0(x: { value: number }): void {
  count += 1;
  f1(x);
}

function owner(v: number): void {
  const o = { value: v };
  f0(o);
}

function controlOwner(v: number): void {
  const o = { value: v };
  f20(o);
}

function clobber(k: number): number {
  const a = { value: k * 3 };
  const b = { value: a.value + 7 };
  return a.value + b.value;
}

export function deep(n: number): number {
  owner(n);
  const c = clobber(n + 11);
  const result = saved!.value * 1000 + (c % 1000);
  saved = undefined;
  return result;
}

export function control(n: number): number {
  controlOwner(n);
  const c = clobber(n + 11);
  const result = saved!.value * 1000 + (c % 1000);
  saved = undefined;
  return result;
}
