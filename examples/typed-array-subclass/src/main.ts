// A class that extends a typed array.
//
// `Uint8Array` is not a class anywhere in this compiler: a typed array *is*
// `ManagedType::Array(u8)`, an `NtsArray` header followed by its items inline.
// So there is nothing to inherit storage from, and the question is only what
// the subclass's own storage does to the layout.
//
// A subclass that adds none has no layout question at all — it *is* the array,
// and its methods are ordinary functions taking that array as `this`. That is
// what this file is, and it is stated over any class descending from any typed
// array rather than over a name: node's `Buffer` is the one that matters, and
// it declares ninety-odd methods and not one field.
//
// A subclass that *adds a field* is a genuinely different shape:
//
//     NtsArray:   header | items[]          items are inline, so they are last
//     an object:  header | field | field
//     both:       header | field | items[]  a third layout
//
// and the third would make the item offset vary per type, so every array read
// in the program would consult a descriptor instead of a fixed offset. That is
// a cost paid by all typed code for one shape, so it stays refused.

class Bytes extends Uint8Array {
  sum(): number {
    let total = 0;
    for (let i = 0; i < this.length; i += 1) {
      total += this[i]!;
    }
    return total;
  }

  // Reading and writing through `this`, which is the array itself.
  doubleAt(index: number): number {
    this[index] = this[index]! * 2;
    return this[index]!;
  }
}

export function summed(n: number): number {
  const b = new Bytes(4);
  b[0] = n;
  b[1] = n + 1;
  b[2] = 2;
  return b.sum();
}

export function throughAMethod(n: number): number {
  const b = new Bytes(2);
  b[0] = n;
  return b.doubleAt(0) + b.length;
}

// A subclass is its base, so it goes where the base goes.
function total(xs: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < xs.length; i += 1) {
    sum += xs[i]!;
  }
  return sum;
}

export function asItsBase(n: number): number {
  const b = new Bytes(3);
  b[0] = n;
  b[1] = n;
  return total(b);
}
