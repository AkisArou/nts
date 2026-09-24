import type { Task } from "./Task.ts";

// A binary min-heap of tasks ordered by `sortIndex`, then by insertion order.

export function push(heap: Task[], node: Task): void {
  heap.push(node);
  siftUp(heap, node, heap.length - 1);
}

export function peek(heap: Task[]): Task | null {
  return heap[0] ?? null;
}

export function pop(heap: Task[]): Task | null {
  const first = heap[0];
  if (first === undefined) {
    return null;
  }
  const last = heap.pop()!;
  if (last !== first) {
    heap[0] = last;
    siftDown(heap, last, 0);
  }
  return first;
}

function siftUp(heap: Task[], node: Task, start: number): void {
  let index = start;
  while (index > 0) {
    const parentIndex = (index - 1) >>> 1;
    const parent = heap[parentIndex]!;
    if (compare(parent, node) <= 0) {
      return;
    }
    heap[parentIndex] = node;
    heap[index] = parent;
    index = parentIndex;
  }
}

function siftDown(heap: Task[], node: Task, start: number): void {
  let index = start;
  const length = heap.length;
  const halfLength = length >>> 1;
  while (index < halfLength) {
    // Below half the length, a node always has a left child.
    const leftIndex = index * 2 + 1;
    const left = heap[leftIndex]!;
    const rightIndex = leftIndex + 1;
    const right = rightIndex < length ? heap[rightIndex]! : null;
    // Swap with the smaller child, if either is smaller than the node.
    if (compare(left, node) < 0) {
      if (right !== null && compare(right, left) < 0) {
        heap[index] = right;
        heap[rightIndex] = node;
        index = rightIndex;
      } else {
        heap[index] = left;
        heap[leftIndex] = node;
        index = leftIndex;
      }
    } else if (right !== null && compare(right, node) < 0) {
      heap[index] = right;
      heap[rightIndex] = node;
      index = rightIndex;
    } else {
      return;
    }
  }
}

function compare(a: Task, b: Task): number {
  const diff = a.sortIndex - b.sortIndex;
  return diff !== 0 ? diff : a.id - b.id;
}
