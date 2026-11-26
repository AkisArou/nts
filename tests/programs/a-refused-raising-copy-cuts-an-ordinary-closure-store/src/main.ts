function validateOneOf<const C extends readonly unknown[]>(v: unknown, n: string, o: C): asserts v is C[number] {
  if (!o.includes(v)) throw new Error(n);
}
const orders = ["a", "b"];
let order = "a";
function setOrder(o: string): void { validateOneOf(o, "order", orders); order = o; }
function getOrder(): string { return order; }
export const api = { setOrder, getOrder };
function attempt(f: () => number): number { try { return f(); } catch { return -1; } }
console.log(attempt(() => 1));
api.setOrder("b");
console.log(api.getOrder());
