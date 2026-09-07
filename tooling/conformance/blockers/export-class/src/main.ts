// expect: emit-c --napi -> no wrapper for Decoder: is exported and is not a
//         function this backend can name
//
// A class as a module export. `string_decoder`'s entire public surface is one --
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
