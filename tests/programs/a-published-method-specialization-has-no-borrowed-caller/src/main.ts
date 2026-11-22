// A class's source member is public; its guarded numeric specialization is
// called only by name. The latter needs no borrowed adapter or private copy.
export class Item {
  value: number;
  constructor(value: number) { this.value = value; }
}
let held: Item | null = null;

export class Holder {
  put(item: Item, n: number): number {
    let answer = item.value;
    for (let i = 0; i < n; i++) answer += i;
    held = item;
    return answer;
  }
}

export function work(n: number): number {
  const answer = new Holder().put(new Item(n), n & 7);
  const value = held!.value;
  held = null;
  return answer + value;
}
