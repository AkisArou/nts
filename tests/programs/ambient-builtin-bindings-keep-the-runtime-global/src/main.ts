declare const Math: typeof globalThis.Math;
declare const JSON: typeof globalThis.JSON;
declare const Number: typeof globalThis.Number;

export { mergedFloor, mergedIsNaN, augmentedConstant, augmentedView } from "./globals.ts";

export function ambientFloor(n: number): number {
  return Math.floor(n);
}

export function ambientJSON(n: number): string {
  return JSON.stringify(n);
}

export function ambientNumber(n: number): boolean {
  return Number.isNaN(n);
}
