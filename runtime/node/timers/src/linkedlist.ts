// An intrusive doubly-linked circular list, from node's `internal/linkedlist`.
//
// Intrusive because the nodes are the timers themselves: `_idleNext` and
// `_idlePrev` are fields on `Timeout`, not on a wrapper around it. That is the
// point rather than an optimisation. A list of ten thousand timers allocates
// nothing beyond the timers, and removing one is four pointer writes with no
// lookup -- the timer already knows where it sits. A `Set` or an array would
// need a search or a second object per timer, and `clearTimeout` is as hot as
// `setTimeout`.
//
// These are free functions over a shape rather than a class, again as node has
// them, because there is no list object to own: a `TimersList` *is* a node, and
// so is every timer in it. A class would have to hold a reference per element
// and the intrusiveness would be gone.
//
// The direction is worth stating because it reads backwards. `_idleNext` walks
// towards *older* entries and `_idlePrev` towards newer ones, so the head
// sentinel's `_idleNext` is the newest entry and its `_idlePrev` is the oldest.
// `peek` wants the oldest -- it is the one due to expire first, since every
// timer in a list shares a duration and so they expire in insertion order.

/**
 * Anything that can be in a list, which includes the list's own head.
 *
 * The head is a node with no payload, so that an empty list and a populated
 * one have the same shape and no operation needs a null check for "is this the
 * first element".
 */
export interface ListNode {
  _idleNext: ListNode | null;
  _idlePrev: ListNode | null;
}

/** Make `list` an empty list, pointing at itself in both directions. */
export function init<T extends ListNode>(list: T): T {
  list._idleNext = list;
  list._idlePrev = list;
  return list;
}

/** The oldest entry, or null when there is none. */
export function peek(list: ListNode): ListNode | null {
  if (list._idlePrev === list) return null;
  return list._idlePrev;
}

/**
 * Unlink `item` from whichever list holds it.
 *
 * It does not need to be told which list that is, which is what makes removal
 * constant-time: the item's own two pointers are the whole of what has to
 * change, plus one field in each neighbour.
 */
export function remove(item: ListNode): void {
  if (item._idleNext) {
    item._idleNext._idlePrev = item._idlePrev;
  }

  if (item._idlePrev) {
    item._idlePrev._idleNext = item._idleNext;
  }

  item._idleNext = null;
  item._idlePrev = null;
}

/**
 * Move `item` to the newest end of `list`, unlinking it from anywhere else
 * first.
 *
 * Appending is the only insertion this list needs. Every timer in a list has
 * the same duration, so one enrolled later always expires later, and the list
 * stays sorted by expiry without anything sorting it. That is the property the
 * whole timer design is built on.
 */
export function append(list: ListNode, item: ListNode): void {
  if (item._idleNext || item._idlePrev) {
    remove(item);
  }

  item._idleNext = list._idleNext;
  item._idlePrev = list;

  // Non-null because a list is always `init`ed before anything is appended,
  // which leaves it pointing at itself. Keep the check here so a broken
  // caller fails at the invariant instead of corrupting a neighbouring list.
  const next = list._idleNext;
  if (next === null) throw new Error("cannot append to an uninitialised list");
  next._idlePrev = item;
  list._idleNext = item;
}

export function isEmpty(list: ListNode): boolean {
  return list._idleNext === list;
}
