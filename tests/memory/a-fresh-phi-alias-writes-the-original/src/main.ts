// A phi can name original: its store must invalidate original.next.
class Cell {
  next: Cell | null = null;
  constructor(public value: number) {}
}
let published: Cell | null = null;
export function work(n: number): number {
  const original = new Cell(n);
  const other = new Cell(n + 1);
  const alias = n > 0 ? original : other;
  const first = new Cell(n + 2);
  published = first;
  alias.next = first;
  original.next = new Cell(n + 3);
  const answer = original.next.value + (alias.next === null ? 0 : alias.next.value) + published.value;
  published = null;
  return answer;
}
