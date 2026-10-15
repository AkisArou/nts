// A class whose fields begin with a face's, passed as the face beside a
// literal of it: a prefix receiver, so nothing moves a field and a read
// through the face is positional.
//
// The JVM declined `run` ("storing a `Settings` where a `Options` is declared
// -- `Options` carries state ...") while C, which reads the field at the
// face's offset in either struct, agreed. The read is the face's field
// accessor now, which `Settings` answers from its own field at that index.

interface Options {
  size: number;
  label: string;
}

class Settings {
  size: number;
  label: string;
  extra = 9;
  constructor(size: number, label: string) {
    this.size = size;
    this.label = label;
  }
}

function describe(options: Options): string {
  options.size = options.size + 1;
  return options.label + options.size;
}

export function run(n: number): string {
  const literal: Options = { size: n & 3, label: "a" };
  const kept: Options = new Settings(n & 7, "b");
  return describe(literal) + describe(kept) + describe(new Settings(2, "c"));
}
