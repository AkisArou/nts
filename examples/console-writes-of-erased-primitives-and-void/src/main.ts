// `console.log` arguments node prints without inspecting structure, including
// two the compiler had refused: an `unknown` erased in this function from a
// number (`ownProducer`), whose printing the operand decides, and
// `void ++count` as a first argument typed `string` by its context
// (`evaluationOrder`), which is `undefined` whatever type it was given.
// From the Codex branch's console-write-positive program (1e6b70c36),
// re-derived on main without its producer contracts.
// An ambient annotation augments the checker without replacing the value.
declare global { interface Console { log(message: string, ...values: any[]): void; } }

export function stdout(n: number): number {
  console.log("numbers", n, -n, n * 0, -n * 0, n / 3);
  console.info("words", "é😀", n > 0, !(n > 0));
  console.debug("100%%");
  return n;
}
export function stderr(n: number): number {
  console.error("error", n);
  console.warn("warning", n);
  return n + 1;
}
export function empty(n: number): number { console.log(); return n + 2; }
export function writtenAbsence(n: number): number {
  console.log("absent", null, undefined, void 0, (null), (undefined));
  return n + 3;
}
export function bigints(n: number): number { console.log("bigint", 12345678901234567890n, -17n); return n + 4; }
export function ownProducer(n: number): number { const value: unknown = n; console.log("producer", value); return n + 5; }
export function evaluationOrder(n: number): number { let count = 0; console.log(void ++count, ++count, ++count); return count + n; }
function writeSymbol(value: symbol): void { console.log("symbol", value); }
export function symbols(n: number): number { writeSymbol(Symbol.for("console-proof")); return n + 6; }
