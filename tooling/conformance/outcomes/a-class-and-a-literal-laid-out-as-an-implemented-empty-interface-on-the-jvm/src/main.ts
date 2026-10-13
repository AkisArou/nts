// run: check
// backend: jvm
//
// An empty interface a class with a field implements, which shares its empty
// layout with a class with no fields and with an empty literal: the class with
// the field is returned as the interface, and each value answers `instanceof`
// by what made it.
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
  switch (n % 3) {
    case 0:
      return new Bound();
    case 1:
      return {};
    default:
      return handle();
  }
}

export function run(n: number): string {
  const v = made(n);
  return String(v instanceof Bound) + " " + String(v instanceof Memory);
}
