// expect: emit-c --napi -> emits-addon nts_napi_Holder__get_bytes, NULL, NULL, napi_default
//
// A class whose surface is *accessors*, which is the shape `string_decoder`
// needs and the one a methods-only class arm would satisfy by name and get
// wrong: node exposes `lastChar`, `lastNeed` and `lastTotal` as prototype
// getters, so publishing them as methods answers a function where a `Buffer`
// belongs.
//
// The expectation is the descriptor form rather than the callback's existence.
// A getter is `{ name, NULL, NULL, getter, ... }` and a method is
// `{ name, NULL, method, NULL, ... }`, so the *position* of the callback is the
// whole of the difference and a test that only checked the callback was emitted
// would pass for either.
//
// `bytes` also returns a view, so this covers the second half of `lastChar`:
// the value has to arrive as something answering `.equals`, which is a node
// `Buffer` and not a bare `Uint8Array`.

export class Holder {
  private readonly stored: Uint8Array;

  constructor(first: number) {
    const bytes = new Uint8Array(4);
    bytes[0] = first;
    this.stored = bytes;
  }

  get bytes(): Uint8Array {
    return this.stored;
  }

  get width(): number {
    return 4;
  }
}
