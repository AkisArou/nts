export interface Context {
  alpha: string;
}
export function useAlpha(c: Context): string {
  return c.alpha;
}
