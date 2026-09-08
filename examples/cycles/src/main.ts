// A cycle is exactly what reference counting cannot reclaim: every object in
// one is held by another object in the same one, so no count ever reaches zero
// and the last release never happens. RFC 9.2 names this as the price.
//
// It takes one line to build. `this.next = this` is a complete cycle, made
// inside a constructor, with no second object and no null to thread through --
// which is worth knowing, because it means the leak is not an exotic case
// waiting on features that do not exist yet.

class Node {
  value: number;
  next: Node;

  constructor(value: number) {
    this.value = value;
    this.next = this;
  }
}

export function selfCycle(times: number): number {
  // Bounded: the differential sweeps this parameter through a pool holding
  // 2^31, 2^32 and 2^53, which are values worth testing and loop bounds that
  // finish on neither side. See `examples/generators` for the whole reason.
  const bound = times > 65536 ? 65536 : times;
  let total = 0;
  for (let i = 0; i < bound; i++) {
    const node = new Node(i);
    total = total + node.next.value;
  }
  return total;
}

// A cycle through two objects rather than one, so the collector has to walk
// rather than notice a self-reference.
class Left {
  right: Right;
  value: number;

  constructor(value: number) {
    this.value = value;
    this.right = new Right(this);
  }
}

class Right {
  left: Left;

  constructor(left: Left) {
    this.left = left;
  }
}

export function pairCycle(times: number): number {
  // Bounded: the differential sweeps this parameter through a pool holding
  // 2^31, 2^32 and 2^53, which are values worth testing and loop bounds that
  // finish on neither side. See `examples/generators` for the whole reason.
  const bound = times > 65536 ? 65536 : times;
  let total = 0;
  for (let i = 0; i < bound; i++) {
    const left = new Left(i);
    total = total + left.right.left.value;
  }
  return total;
}

// An acyclic object of the same shape -- it holds a reference, but nothing that
// can lead back to it. Nothing here should ever be considered by a collector.
class Wrapper {
  inner: Leaf;

  constructor(value: number) {
    this.inner = new Leaf(value);
  }
}

class Leaf {
  value: number;

  constructor(value: number) {
    this.value = value;
  }
}

export function acyclic(times: number): number {
  // Bounded because the differential sweeps this parameter through a pool that
  // contains 2^31, 2^32 and 2^53. Those are useful as *values* and useless as a
  // loop bound: neither node nor the compiled program finishes, both are killed
  // at twenty seconds, and the case is abandoned along with the rest of this
  // function's batch -- scored as neither agreement nor disagreement, so it
  // bought nothing but wall clock, five times over because five backend lanes
  // run the same examples. Clamped, the same case is checked instead.
  const bound = times > 65536 ? 65536 : times;
  let total = 0;
  for (let i = 0; i < bound; i++) {
    const wrapper = new Wrapper(i);
    total = total + wrapper.inner.value;
  }
  return total;
}
