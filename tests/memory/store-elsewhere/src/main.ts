// Reading through one container while storing into another.
//
// `Towers#pushDisk` in miniature, and the reason it is still 6.9x: it reads
// `this.piles` and writes `disk.next`, and the effects summary is one boolean
// per function, so "stores" ends the borrow of `piles` even though nothing it
// stores to could possibly be the slot `piles` came from.

class Disk { size: number; next: Disk | null; constructor(s: number) { this.size = s; this.next = null; } }
class Table { top: Disk | null; constructor() { this.top = null; } }

export function work(n: number): number {
  const table = new Table();
  let count = 0;
  for (let i = 0; i < 32 + n; i++) {
    const made = new Disk(i);
    // Reads `table.top`, writes `made.next` -- a different layout, a different
    // field, and no way for the write to name the slot the read came from.
    made.next = table.top;
    table.top = made;
    count = count + 1;
  }
  let at = table.top;
  while (at !== null) { count = count + at.size; at = at.next; }
  return count;
}
