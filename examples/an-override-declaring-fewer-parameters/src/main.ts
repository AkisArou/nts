// An override that declares fewer parameters than the method it overrides,
// dispatched through the base with the full argument list: stream's
// `Transform._read()` over `Readable._read(size)`.
//
// JavaScript passes the argument and the override ignores it; C, which ignores
// extra arguments too, agrees by construction. The JVM names a method by its
// descriptor, so `()D` does not override `(D)D`, and the backend declined the
// class under NTS4009 -- Transform, DuplexSide and IncomingMessage, and with
// them stream, zlib, crypto, fs and http (jvm-verifies cause E). It now emits a
// bridge with the base's descriptor that drops the argument.
// tooling/conformance/outcomes/an-override-declaring-fewer-parameters is the
// same claim as an outcomes record.

class Source {
  _read(size: number): number {
    return size;
  }
  read(n: number): number {
    return this._read(n * 2) + 1;
  }
}

class Fixed extends Source {
  _read(): number {
    return 100;
  }
}

// The control: an override declaring every parameter.
class Doubled extends Source {
  _read(size: number): number {
    return size * 2;
  }
}

function pick(n: number): Source {
  return n > 1 ? new Fixed() : n > 0 ? new Doubled() : new Source();
}

export function dispatched(n: number, size: number): number {
  return pick(n).read(size);
}
