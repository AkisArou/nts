# A second spelling of a character

`encodeURI`, `encodeURIComponent`, `decodeURI` and `decodeURIComponent` are a
pair of pairs. The members of each differ only in a character set, so they are
one lowering with two flags — four entry points would be four copies of the
`URIError` half, which is the part with the edges in it.

    encodeURI("a/b?c=d")           "a/b?c=d"        the separators are structure
    encodeURIComponent("a/b?c=d")  "a%2Fb%3Fc%3Dd"
    decodeURI("%2F")               "%2F"            and stay structure coming back
    decodeURIComponent("%2F")      "/"

`decodeURI` leaving a reserved character escaped is not a nicety. It exists to
leave a URI's structure intact, so decoding its separators would change what the
string means.

## Why `nts_string_from_utf8` could not be reused

Both directions are specified to **throw** on input the other direction could
not have produced, and a best effort is wrong rather than approximate.
`nts_string_from_utf8` substitutes `U+FFFD` for malformed bytes — correct for
reading a file, and exactly what `decodeURIComponent` must not do.

    decodeURIComponent("%GG")        a truncated or non-hex escape
    decodeURIComponent("%C0%80")     an overlong encoding of NUL
    decodeURIComponent("%ED%A0%80")  a surrogate, which UTF-8 excludes
    decodeURIComponent("%F4%90%80%80")  past U+10FFFF
    encodeURIComponent("\uD800")     half a character, with no UTF-8 for it

**The overlong case is the one worth not being relaxed about.** `%C0%80` decodes
to `U+0000` under a permissive reader, and the specification rejects it, because
an overlong encoding is a *second spelling of a character* — which is how a
check on the decoded text gets bypassed. A filter that rejects `../` sees
nothing in `%C0%AE%C0%AE/`. That is a security property and not a conformance
detail, and it is the reason the decoder validates rather than converts.

## Where the throw lives

A runtime function in this compiler **cannot throw**. So the C answers `NULL`
and the lowering emits the `URIError` — the same split `String.prototype.repeat`
makes for its `RangeError`, and the reason these are two halves rather than one
function.

The `NULL` is tested at the call rather than left to the caller: every use of
the result reads a length or a unit through it, so an untested `NULL` is a load
from address zero rather than the error the language specifies.

## The flag is a `double`

Because that is the argument shape the backends already carry —
`nts_parse_int(s, radix)` is the same pair — and a second convention for a flag
would be a signature table entry to get wrong in two backends. Which it would
have been: the table is binary-searched and must be sorted, and both new entries
went in at the wrong offset first, twice in one evening. A test caught it both
times, which is the test being worth more than the convention it enforces.

## What it closed

`blockers/missing-builtin` is deleted; its whole subject was
`decodeURIComponent`, which gates `querystring.parse`, which is where six of
that module's seven failing test files stop. `examples/uri-encoding` replaces
it: seven functions over eighteen inputs, including a content hash rather than a
length, because a length alone agreed with node on a draft that had the
surrogate halves the wrong way round.

## The test that has to keep moving

`a_library_global_is_still_reported_as_a_builtin` asserts that a `lib.d.ts`
global this compiler has not implemented says so, and it needs a name that is
genuinely absent. It was `parseFloat` until that landed, then
`decodeURIComponent` for about an hour, which is how long that one took.

It is `escape` now, and the choice is the point: `escape` is deprecated in Annex
B, `encodeURIComponent` is what anything in this tree would call instead, and
nothing in the node profile reaches it. It is absent because nobody wants it
rather than because nobody has got to it — which is the property the test
actually needs, and which neither of its predecessors had.
