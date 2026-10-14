// run: check
// backend: jvm
//
// An empty interface a class with a field implements, which shares its empty
// layout with one class with no fields: an instance of the implementer is not
// an instance of the class with no fields.
interface Handle {}

class Memory implements Handle {
  revision = 0;
}

class Bound {
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
