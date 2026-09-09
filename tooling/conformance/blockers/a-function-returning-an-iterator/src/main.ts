// expect: a function returning `IterableIterator`
//
// A declared return type of `IterableIterator<number>`, with no generator
// anywhere. 18 distinct named things across `fs` and `stream`, and the types
// behind them are one family:
//
//     IterableIterator       12      AsyncGenerator      5
//     AsyncIterableIterator   8      AsyncIterator       4
//     AsyncIterable           7      Iterable            3
//
// Reduced from `fs/src/async.ts:213`, an overload signature ending
// `): AsyncIterableIterator<string | Dirent>;`. Overloading turned out not to
// matter -- a single plain declaration refuses identically -- so the fixture
// does not carry one.
//
// # One type, three messages, by where it appears
//
// The same `IterableIterator<number>` refuses differently depending on
// position, which is worth having written down somewhere a person will read:
//
//     as a return type      a function returning `IterableIterator`
//     as a parameter        a parameter of unrepresentable type (`IterableIterator`)
//     as a property         a property of unrepresentable type (`IterableIterator`)
//
// So a census that groups by message splits this one cause across three rows
// and ranks each a third as urgent as it is. The mirror of the more familiar
// hazard where one message covers several causes, and it is the reason the
// census output says it ranks texts.
//
// It is not "returning a reference": returning `number[]` compiles.
//
// # About the body, which is also refused
//
// `[1, 2].values()` is itself unsupported -- on its own it reports
// `this array method`. In this file the return-type refusal is reported first
// and alone, so the expectation is unambiguous today. But **when the return
// type is fixed, this fixture will start reporting the body's refusal instead**,
// the expectation will stop matching, and the run will say so rather than pass
// quietly. That is the right failure: it asks for a person exactly when the
// thing it guards has moved.
//
// There is no way to avoid it. Every way of obtaining an `IterableIterator`
// value is refused for its own reason, because the type has no representation
// -- which is the defect. A fixture whose body dodged that would not be
// reducing this.

export function iteratorOverTwoNumbers(): IterableIterator<number> {
  return [1, 2].values();
}
