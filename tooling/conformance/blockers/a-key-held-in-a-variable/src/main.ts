// expect: indexing `Options`, which is not an array
//
// **The single-literal half was fixed 2026-09-10; the union half remains, and
// the message is true now.** See the corrected table below.
//
// A computed member read whose key is a **variable**, where the interface
// declares that key. The message says the type does not declare it, and the
// type does.
//
// # What it is standing in front of
//
//     stream/src/state.ts:64   options[duplexKey]
//         getHighWaterMark                      refused here
//         ReadableState#constructor             cannot be compiled, it calls getHighWaterMark
//         Readable#constructor                  cannot be compiled, it calls ReadableState
//         Readable                              no wrapper: a class whose constructor was not compiled
//
// Against the compiled `stream` addon: 249 failing test files, **59 of them
// stopping at `Readable is not a constructor`** -- the second largest
// concentration in the tree after `http.createServer`. `WritableState` cascades
// off the same function, so `Writable` goes with it.
//
// `duplexKey` is declared
// `"readableHighWaterMark" | "writableHighWaterMark"`, and
// `HighWaterMarkOptions` declares both of those keys as optional numbers. There
// is nothing undeclared anywhere in it.
//
// # Three controls, and the second was the surprise
//
//     options[key]  key: "a" | "b"     refuses     <- all that is left
//     options[key]  key: "a"           compiles    <- fixed 2026-09-10
//     options["a"]  written in source  compiles
//
// The second row said the condition was "held in a variable at all", and it was
// not: it was that the name came from the node's **text** rather than its
// **type**. `literal_name` answers for any node carrying text and an identifier
// carries its own, so `options[key]` looked for a member called `key` — and
// said so, of a type that declares nothing of the sort. A reader following that
// message went looking for a missing member and found the member.
//
// `indexed_member_name` asks the checker instead: the type of `key` is
// `Literal(String("readableHighWaterMark"))`, which is one name and the right
// one. Only in an index position — a *shorthand* property `{ a }` is an
// identifier whose text **is** the name while its type is whatever `a` holds,
// so consulting the type there would be the same mistake pointing the other
// way. `examples/a-computed-index-is-not-a-member-name` is the guard.
//
// # What is left is genuinely two members
//
// `key: "a" | "b"` names two, and the compiler would have to branch on which
// arrived. That is a real gap and the message says so now — "indexing
// `Options`, which is not an array" — rather than naming a variable.
//
// `getHighWaterMark` lowers, and so do `ReadableState#constructor` and
// `Readable#constructor`. **`Readable` still does not publish**, and the reason
// moved: it is now `EventEmitter#emit`, which the backend refuses because
// `callback.call(this, ...args)` rebinds a closure's receiver. That gates
// `http.createServer`'s 274 files too, so the two largest concentrations in the
// tree are one construct apart.
//
// # It is not `annotated-const-read`
//
// That fixture reads `code` off an `Error`-typed parameter, and `Error` really
// does not declare `code` -- the message there is true and the defect is that
// the value's own type is narrower than the annotation. Here the declared type
// has the member. Same message, opposite fact, and the census groups them
// together because it groups by text.

interface Options {
  readableHighWaterMark?: number;
  writableHighWaterMark?: number;
}

export function readMark(
  options: Options,
  key: "readableHighWaterMark" | "writableHighWaterMark",
): number {
  return options[key] ?? 0;
}
