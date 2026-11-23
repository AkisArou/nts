// Which calls a region could serve (`hir::regions`), each beside a control
// that differs from it in one thing. A region serves `r = f(args)` when
// everything `f` makes can be given back at once where `r` dies: `f` stores
// only into what it made (fact 1), keeps only references made in the call or
// immortal (fact 2), and the caller only reads `r` (fact 3).
// `compiler/core/tests/region_sites.rs` asserts each verdict; here node checks
// that the program means what it says.

// At most this many cells, whatever the pool passes: a count of two billion
// finishes or runs out of memory by how busy the machine is, in node as here.
const BOUND = 64;

function bounded(count: number): number {
  return count > BOUND ? BOUND : count;
}

class Cell {
  constructor(
    public value: number,
    public next: Cell | null,
  ) {}
}

class Holder {
  cell: Cell = new Cell(7, null);
}

// Made in the call, link by link: a list that is the region's whole content.
function build(count: number): Cell | null {
  let head: Cell | null = null;
  for (let index = 0; index < count; index++) {
    head = new Cell(index, head);
  }
  return head;
}

// The same list, recursively: a function that calls itself is judged by what
// its body does.
function buildDown(count: number): Cell | null {
  // Not `count === 0`: a fraction or NaN from the pool would never reach it.
  if (!(count > 0)) return null;
  return new Cell(count, buildDown(count - 1));
}

function total(list: Cell | null): number {
  let sum = 0;
  for (let at = list; at !== null; at = at.next) {
    sum += at.value;
  }
  return sum;
}

// Site: built, read, dropped.
export function readsAList(count: number): number {
  const list = build(bounded(count));
  return total(list);
}

// Site: the recursive one.
export function readsARecursiveList(count: number): number {
  const list = buildDown(bounded(count));
  return total(list);
}

// Refused (fact 3): the result is kept in a global past the call's span.
let kept: Cell | null = null;
export function keepsAList(count: number): number {
  kept = build(bounded(count));
  return total(kept);
}

// Refused (fact 3): the result is handed to a call that keeps it.
function remember(list: Cell | null): number {
  kept = list;
  return 1;
}
export function handsAListOn(count: number): number {
  const list = build(bounded(count));
  return remember(list) + total(list);
}

// Refused (fact 1): the callee writes a global.
let made = 0;
function buildCounting(count: number): Cell | null {
  made++;
  return build(count);
}
export function countsWhileBuilding(count: number): number {
  const list = buildCounting(bounded(count));
  return total(list) + made;
}

// Refused (fact 2): keeping an argument alive does not balance helper counts
// in a count-free clone. The head is always a cell the call made:
// a call that could hand its argument back is refused, since the caller gives
// up the result it is handed.
function prepend(count: number, rest: Cell): Cell {
  let head = new Cell(-1, rest);
  for (let index = 0; index < count; index++) {
    head = new Cell(index, head);
  }
  return head;
}
export function prependsToAnArgument(count: number): number {
  const rest = new Cell(count, null);
  const list = prepend(bounded(count), rest);
  return total(list);
}

// Refused (fact 2), changing only the external edge to a field of the
// argument: this also needs external-edge ownership.
function prependField(count: number, holder: Holder): Cell {
  let head = new Cell(-1, holder.cell);
  for (let index = 0; index < count; index++) {
    head = new Cell(index, head);
  }
  return head;
}
export function prependsToAField(count: number): number {
  const holder = new Holder();
  const list = prependField(bounded(count), holder);
  return total(list);
}

// Site: a temporary the call only reads, which dies at the call -- its
// release must come after the region's call has ended, or it is freed inside
// the region's window.
function fromValues(values: number[]): Cell | null {
  let head: Cell | null = null;
  for (let index = 0; index < values.length; index++) {
    head = new Cell(values[index], head);
  }
  return head;
}
export function buildsFromATemporary(count: number): number {
  const list = fromValues([count, count + 1, count + 2]);
  return total(list);
}

// Refused: an argument stored straight into a field still needs an external
// ownership edge. Keeping the caller alive does not establish that protocol.
function wrap(count: number, rest: Cell): Cell {
  const head = new Cell(-1, null);
  head.next = rest;
  let at: Cell = head;
  for (let index = 0; index < count; index++) {
    at = new Cell(index, at);
  }
  return at;
}
export function wrapsAnArgument(count: number): number {
  const list = wrap(bounded(count), new Cell(count, null));
  return total(list);
}

// Refused (the cost): one cell is too little for a region to pay for opening
// and giving back -- a call allocates repeatedly, in a loop or a recursion,
// or a region only slows it.
function single(value: number): Cell {
  return new Cell(value, null);
}
export function readsOneCell(count: number): number {
  const cell = single(count);
  return cell.value;
}

class Text {
  constructor(
    public text: string,
    public next: Text | null,
  ) {}
}

function textTotal(list: Text | null): number {
  let sum = 0;
  for (let at = list; at !== null; at = at.next) {
    sum += at.text.length;
  }
  return sum;
}

// Refused (the retained input): `toLowerCase` may answer its input retained
// (unchanged text), and a region clone runs uncounted, so that count would
// never be balanced -- even here, where the answer is only read and dropped.
// The word comes from outside the candidate call.
function lowerOfArgument(count: number, word: string): Text | null {
  let head: Text | null = null;
  let length = 0;
  for (let index = 0; index < count; index++) {
    length += word.toLowerCase().length;
    head = new Text("x", head);
  }
  return length < 0 ? null : head;
}
export function lowersAnArgument(count: number): number {
  const word = "Ab" + count;
  const list = lowerOfArgument(bounded(count), word);
  return textTotal(list) + word.length;
}

// Site (control, differing in one thing): the lowered text is made inside
// the call, so there is no external count to unbalance.
function lowerOfMade(count: number): Text | null {
  let head: Text | null = null;
  let length = 0;
  for (let index = 0; index < count; index++) {
    length += "Ab".repeat(index + 1).toLowerCase().length;
    head = new Text("x", head);
  }
  return length < 0 ? null : head;
}
export function lowersMadeText(count: number): number {
  const list = lowerOfMade(bounded(count));
  return textTotal(list);
}

// Site (control): the lowered text is an immortal literal; retaining it is a
// no-op everywhere.
function lowerOfLiteral(count: number): Text | null {
  let head: Text | null = null;
  let length = 0;
  for (let index = 0; index < count; index++) {
    length += "AbC".toLowerCase().length;
    head = new Text("x", head);
  }
  return length < 0 ? null : head;
}
export function lowersALiteral(count: number): number {
  const list = lowerOfLiteral(bounded(count));
  return textTotal(list);
}

// Refused (the retained input, through an outer call): `word` is made inside
// `buildAndLower`'s call, but it is still outside `lowerOfArgument`'s call,
// and that inner candidate is the one whose clone would retain it uncounted.
function buildAndLower(count: number): Text | null {
  const word = "Ab" + count;
  return lowerOfArgument(count, word);
}
export function lowersThroughAnOuterCall(count: number): number {
  const list = buildAndLower(bounded(count));
  return textTotal(list);
}

// Refused (fact 1): the callee stores into its argument.
function appendTo(into: Cell[], count: number): Cell[] {
  for (let index = 0; index < count; index++) {
    into.push(new Cell(index, null));
  }
  return into;
}
export function appendsToAnArgument(count: number): number {
  const into: Cell[] = [];
  const list = appendTo(into, bounded(count));
  return list.length;
}
