export interface Context {
  beta: number;
}
export function useBeta(c: Context): number {
  return c.beta;
}
