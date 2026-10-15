// A reference compared with the null literal, from either side and in either
// sense: a class object, an array, a list walked to its null link, and a `!`
// on a field. Wasm asks `ref.is_null` for each rather than comparing identity
// with a null, and these say it answers what node answers.

class Link {
  constructor(
    public value: number,
    public next: Link | null,
  ) {}
}

class Holder {
  item: Link | null = null;
}

function maybe(n: number): Link | null {
  return n > 0 ? new Link(n, null) : null;
}

function maybeArray(n: number): number[] | null {
  return n > 0 ? [n, n + 1] : null;
}

export function objects(n: number): number {
  const x = maybe(n);
  let answer = 0;
  if (x === null) answer += 1;
  if (null === x) answer += 2;
  if (x !== null) answer += 4;
  if (null !== x) answer += 8;
  return answer;
}

export function arrays(n: number): number {
  const xs = maybeArray(n);
  let answer = 0;
  if (null === xs) answer += 1;
  if (xs !== null) answer += xs.length * 2;
  if (null !== xs) answer += 16;
  if (xs === null) answer += 32;
  return answer;
}

export function walked(n: number): number {
  let head: Link | null = null;
  for (let i = 0; i < n && i < 40; i += 1) head = new Link(i, head);
  let count = 0;
  for (let at = head; null !== at; at = at.next) count += at.value + 1;
  return count;
}

export function asserted(n: number): number {
  const holder = new Holder();
  if (n > 0) {
    holder.item = new Link(n, null);
    return holder.item!.value * 2;
  }
  return null === holder.item ? -1 : -2;
}
