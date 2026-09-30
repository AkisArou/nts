// A generic rest parameter collected into a tuple, **stored in a field typed at
// the tuple**, then read back and spread into the callback it was gathered for.
// That is `setImmediate`'s shape in `runtime/node/timers`:
//
//     function setImmediate<A extends unknown[]>(
//       callback: (...args: A) => void, ...args: A): Immediate<A> {
//       return new Immediate(callback, args);
//     }
//
// **`mixed` is FIXED and is now a guard**, and what is left is `uniform` alone.
// The two arms turned out to be two mechanisms wearing one shape, which is why
// the fix moved one and not the other:
//
//   mixed     the tuple's positions have different storage widths, so it
//             represents as a **struct** -- and the gather built an array while
//             the field declared the struct. One type id, two representations.
//             Fixed: a fixed-arity rest takes its own type's representation, and
//             one resolver answers "which field is position N" for the builder
//             and the reader. `examples/a-rest-tuple-of-mixed-widths-stored-and-
//             spread` is the guard, agreeing with node on c, llvm, jvm and rc.
//   uniform   every position is the same width, so it represents as an **array**
//             -- and the two ends agree, which is why nothing was invalid. What
//             is missing is the **arity**, which an array representation does not
//             carry. Still a silent wrong answer.
//
// **`uniform` is a silent wrong answer on C and the JVM.** Node answers `3`; the
// compiled program answered `2` at `a6b5f0445`, a garbage float string after the
// record-layout work, and a garbage float string now -- all wrong, and the later
// ones louder. Nothing refuses and the verifier sees nothing.
//
// **Control, and it is the half that matters:** `notStored` gathers the same
// uniform rest and spreads it *without* storing it in a field. It agrees. One
// difference -- the round trip through a field typed at the tuple -- and the
// answer goes wrong, which is what says the defect is the store-and-read rather
// than the gathering or the spread.
//
// # Where it is, read out of the emitted C
//
// **The spread is not expanded: the array is passed whole as argument one.**
// `this.fn(...this.args)` compiles to
//
//     v5 = nts_array_concat(v3, v4);                    // the args array
//     v6 = nts_value_of_reference((NtsHeader *)v5, NTS_TAG_OBJECT);
//     v7 = nts_value_of_undefined();
//     ((NtsValue (*)(Fn24__7 *, NtsValue, NtsValue))
//        v1->header.descriptor->methods[1])(v1, v6, v7);
//
// so the callee -- `Closure0__call(Closure0 *, double, double)` reached through the
// uniform entry -- unerases argument one to a `double` and gets **a pointer
// reinterpreted as a float**. That is where `6.9…e-310` comes from, and why it
// differs per run: it is the array's address. Argument two is the padding
// `undefined`.
//
// The gather is not at fault. `hold` allocates `double[2]`, converts both
// arguments and stores them at slots 0 and 1, correctly. Only the *spread* is
// wrong, which is what the `notStored` control already said and this confirms in
// the emitted code.
//
// **A spread of a dynamically sized array into a fixed-arity call cannot be
// expanded at all**, and that is the real shape of the gap: the uniform entry takes
// a fixed number of arguments, so a spread is expandable only where the length is
// statically known. For a **tuple** it is -- `[number, number]` is two -- so the
// fix is to expand a tuple-typed spread into that many element reads, and to refuse
// where the length is not known rather than hand the container over as one
// argument. That paragraph was written when `mixed` refused rather than answered,
// and the refusal was the *reader* half of the same missing agreement; both ends
// are fixed now and only the arity question above is left.
//
// # Where `uniform` is, measured 2026-09-30
//
// **The class keeps its type parameter.** Reduced to fourteen lines, the emitted
// HIR is
//
//     func Held<19>#run(this: managed<obj#19>) -> void
//       %1 = field.get %0.0 : managed<obj#25>
//       %3 = array.new 0 : managed<[f64]>
//       %4 = field.get %0.1 : managed<[f64]>
//       %5 = call.extern nts_array_concat(%3, %4) : managed<[f64]>
//       %6 = erase %5 : erased
//       %8 = call.closure[1] %1(%1, %6, %7) : erased
//
// `Held<19>` names the *declaration's* type parameter, while `hold<[f64]x2>`
// beside it in the same program was specialised and expanded its rest into two
// positional parameters correctly. So the function was specialised and the class
// was not, and inside `run` the spread falls into the **rest-gathering** branch --
// which fires before the expansion branch -- builds a fresh array, and hands the
// callee one erased array where its uniform entry wants two values. The callee
// unerases argument one to a `double` and gets the array's address, which is where
// the differing-per-run float comes from. The JVM lane's `Immediate$11334$` is the
// same unsubstituted class, and it reaches seven modules through `setImmediate`.
//
// **Two things read out of the source that say why, and a third that is still a
// question.** `generics::instantiations` skips an argument that is still a type
// parameter -- its own comment: *"a use inside another generic … and not an
// instantiation this can emit a copy for"* -- and `new Held(args)` sits inside
// generic `hold`, so `Held<A>` is exactly that and the class gets no copy at all.
// And `class_copies` gives a class instantiation `Sources::default()` where a
// function copy gets `copy.sources.clone()` -- `Sources` being the map that exists
// *because* an array representation loses a tuple's arity, so its emptiness for a
// class is the loss this arm records.
//
// **And the question that was open here is answered, by reading one function.**
// `after_substitution` is what recovers a type id from a representation:
//
//     fn after_substitution(&self, ty: TypeId) -> TypeId {
//         match self.represent(ty) {
//             Some(HirType::Managed(ManagedType::Object(substituted))) => substituted,
//             _ => ty,
//         }
//     }
//
// It can only do that for the **one representation that keeps an id**. A tuple of
// mixed widths represents as `Object(16)`, so `A` resolves and the expansion fires;
// a uniform tuple represents as `Array(f64)`, which carries no id, so `A` stays the
// bare type parameter and there are no positions to expand. That is the same
// sentence as "an array representation does not carry the arity", one level down
// and in the function that would have to answer it.
//
// So the fix is `Sources`, the map built for exactly this -- *"the types whose
// representation loses something the copy's identity needs … today that is a
// tuple, whose arity an array representation does not carry"* -- and the two
// reasons it is empty here are both in `class_copies`: a class instantiation is
// given `Sources::default()` where a function copy gets the real one, and this
// class has no instantiation at all because `generics::instantiations` skips an
// argument that is still a type parameter and `new Held(args)` inside generic
// `hold` is exactly that. Composing the enclosing copy's substitution is what
// would make `Held<A>` into `Held<[f64, f64]>` and give it sources to carry.
//
// **Expected, confirmed under node:** `3 ok`, `s1 ok`, `3 ok`.

class Held<A extends unknown[]> {
  readonly fn: (...args: A) => void;
  readonly args: A;
  constructor(fn: (...args: A) => void, args: A) {
    this.fn = fn;
    this.args = args;
  }
  run(): void {
    this.fn(...this.args);
  }
}

function hold<A extends unknown[]>(
  fn: (...args: A) => void,
  ...args: A
): Held<A> {
  return new Held(fn, args);
}

function spreadStraightAway<A extends unknown[]>(
  fn: (...args: A) => void,
  ...args: A
): void {
  fn(...args);
}

let seen = "";

seen = "";
hold((a: number, b: number) => {
  seen = `${a + b}`;
}, 1, 2).run();
observe("uniform", seen === "3" ? "3 ok" : "not 3");

seen = "";
hold((s: string, n: number) => {
  seen = `${s}${n}`;
}, "s", 1).run();
observe("mixed", seen === "s1" ? "s1 ok" : "not s1");

seen = "";
spreadStraightAway((a: number, b: number) => {
  seen = `${a + b}`;
}, 1, 2);
observe("notStored", seen === "3" ? "3 ok" : "not 3");

done();
