// Native assertions from erased values check membership. Node erases these
// casts; the backend callers below assert the native policy directly.
enum Choice { First = 3, Second = 7 }
const enum Code { Ok = 64, Other = 65 }

export function numberClaim(value: unknown): number {
  try { const checked = value as 64; return checked; }
  catch (error) { return error instanceof TypeError ? -1 : -2; }
}
export function stringClaim(value: unknown): number {
  try { const checked = value as "a"; return checked.length; }
  catch (error) { return error instanceof TypeError ? -1 : -2; }
}
export function stringUnionClaim(value: unknown): number {
  try { const checked = value as "a" | "b"; return checked.length; }
  catch (error) { return error instanceof TypeError ? -1 : -2; }
}
function mixedInCallee(value: unknown): "a" | 64 { return value as "a" | 64; }
export function throughMixedCall(value: unknown): number {
  try { const checked = mixedInCallee(value); return typeof checked === "string" ? 1 : 64; }
  catch (error) { return error instanceof TypeError ? -1 : -2; }
}
export function finalized(value: unknown): number {
  let answer = 0;
  let visits = 0;
  try { const checked = value as 64; answer = checked; }
  catch (error) { answer = error instanceof TypeError ? -1 : -2; }
  finally { visits++; }
  return answer * 10 + visits;
}
export function beforeIndexEffect(value: unknown): number {
  let visits = 0;
  try { return (value as "a")[visits++] === "a" ? 1 : 2; }
  catch (error) { return error instanceof TypeError ? -10 - visits : -20; }
}
export function unionClaim(value: unknown): number {
  try { const checked = value as 0 | 1 | 2 | 3; return checked; }
  catch (error) { return error instanceof TypeError ? -1 : -2; }
}
export function enumClaim(value: unknown): number {
  try { const checked = value as Choice; return checked; }
  catch (error) { return error instanceof TypeError ? -1 : -2; }
}
export function enumMemberClaim(value: unknown): number {
  try { const checked = value as Code.Ok; return checked; }
  catch (error) { return error instanceof TypeError ? -1 : -2; }
}
export function anyClaim(value: any): number {
  try { const checked = value as 64; return checked; }
  catch (error) { return error instanceof TypeError ? -1 : -2; }
}
export function recoveredErasure(value: number): number {
  try { const checked = value as unknown as 64; return checked; }
  catch (error) { return error instanceof TypeError ? -1 : -2; }
}
export function mixedClaim(value: unknown): number {
  try { const checked = value as "a" | 64; return typeof checked === "string" ? 1 : 64; }
  catch (error) { return error instanceof TypeError ? -1 : -2; }
}
export function nullableClaim(value: unknown): number {
  try { const checked = value as "a" | null; return checked === null ? 0 : checked.length; }
  catch (error) { return error instanceof TypeError ? -1 : -2; }
}
export function bigintClaim(value: unknown): number {
  try { const checked = value as 64n; return checked === 64n ? 1 : 0; }
  catch (error) { return error instanceof TypeError ? -1 : -2; }
}
export function booleanClaim(value: unknown): number {
  try { const checked = value as true; return checked ? 1 : 0; }
  catch (error) { return error instanceof TypeError ? -1 : -2; }
}
// These controls differ only in the source's erased versus typed declaration.
// No literal claim licenses a value fact or changes the incoming number.
export function typedNumber(value: number): number { return value as 64; }
export function typedUnion(value: number): number { return value as 0 | 1 | 2 | 3; }
export function typedEnum(value: number): number { return value as Choice; }
export function typedString(value: string): string { return value as "a"; }
export function zeroClaim(value: unknown): number {
  try { const checked = value as 0; return 1 / checked; }
  catch (error) { return error instanceof TypeError ? -1 : -2; }
}
