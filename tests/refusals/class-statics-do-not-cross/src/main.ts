// expect: emit-c --napi -> calls typeof exports.Holder.make === "undefined" && exports.Holder.LIMIT === undefined
// control: typeof exports.Holder === "function" && new exports.Holder(7).get() === 7
//
// A class crosses with its constructor and its prototype methods, and with
// nothing else -- not its instance fields, and not its statics.
//
// `napi_define_class` is emitted and the descriptor list holds the prototype
// methods only:
//
//     napi_property_descriptor members[] = {
//         { "get", NULL, nts_napi_Holder__get, ... }
//     };
//
// So on the host:
//
//     new Holder(7).get()   7            the constructor and the method work
//     Holder.make           undefined    a static method
//     Holder.LIMIT          undefined    a static field
//     Holder.make(7)        TypeError: H.make is not a function
//
// # Two entries, one descriptor list, and they are not the same entry
//
// This is filed apart from `class-fields-do-not-cross` because the Node-API
// mechanism differs: a static is a descriptor carrying `napi_static`, an
// instance field is not. Whether one change adds both is the compiler lane's
// question; the evidence is separate and so is the fixture.
//
// The control is the same shape and for the same reason: every expression about
// an absent name is `undefined`, so `Holder.make === undefined` is equally
// satisfied by a class that never compiled. `new Holder(7).get() === 7` says
// the constructor ran, the prototype is there, and the field was populated --
// the field being unreadable from outside is the neighbouring fixture's
// business.
//
// # What it costs
//
// `Buffer.from` is a static method, and it is the name in **19 of the 54**
// `buffer` files that pass interpreted and fail compiled. `Buffer.alloc`,
// `Buffer.isBuffer` and `Buffer.concat` are the same kind. A `Buffer` whose
// constructor crosses and whose statics do not is a `Buffer` node's tests
// cannot make one of.
//
// `path.parse`, `os.constants` and the rest reach the host as plain functions
// and values, so this wall is specific to the modules whose public surface is a
// class: `buffer`, `stream`, `url`, `string_decoder`.

export class Holder {
  value: number;
  static readonly LIMIT: number = 42;

  constructor(value: number) {
    this.value = value;
  }

  /** Under test: a static method. */
  static make(value: number): Holder {
    return new Holder(value);
  }

  /** Control: an ordinary prototype method, which does cross. */
  get(): number {
    return this.value;
  }
}
