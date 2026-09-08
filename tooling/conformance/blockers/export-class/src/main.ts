// expect: emit-c --napi -> emits-addon napi_define_class(env, "Decoder"
//
// FIXED, kept as a guard. A class as a module export. `string_decoder`'s entire public surface is one --
// `shape.mjs` needs exactly the name `StringDecoder` and nothing else -- so this
// single kind of export is the whole distance between that module compiling,
// which it does, and it passing anything, which it cannot.
//
// It is a different piece of work from every other blocker filed here. The
// others are values or statements the lowering cannot represent; this one lowers
// completely. What is missing is on the wrapper side: a Node-API class needs a
// constructor that allocates the instance, a prototype carrying the methods, and
// a finalizer, and none of that is a function signature crossing a boundary.
//
// `buffer` and `url` want the same thing next, and `stream` wants it five times
// over with a prototype chain between the classes -- see `runtime/node/stream/
// test/prototype-chain-static.js` for what that chain has to survive, because
// publishing five independent classes would satisfy every name and leave a
// `Duplex` that is not a `Readable`.
export class Decoder {
  private readonly encoding: string;

  constructor(encoding: string) {
    this.encoding = encoding;
  }

  name(): string {
    return this.encoding;
  }
}

// **What it took, and what it did not.** A `napi_define_class` whose
// constructor allocates through a factory `program.c` now emits for a published
// class -- the descriptor stays private and the factory is the one deliberate
// hole -- a prototype built from property descriptors, and a finalizer that
// releases the instance when the JavaScript object dies.
//
// Verified by loading it, not by reading it: `new Decoder("utf8").name()`
// answers `"utf8"`, a second instance is independent, and `d instanceof
// Decoder` is true. The first version linked and did not run, and the version
// before that did not compile -- `unmarshal` emits `goto nts_napi_cleanup` and
// the constructor callback had no such label. No emit-only check would have
// caught either.
//
// It does **not** yet do the prototype chain this file warns about. `stream`
// needs five classes with `Duplex` extending `Readable`, and five independent
// `napi_define_class` calls satisfy every name while leaving `duplex
// instanceof Readable` false. That is the next piece and it is separate.
