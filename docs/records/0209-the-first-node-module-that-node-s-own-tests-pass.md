# The first node module that node's own tests pass

    node:punycode against node's own tests — target/node/punycode.node

      pass  test-punycode.js
      pass  local/error-identity-static.js

      2 file(s): 2 passed, 0 failed, 0 skipped, 0 not applicable

This axis has reported zero for its whole existence: 22 modules, 15 that do not
compile, 4 that build and export nothing, 2 partial, 1 that passes degenerately.
`punycode` is the first row that is not one of those.

It is worth writing down what the last day of it actually consisted of, because
none of the seven things in the way was a language feature and six of them were
found by *running the artifact* rather than by reading a diagnostic.

## The seven

**A `f64[]` parameter and a `f64[]` return.** `ucs2.decode` takes a string and
returns `number[]`; `ucs2.encode` takes one. Both lower with nothing refused —
`nts hir` says the module is clean — and the wrapper had no case for them, so
the usual instrument was silent about the only thing stopping the module. The
crossing is a copy in both directions, which is the same answer `ArrayBuffer`
gets and for the same reason: a handle would mean deciding who owns the storage
afterwards, and that question is worth answering once rather than per type.

**`NTS_ELEMENTS` against `NTS_ITEMS`.** The first version of the inbound
marshal wrote three doubles over the array's own header, because an array's
storage is behind its `elements` pointer and only a *string* keeps its data
inline after the header. The symptom was `[3e-323, 6.9e-310, 0, 109, 97, 241]`
where node says `[109, 97, 241, 97, 110, 97]` — the length and a pointer read as
doubles, then the real data three slots late.

**A `bool` where a `napi_status` was expected.** `nts_napi_expect` takes a
status and `true` is `1`, which is `napi_invalid_arg`. Every array was reported
as the wrong type, by a call site that reads correctly in isolation.

**A namespace member is not published under a name of its own.** `wrapped` was
appended per published *name*, so a function that exists only as `ucs2.decode`
had a wrapper in the file and was reported as having none.

**A `RangeError` the runtime could not build.** `String.fromCodePoint(NaN)`
printed the value and called `abort()`. The reasoning in the comment was sound
as far as it went — a `RangeError` is laid out by the program, its descriptor
lives in the generated file, the runtime has nothing to allocate — and the
conclusion did not follow, because `"x".repeat(-1)` has thrown a real one for
months by putting the check in the *lowering*. See `hir::lower::guard_code_point`
and `examples/code-points`. Until then `punycode.ucs2.encode([NaN])` took the
process down, so the module could not be *tested* rather than failing one
assertion.

**An `Error` wearing the right name.** The Node-API boundary built a generic
error and assigned `.name`, so `thrown instanceof RangeError` was false while
`thrown.name`, `thrown.message` and `String(thrown)` were all right. Node's own
suite cannot see this: it asserts `/^RangeError: Invalid input$/`, which is built
from `name` and `message`. Fifty-two of node's 1,890 test files in this profile
assert a constructor or `instanceof` at all, and `punycode` has none — not a
flaw in node's tests, but what an oracle looks like when the invariant it would
be testing cannot fail in the implementation it was written against. The Node
lane wrote the file that does assert it, this morning, from a document that said
"no pinned assertion touches it".

**A deprecation warning on stderr instead of on `process`.**
`common.expectWarning('DeprecationWarning', …, 'DEP0040')` needs a real process
event. A standalone binary has no `process` to emit on, which is what the stderr
path was written for; an addon is running *inside* node, which is what it was
not. Twenty-one characters in `NAPI_MODULE_INIT`, before `module__init()`
because that is where the top-level `emitWarning` runs.

## What "pass" is not

`version` still does not publish — a string constant, which this backend can
only name as a function. Node's test never touches it, so the row is annotated
`incomplete: version absent` rather than left to imply a whole module.

The pass is node's own file plus one written here. Both are real and neither is
the whole surface. What makes the row mean something anyway is the other two
measurements taken beside it: keeping the export names and destroying the
behaviour fails both files, and 80,128 comparisons over 20,000 generated inputs
find zero divergences from node.

## The method, which is the transferable part

Every one of the seven was found by building the artifact and running it. The
diagnostic count said `punycode` was clean for hours while two of the seven were
live. A refusal count is bounded on both sides and equal to neither — it
understates because only the first refusal in a function is reported, and it
overstates because a function refused for constructing something already refused
gets a root's number. Neither bound tells you whether the module *works*.

What survived all of that was the ranking by exports gated, because it walks the
cascade explicitly, and the sweep by test outcome, because it runs the thing.
