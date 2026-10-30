export function produced(n: number): number {
  return "a1a".indexOf(String(n) as any, n);
}
export function literal(n: number): number {
  return "ababa".indexOf("a" as any, n);
}
export function checked(s: string | undefined, n: number): number {
  return "ababa".indexOf((s as unknown as string), n);
}
export function typed(s: string | undefined, n: number): number {
  return "ababa".indexOf((s as string), n);
}
export function widened(s: string | undefined, n: number): number {
  return "ababa".indexOf((s as any), n);
}
export function checkedNullable(s: unknown, n: number): number {
  return "ababa".indexOf((s as string | null) as any, n);
}
