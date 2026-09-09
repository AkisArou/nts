# A name that publishes and cannot be called

The erased crossing bought nine new published names. Six answer exactly what
node answers. Three publish and throw for every argument.

    buffer.isUtf8(new Uint8Array([97, 98]))   THREW   node: true
    buffer.isAscii(new Uint8Array([97]))      THREW   node: true

`isUtf8` is declared `(input: Uint8Array | ArrayBuffer)`. That union erases, so
the parameter is `HirType::Erased`, so the wrapper took it -- and then the
inbound crossing has no representation for a typed array, so **every argument
node can offer throws.**

Before the crossing, `typeof buffer.isUtf8` was `"undefined"`. After it, it is
`"function"` and every call fails. **A presence check that used to fail now
passes, and only a call finds out.** That is the wrong-answer shape one level
out from the one the crossing was careful about: `{}` inbound raises a loud
`TypeError` rather than answering `undefined`, and the loudness arrives one call
too late to stop the name being published.

## `Erased` is at least three things

    unknown                  the caller may pass anything, the body decides
    boolean | undefined      every optional scalar; every member crosses
    Uint8Array | ArrayBuffer two specific types, neither of which crosses

The wrapper sees one type for all three. The declaration is the only place that
still knows which, and `hir::lower::public_api` is the only pass holding both
the lowered representation and the checker's type for the same slot -- so that
is where the question is asked, and the answer travels on
`Program::opaque_signatures`.

## The first rule was wrong and a working export said so

Version one asked "is the declared type `unknown` or `any`?" and declined
everything else. It declined `stream.getDefaultHighWaterMark(objectMode?: boolean)`,
which had been answering `65536` and `16` correctly -- an optional scalar erases
too, and **every member of `boolean | undefined` crosses**.

So the question is not what the type *is*. It is whether any member of the union
is something the crossing cannot build. A union with no members at all is
`unknown`, which is why that case needs no special arm.

    buffer      5 published -> 3     isUtf8, isAscii declined by name
    stream      1 -> 1               getDefaultHighWaterMark keeps working
    timers      3 -> 2               clearImmediate declined: `Immediate | undefined`
    path       15 -> 15              toNamespacedPath is `unknown` and crosses

## What stays best-effort, stated rather than hidden

`async_hooks.executionAsyncResource(): unknown` returns an object. The
declaration says `unknown`, which is exactly the case that must be carried, and
only the *value* is unrepresentable. No signature check can see that.

An outbound `unknown` is therefore best-effort by construction: it carries five
primitive tags and throws for a reference that is not a string. The alternative
is refusing every outbound `unknown`, which would take `toNamespacedPath` --
the function the crossing was built for -- with it.

## The control that named it

Not the gate, not the fixtures, not 667 differential cases. The Node lane called
all nine names with real arguments and reported which threw. `typeof` cannot see
this, and a scalar argument cannot either: `isUtf8("")` reaches the module's own
validation and answers node's error exactly. The assertion has to name an
argument of the type the signature asks for.

`os` is where that check passes -- 15 published functions, 0 uncallable -- and
that is what says the check can pass rather than being a way of finding fault.

## And the members a namespace could not carry

The same commit gives a namespace its **value** members. `export const sep = "/"`
is a global rather than a function, and a namespace built only out of wrappers
had neither `sep` nor `delimiter` -- the one place `posix` and `win32` differ in
a way callers depend on.

    posix.sep       "/"    win32.sep       "\\"
    posix.delimiter ":"    win32.delimiter ";"

Four of four agree with node, and thirteen members each rather than eleven.

**The check is `path.win32.sep`, not `path.posix.sep`**, and that is the Node
lane's observation rather than mine. `shape.mjs` builds `posix` from the flat
exports, which carry the top-level `sep`, so `posix.sep` was already right *by
construction* and would have passed against a feature that did nothing. Only
`win32` is built from the namespace object.

A test that passes for a reason unrelated to the thing it names is the same
failure as an expectation that is a substring of the wrong output, and I would
have written it.

The globals also need declaring. `path.sep` and `path.posix.sep` are one global
under two names, so the extern is written once and skipped when the top-level
value exports already wrote it -- a second one is a redefinition rather than a
duplicate. `path.win32.sep` is a *different* global, and without its extern the
addon reports `use of undeclared identifier 'sep17'`, which is how this was
found rather than reasoned about.
