# 0044 — What a profile named, and an answer a backend had wrong

`runtime/node/path` is 1681 lines of ordinary TypeScript — string work, no
syscalls — which makes it the first node builtin that could plausibly compile
whole. Asking it to found seven root refusals. Closing two of them closed five,
and one of the two exposed a backend that had been answering a question wrong
since it had strings.

## What the profile said

Seven refusals in `path` itself, and four were the same one:

    posix.ts:112   a declaration without an initializer
    posix.ts:370   a declaration without an initializer
    win32.ts:101   a declaration without an initializer
    win32.ts:261   a declaration without an initializer
    internal.ts:110  indexing a string, which is not an array
    win32.ts:80      indexing a string, which is not an array
    win32.ts:415     an empty array of unrepresentable type

Across all of `runtime/node` the first is 105 sites — the seventh most common
root refusal in the whole profile, behind classes-as-values, missing globals and
three shapes of unrepresentable parameter.

## A name with nothing in it yet

`let path: string;` and then a branch that writes it. It is how a value decided
by *statements* rather than by an expression gets written, and it was refused
outright.

The whole of the feature is having something to bind. Every block below the
declaration reads the name as a carried name, a merge takes it as a parameter,
and a name with no binding is not one — so once it has a value, the machinery
that already handles `let x = 0; if (c) x = 1;` handles this too, unchanged.

What the value is depends on whether it can be seen. Where the type admits no
absence the checker has already proved the assignment comes first: `let path:
string;` read before it is written is "used before being assigned", and such a
program never reaches lowering. Where the type *does* admit one it is very much
observable — `let joined: string | undefined;` is read before it is written,
because that is the point of writing it — and there the placeholder is the
answer node gives. One absence on a reference is the null pointer, so
`ConstNull` *is* that `undefined` rather than standing in for it; a scalar union
is erased, where it is spelled out.

`let device;` — no annotation either — is still refused. That is TypeScript's
evolving `any`, and it is a different question.

## `s[i]` is not `s.charAt(i)`

The difference is out of range: `charAt` answers `""`, and `s[i]` answers
`undefined`. TypeScript types both `string`.

That is the same claim it makes about `xs[i]`, where the bounds test is what
checks it and an index outside the array stops the program. So `nts_str_at`
keeps the same bargain rather than inventing a third answer, and `charAt` is
still spelled `charAt` for the code that wants the empty string.

Decided from the checker's type rather than by lowering the receiver and looking
at it, because the array path lowers it again — and a receiver with a side
effect would then have had it twice.

## The answer the LLVM backend had wrong

Adding `s[i]` to `examples/strings` made an example compare a computed string
against a literal, and the LLVM backend disagreed with node. The IR says why:

    %v9 = icmp eq ptr %v7, %v8

Two strings are equal when their *contents* are. `icmp eq` compares the pointers
they arrive in, so `ext.charAt(0) === "."` was false however the string read.

It was not `s[i]` that broke it. `charAt` emits the same IR and always did, and
the C backend has called `nts_string_eq` here since it had strings — this was
half a rule, missing for as long as the backend has existed. Nothing caught it
because the examples compared literals against literals, where two equal strings
genuinely are one pointer and a pointer test accidentally agrees.

**The order matters, and the C backend says so in a comment.** A comparison
against the absent reference is a comparison of addresses whatever the other
side is, and it has to come before the string rule: `s === null` is a question
about the pointer, and answering it by reading through the pointer reads through
the null one. The arm shipped without that guard for one build and
`examples/optional-access` crashed fifteen times.

With both halves, the LLVM backend agrees on two more examples than it did.
The floor rises from 74 to 76.

## Still open

`path` is down to two root refusals: `let device;` with no annotation, and an
empty array whose element type is itself an array.

And a third thing, which is neither. `isPosixPathSeparator` is defined in
`posix.ts` and again in `win32.ts`; neither reaches the emitted C, and no
diagnostic says why, while every caller is correctly refused for calling
something that was refused. `isPathSeparator`, defined only in `win32.ts`,
emits fine. Two declarations of one name in different modules are supposed to be
qualified apart — `resolve@win32` and `format@internal` are in the same output —
so this is a hole in that, and it is what stands between `posix.resolve` and
compiling.
