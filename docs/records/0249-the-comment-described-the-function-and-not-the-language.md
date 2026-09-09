# The comment described the function, and not the language

    { b: 1, 2: 2, a: 3, 1: 4 }

    node      1, 2, b, a
    compiled  b, 2, a, 1

JavaScript's own-property order is not insertion order. Every key that is an
**array index** comes first, ascending, and the rest follow in insertion order.
`nts_map_keys_str` walked the table once and wrote each key as it came.

Its comment said:

> `Object.keys(table)`, as the array of keys in insertion order.

**That is an accurate description of the function.** What it does not say is that
the language's order is something else, and there was no note weighing the
promotion and setting it aside — so the rule looks never to have been in view
rather than considered and declined.

That is a different failure from a wrong implementation, and given how much of
this compiler is documented well enough to check its premises, it is the more
interesting one. A comment that describes what the code does is worth much less
than one that says what the code is *for*: the first cannot be wrong, and so
cannot warn anybody.

## Where it lands

`http`'s status table is `{ 100: "Continue", 101: "Switching Protocols", … }` —
every key an index, so any enumeration of it was wrong unless the insertion
happened to be ascending. `querystring.parse` results and header objects are the
same shape whenever a key is numeric.

Quiet, too. Nothing throws, the key *count* was always right, and a test only
fails if it compares an enumeration.

## The rule, spelled out because "numeric" is not it

A key is an array index when `ToString(ToUint32(P)) === P` and
`ToUint32(P) != 2^32 - 1`: all digits, no leading zero unless the string is
`"0"`, and below 4294967295.

    "0"  "101"          indices
    "01" "1.5" "-1"     ordinary string keys
    "4294967295"        an ordinary string key, and it is the interesting one

`nearlyIndices` in the example is four keys that look numeric and are not, plus
one that is — node answers `7, 01, 1.5, -1, 4294967295`, and it is the only
case that distinguishes the real rule from "sort anything made of digits".

## Two passes and an insertion sort

Indices first, then the rest in insertion order, with the index segment sorted by
value. The value is re-derived during the sort rather than carried, because
parsing ten digits is cheaper than an allocation to hold them, and the segment is
short — `http`'s sixty is the large case in this tree.

## The controls

Strings only, which insertion order already had right; indices only, inserted
descending, where the promotion has to hold its own ordering; and the key count,
which was never wrong.

A fixture of mixed keys alone would pass on a rule that sorted *everything*.
Both single-kind cases are what say the rule is the language's and not a
convenient approximation of it.

The cases return a digest of the order rather than a string, because the
differential compares scalars — each key contributes its position times a
weight, so two different orders cannot collide.
