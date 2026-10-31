import { Buffer } from "node:buffer";
export function work(iterations: number): number {
  let total = 0;
  for (let i = 0; i < 64 * iterations; i++) {
    const bytes = Buffer.from("a small UTF-8 allocation", "utf8");
    total += bytes[0]! + bytes.length;
  }
  return total;
}
export const seed = 1;
