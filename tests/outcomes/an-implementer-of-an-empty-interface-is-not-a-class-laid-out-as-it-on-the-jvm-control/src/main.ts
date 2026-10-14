// run: check
// backend: jvm
//
// The control: the same, with the class with no fields given one, so it is not
// laid out as the empty interface.
interface Handle {}

class Memory implements Handle {
  revision = 0;
}

class Bound {
  id = 1;
  close(): number {
    return 1;
  }
}

function handle(): Handle {
  return new Memory();
}

function made(n: number): unknown {
  if ((n & 1) === 0) {
    return new Bound();
  }
  return handle();
}

export function run(n: number): string {
  const v = made(n);
  return String(v instanceof Bound) + " " + String(v instanceof Memory);
}
