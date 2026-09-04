# 0050 — A node builtin that compiles

`runtime/node/path` is 1681 lines of ordinary TypeScript across four files —
string work, no syscalls — which is what made it the first node builtin that
could plausibly compile whole. It does now: all eighteen public functions,
`resolve` `normalize` `join` `relative` `basename` `dirname` `extname`
`isAbsolute` `format` and `toNamespacedPath`, for both `posix` and `win32`,
and forty-eight functions in total.

It took five things, and none of them was about `path`.

## What it named

Asking `path` to compile listed seven root refusals. Closing two closed five,
because most of a compiler's diagnostics are cascades:

    posix.ts:112, posix.ts:370, win32.ts:101, win32.ts:261
        a declaration without an initializer
    internal.ts:110, win32.ts:80
        indexing a string, which is not an array
    win32.ts:415
        an empty array of unrepresentable type

`let path: string;` and `s[i]` are 0044. `isPosixPathSeparator` — declared in
two modules, passed as a value, and vanishing from the output with no
diagnostic while its callers were refused for calling something refused — is
0046, and was a null vtable and a segfault rather than a missing feature.

## The evolving types

Two of the last three were the same thing wearing different clothes.

    const path = [];        // win32.ts:415
    let device;             // win32.ts:261

TypeScript calls these *evolving*. `const path = []` has type `never[]` where it
is written: with no elements and no annotation the checker has nothing to infer
from **yet**, and it fills that in from the pushes as it walks. `let device;` is
the same thing without a literal.

So the type at the declaration is the one that says nothing, and this lowering
was asking exactly that node. Every *later* mention of the name carries what it
evolved to, and the checker has already done the work and already agreed with
itself about the answer — so `evolved_type` reads one back rather than
repeating the inference. Repeating it would be a second answer to a question
that has one, and the two would agree until they did not.

Every use has to agree, and it declines where they do not: a use before the
first assignment sees a narrower type than one after it, and taking whichever
came first in the node list would be taking one arbitrarily.

That refusal was 105 sites across the whole node profile — the seventh most
common in it, behind classes-as-values, missing globals and three shapes of
unrepresentable parameter.

## And one that had been hiding

With those closed, a refusal that had been behind them appeared:

    win32.ts:376  a string method with this many arguments

`path.indexOf(':', index + 1)` — a scan that *resumes*. `nts_str_find` has taken
a start position since it existed and `indexOf` passed zero; the two-argument
form is the same call with the argument the caller wrote. Four lines.

Worth noting as a shape rather than as a fix: a refusal cascade hides the
refusals behind it, so "two left" was never two. It was two, and then whatever
they were standing in front of.

## What is next for it

Compiling is not running. `path` emits, and the next question is whether it
*agrees with node* — which needs the module driven from a differential the way
`examples/*` are, and that is a harness rather than a compiler feature.
