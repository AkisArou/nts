// A union narrowed by `in`, in a loop.
//
// `in` is a class test: the compiler computed which arms declare the property
// and the run time asks the value which arm it is. That is a load of the
// descriptor pointer and a comparison, so it neither allocates nor touches a
// count -- and the shapes it tests are built and dropped inside the iteration
// that made them.

interface Circle {
  radius: number;
}

interface Square {
  side: number;
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i++) {
    const shape: Circle | Square = i % 2 === 0 ? { radius: i } : { side: i };
    if ("radius" in shape) {
      total = total + shape.radius * 2;
    } else {
      total = total + shape.side;
    }
  }
  return total;
}
