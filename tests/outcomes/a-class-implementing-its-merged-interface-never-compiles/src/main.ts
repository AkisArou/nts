// A class implementing the interface merged with it never finished
// compiling (#497, from benchmarks/cases/jetstream-threejs's
// `declare class XRSystem implements XRSystem`): the native schema's
// base-class search read every heritage clause, so the `implements`
// name -- the class's own merged interface -- resolved back to the
// class itself, and every ancestry walk over it looped for ever.
// run: check
// The two arms differ in one thing: the name of the implemented
// interface. The control's is another name; the subject's is the
// class's own, merged with it. Both answer as node does.
interface Tally {
  count(): number;
}

class Control implements Tally {
  count(): number {
    return 3;
  }
}

interface Counter {
  count(): number;
}

class Counter implements Counter {
  count(): number {
    return 3;
  }
}

export function control(): number {
  return new Control().count();
}

export function subject(): number {
  return new Counter().count();
}
