// run: check
// backend: jvm
//
// The control: the same, with the class it is told apart from holding a field,
// so that class is not laid out as the empty interface.
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
