// A binary heap with a caller-supplied comparison, from node's
// `internal/priority_queue`.
//
// The timers design needs the *earliest-expiring duration list*, repeatedly,
// while lists are inserted and removed. That is a priority queue, and the
// comparison is over two fields rather than one -- expiry first, then creation
// order to break a tie -- so the ordering cannot be a subtraction and has to be
// passed in.
//
// The second callback, `setPosition`, is what makes removal from the middle
// possible. A heap can only remove its root cheaply; removing an arbitrary
// element needs its index, and nothing outside the heap knows that index
// because it changes on every percolation. So the heap tells each element
// where it is as it moves, and the element remembers. `unenroll` uses that to
// drop an emptied list in O(log n) instead of scanning.

/** Storage is 1-indexed: a node at `i` has children at `2i` and `2i + 1`. */
const ROOT = 1;

export class PriorityQueue<T> {
  readonly #compare: (a: T, b: T) => number;
  readonly #setPosition: ((node: T, position: number) => void) | undefined;
  // Index 0 is never used, so that the child-index arithmetic above needs no
  // adjustment. It holds `undefined` rather than being absent so the array
  // never has a hole.
  #heap: (T | undefined)[] = [undefined, undefined];
  #size = 0;

  constructor(
    comparator: (a: T, b: T) => number,
    setPosition?: (node: T, position: number) => void,
  ) {
    this.#compare = comparator;
    this.#setPosition = setPosition;
  }

  get size(): number {
    return this.#size;
  }

  insert(value: T): void {
    const position = ++this.#size;
    this.#heap[position] = value;
    this.percolateUp(position);
  }

  /** The smallest element under the comparison, or undefined when empty. */
  peek(): T | undefined {
    return this.#heap[ROOT];
  }

  peekBottom(): T | undefined {
    return this.#heap[this.#size];
  }

  /**
   * Sift the element at `position` down until both children are larger.
   *
   * Called directly by the timers code as well as by removal: when a list's
   * expiry is pushed back because its next timer is not due yet, the list is
   * still in the heap but is no longer necessarily the smallest, and this
   * restores the invariant without a remove and re-insert.
   */
  percolateDown(position: number): void {
    const compare = this.#compare;
    const setPosition = this.#setPosition;
    const heap = this.#heap;
    const size = this.#size;
    const lastParent = size >> 1;
    const item = heap[position] as T;

    while (position <= lastParent) {
      let child = position << 1;
      const nextChild = child + 1;
      let childItem = heap[child] as T;

      // Descend towards the smaller of the two children, or the heap property
      // would be restored against one child and broken against the other.
      if (nextChild <= size && compare(heap[nextChild] as T, childItem) < 0) {
        child = nextChild;
        childItem = heap[nextChild] as T;
      }

      if (compare(item, childItem) <= 0) break;

      if (setPosition !== undefined) setPosition(childItem, position);

      heap[position] = childItem;
      position = child;
    }

    heap[position] = item;
    if (setPosition !== undefined) setPosition(item, position);
  }

  percolateUp(position: number): void {
    const heap = this.#heap;
    const compare = this.#compare;
    const setPosition = this.#setPosition;
    const item = heap[position] as T;

    while (position > ROOT) {
      const parent = position >> 1;
      const parentItem = heap[parent] as T;
      if (compare(parentItem, item) <= 0) break;
      heap[position] = parentItem;
      if (setPosition !== undefined) setPosition(parentItem, position);
      position = parent;
    }

    heap[position] = item;
    if (setPosition !== undefined) setPosition(item, position);
  }

  /**
   * Remove whatever is at `position`.
   *
   * The last element fills the hole, and then has to move in *whichever*
   * direction restores the invariant -- up if it is smaller than its new
   * parent, down otherwise. A heap removal that only ever sifts down is
   * correct for the root and silently wrong anywhere else.
   */
  removeAt(position: number): void {
    const heap = this.#heap;
    heap[position] = heap[this.#size];
    heap[this.#size] = undefined;
    const size = --this.#size;

    if (size > 0 && position <= size) {
      if (position > ROOT && this.#compare(heap[position >> 1] as T, heap[position] as T) > 0) {
        this.percolateUp(position);
      } else {
        this.percolateDown(position);
      }
    }
  }

  /** Remove and return the smallest element, or undefined when empty. */
  shift(): T | undefined {
    const value = this.#heap[ROOT];
    if (value === undefined) return undefined;
    this.removeAt(ROOT);
    return value;
  }
}
