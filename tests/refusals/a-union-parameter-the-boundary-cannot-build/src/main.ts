// expect: emit-c --napi -> no wrapper for takesNumberOrObject: takes or returns a union that erases and whose members the boundary cannot build, so no argument would satisfy it
// control: exports.takesNumber(1) === "number"
//
// A parameter typed as a union whose members erase. The wrapper declines the
// export outright -- this is the **parameter** half of a mechanism already filed
// on its return side as `a-promise-returned-across-the-wrapper`, which carries
// the identical message.
//
// # The two halves are one mechanism, and that took a day to see
//
//   dns.promises   promiseLookup returns Promise<LookupAddress | LookupAddress[]>
//                  -> takes or returns a union that erases
//   tty            isatty needs a parameter accepting a number and an object
//                  -> takes or returns a union that erases
//
// They were written up as separate findings hours apart. One probe with four
// signatures in a single addon put them together, and the joint case is worth
// more than either: the return side is every `promises` namespace node
// publishes, and the parameter side is `tty`'s compiled lane.
//
// # What was measured beside it, and is not a union
//
// The probe tried four parameter types. Only the union ones give this message:
//
//   unknown                   PUBLISHES, and throws at runtime on a reference
//   number | object           this fixture
//   object | undefined        the same message -- optionality is a union
//   Record<string, unknown>   a different one: crosses outward only
//
// `unknown` is the one that stings, because it publishes and then fails where no
// `emit-c` output mentions it. That half is a labelled diagnosis in
// `docs/conformance/nodejs.md` rather than a fixture here, for the reason this
// directory keys on refusals: a `publishes` guard beside a runtime throw reads
// "guard ok" and asserts nothing about the throw. I wrote one, watched it do
// exactly that, and deleted it.
//
// # Why `takesNumber` is the control
//
// So the fixture cannot go green by the export vanishing. The scalar twin has to
// keep publishing and answering; if both stop, something broke that is not this.

export function takesNumber(value: number): string {
  return typeof value;
}

export function takesNumberOrObject(value: number | object): string {
  return typeof value;
}
