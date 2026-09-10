# The boundary was standing in, and using its own words

    path.normalize(null)
      node  The "path" argument must be of type string. Received null
      here  expected a string argument

The Node lane's differential reported **160,336 divergences on `path`, all
error shape**, and placed the fault precisely by comparing three ways: the
interpreted lane is node's message character for character, and the compiled
artifact from the same source produces something else. So the TypeScript is
right and the boundary is wrong.

## Why the boundary speaks at all

A rest parameter declared `string[]` folds `typeof x !== "string"` to false
before the body sees it, and a scalar parameter's conversion fails before
`validateString` runs. So the module's own validator cannot fire, and the napi
wrapper stands in for a guard the declaration deleted. That trade is deliberate
and its comment says so.

What it has to do, then, is stand in with node's words.

## Three faults, and only two were the message

**A string and a boolean parameter never reached the good message.** The number
arm had said node's since `nts_napi_argument_type_error` was written; the other
two still said `expected a string argument`, which names neither the parameter
nor what arrived and is not a sentence node produces. Four of `path`'s six
single-argument entry points answered it.

**`Received type null` is not a spelling node has.** Node builds that tail with
`determineSpecificType`, which answers `null` and `undefined` bare and
everything else as `type <t>` — because `typeof null` is `"object"` and node
never reaches the `typeof` arm for it. Returning the whole tail rather than a
type name puts the rule in one place.

**And the value is part of the tail.** `type number (42)`, `type number (-0)`,
`type bigint (10n)`, `type symbol (Symbol(s))`, `an instance of Foo`,
`function ` with its trailing space. The previous comment declined to render the
value on the grounds that it is `util.inspect`'s job and a wrong rendering is
worse than an absent one — true of an arbitrary object and false of a primitive,
where `napi_coerce_to_string` *is* the engine's own spelling. `-0` is the single
exception, since `String(-0)` is `"0"` and the message exists to draw exactly
that distinction.

    same 78, diff 26     across 8 path entry points and 13 argument values

from almost none. Every one of the 26 is `join`'s parameter name: node validates
each element as `"path"` and this names the rest parameter and its index. Node's
`resolve` says `paths[0]` and **matches exactly**, so the convention is per
function in node's own source and a boundary cannot know which.

## The invariant that caught the first attempt

`strings_cross_as_utf16` asserts the UTF-8 string reader appears nowhere: a
JavaScript string is UTF-16 and the UTF-8 read replaces a lone surrogate. The
diagnostic used it, and a message is not program data, so the exemption was
arguable.

It was not taken. **An invariant with one exemption is an invariant nobody can
check**, and the diagnostic now reads UTF-16 like everything else, mapping above
127 to `?` — a constructor's name is an identifier and a coerced number is
ASCII, so only a symbol's description can lose anything, in an error message.

The test also failed on the *comment* explaining the choice, because the comment
is inside the emitted C. That is the assertion doing its job on a string it was
not aimed at, and the sentence is phrased around it now.

## What it does not fix

Nothing about `module#init`, and nothing about the argument name. Both are
recorded rather than guessed at: 0272 has the first, and the second needs the
module's own guard to survive the boundary, which is the "a root is a wall"
question one domain over — reachability keeps an exported function's parameters
wide, and this would be keeping its *type facts* untrusted too.
