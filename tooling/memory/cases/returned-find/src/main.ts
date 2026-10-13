// What returning an element `find` found costs: the element's one reference,
// handed to the caller, and nothing left behind.
//
// `cards.find(cb)` lowers to a loop for the index and one read of the element
// at it (`nts_array_at_ref`), which hands back an owned reference: the caller
// releases what it is given. Until 2026-10-14 that helper was declared
// reads-only, so `find` below -- whose only call it is -- read as a function
// with nothing to count: the element was never released, and was retained
// again to be returned. One object outlived every call (the Chromium lane's
// board app, found by its document's live count at teardown).
//
// The control is an indexed read, `cards[1]`, which borrows and retains to
// return; and a `find` that finds nothing, which reads no element.

interface Card {
  id: number;
}

function find(cards: Card[], id: number): Card | undefined {
  return cards.find((c) => c.id === id);
}

function at(cards: Card[], index: number): Card {
  return cards[index];
}

export function work(n: number): number {
  const cards: Card[] = [{ id: 1 }, { id: 2 }];
  let total = 0;
  for (let i = 0; i < n; i = i + 1) {
    const found = find(cards, 2);
    if (found !== undefined) {
      total = total + found.id;
    }
    if (find(cards, 7) === undefined) {
      total = total + 1;
    }
    total = total + at(cards, 1).id;
  }
  return total;
}
