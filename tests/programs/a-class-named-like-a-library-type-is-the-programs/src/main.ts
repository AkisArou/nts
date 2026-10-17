// A class named like a library type is the program's own.
//
// Lowering and the frontend recognize the library's provided types -- `Set`,
// `Map`, `Promise`, `Date`, the error classes -- by their names, so a module's
// own `class Set` was read as the library's: its `size()` was looked up in the
// built-in table ("`Set#size`, which this table has not") and the program was
// refused, though the class is an ordinary one. Are We Fast Yet's `som` library
// declares exactly such a `Set`, and Havlak uses it.
//
// A name now means the library's type only where the program implements no
// declaration of its own under that symbol; a library type's declarations are
// in files this compiler does not decode, and an augmentation of one is
// ambient. The control is the same class under another name, and the
// library's own `Set` beside it (in `library.ts`, where nothing shadows it),
// which both compiled before.

import { librarySize } from "./library.ts";

class Set<E> {
  items: E[] = [];
  add(item: E): void {
    for (let at = 0; at < this.items.length; at++) {
      if (this.items[at] === item) return;
    }
    this.items.push(item);
  }
  size(): number {
    return this.items.length;
  }
}

class Bag<E> {
  items: E[] = [];
  add(item: E): void {
    for (let at = 0; at < this.items.length; at++) {
      if (this.items[at] === item) return;
    }
    this.items.push(item);
  }
  size(): number {
    return this.items.length;
  }
}

export function programsSet(n: number): number {
  const own = new Set<number>();
  for (let i = 0; i < (n & 15); i++) own.add(i % 4);
  return own.size();
}

export function renamedControl(n: number): number {
  const own = new Bag<number>();
  for (let i = 0; i < (n & 15); i++) own.add(i % 4);
  return own.size();
}

export function providedControl(n: number): number {
  return librarySize(n & 15);
}

export function counted(n: number): number {
  const count = n & 15;
  const own = new Set<number>();
  const bag = new Bag<number>();
  for (let i = 0; i < count; i++) {
    own.add(i % 4);
    bag.add(i % 4);
  }
  return own.size() * 10000 + bag.size() * 100 + librarySize(count);
}

console.log(counted(9), counted(0), counted(2));
