// An enum's members, read in a loop.
//
// In JavaScript an `enum` is an *object*: `tsc` emits one with a forward
// mapping and a reverse one, and every `Colour.Red` is a property read off it.
// None of that exists here. The checker has already done the arithmetic and
// gives the access a literal type, so the member is an immediate.
//
// This case exists to say that the object is absent rather than cheap. A
// compiler that lowered an enum the way JavaScript does would allocate one
// table per enum and read a field per use, and both would show up here.

enum Colour {
  Red = 1,
  Green = 2,
  Blue = 4,
}

export function work(n: number): number {
  let sum = 0;
  for (let i = 0; i < 8 + n; i++) {
    sum = sum + Colour.Red + Colour.Green + Colour.Blue;
  }
  return sum;
}
