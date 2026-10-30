import type { Int32, Uint32, c_int, c_uint } from "@nts/scalars";

export function signed(value: Int32): number {
  const c: c_int = value;
  const fixed: Int32 = c;
  return fixed;
}

export function unsigned(value: Int32): number {
  return value;
}

export function unsignedAlias(): boolean {
  const value: Uint32 = 4294967295;
  const c: c_uint = value;
  const fixed: Uint32 = c;
  return fixed === 4294967295;
}
