// Typed assertions preserve the arriving value; their written literal claims
// neither test it nor license a constant, range or bounds proof.
const enum Fixed { Value = 64 }
let stored: 64 = 64;
export function numberClaim(value: number): number {
  const local: 64 = value as 64;
  return local;
}
export function unionClaim(value: number): number {
  const local: 0 | 1 | 2 | 3 = value as 0 | 1 | 2 | 3;
  return local;
}
export function enumClaim(value: number): number {
  const local: Fixed.Value = value as Fixed.Value;
  return local;
}
export function stringClaim(value: string): string {
  const local: "a" = value as "a";
  return local;
}
export function fieldClaim(value: number): number {
  const holder: { value: 64 } = { value: value as 64 };
  return holder.value;
}
export function globalClaim(value: number): number {
  stored = value as 64;
  return stored;
}
export function stringLengthClaim(value: string): number {
  const local: "a" = value as "a";
  return local.length;
}
