// expect: an ambient re-declaration of builtin
declare const Math: { floor(n: number): number };
declare const JSON: { stringify(n: number): string };

export { control } from "./control.ts";

export function narrowedMath(n: number): number {
  return Math.floor(n);
}

export function narrowedJSON(n: number): string {
  return JSON.stringify(n);
}
