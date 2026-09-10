# The JSON row is mostly not JSON

The queue said to optimize the JSON path in TypeScript. Measured first, because
"optimize X" is a hypothesis about where the time is.

    json-parse                 nts 1.84 ms    node 805 us    2.29x
    json-scan                  nts 2.20 us    node 1.72 us   1.28x
    json-stringify-doc (rc)    nts 3.50 ms    node 1.39 ms   2.52x

`json-scan` is the allocation-light row and is nearly at parity. The two
allocation-heavy rows are the gap, which is the shape of the answer before any
profile: this is about what the program *allocates*, not what it computes.

## Two rows, two different answers

**Serialize is not the TypeScript.** Under reference counting — which that case
pins with its own `provider` file — the profile is:

    nts_each_reference     23.9%
    stringifyJsonValue     20.8%      <- the serializer
    nts_scan_black_child   13.1%
    nts_mark_gray_child    10.4%
    nts_release             9.2%
    nts_collect_cycles      8.7%

About 65% is the reference-counting runtime and 21% is the serializer. Editing
the TypeScript would work on the fifth of the row that is JSON.

**Parse is the TypeScript**, and a different profile says so:

    parseJsonText          28.5%
    Scanner__readString    10.1%
    readMemberKey           7.6%
    JsonValue.objectValue   7.5%
    nts_array_grow          6.6%
    nts_array_new           5.7%

## What was changed, and why it is small

`JsonValue.objectValue` allocated **nine arrays per object** — three `index*`
that stay empty for any object with no array-index key, an `order` that stays
empty with them, the two string arrays holding the members, the final key/value
pair copied out of those, and the empty items list. Two of the nine carry data.

For an object with no index-like key — almost every object — the string arrays
already hold the members in insertion order, which is what the ordering exists
to produce. So they *are* the answer, and the copy is the whole of the work
skipped. They are local, nothing else holds them, and a `JsonValue` does not
mutate what it is given.

    json-parse   1.84 ms -> 1.64 ms, 1.63 ms      about 11%

Three runs, absolute numbers, the same corpus. `json-stringify-doc` is unmoved
at 3.52 ms, which is right: it does not parse.

## Three instrument failures on the way, all self-inflicted

**counted.sh measured a case that was never generated.** `json-stringify-doc`
had only a `.jvm` directory; the C lane had never built it. It answered "112
instructions, 1 us an operation" for a row that takes 3.49 ms. Its own header
says it requires `nts-bench` to have generated the case at least once, and that
sentence is the whole diagnosis.

**Then it missed the calibration by 3500x.** With the case generated it still
estimated 1 us against a real 3.49 ms. `NTS_COUNTED_N=100` gave 21,523
instructions for an operation that is nearer ten million. The goal's warning —
"exact about work and imprecise about how much work it calibrated" — is an
understatement at this size. It is the wrong instrument for this row and perf is
the right one.

**And three experiments on the collector all reported "no change", correctly.**
Raising `NTS_COLLECT_THRESHOLD` a hundredfold, gating checkpoint collection, and
then disabling both moved the row by 0.01 ms. The object files *were* rebuilt —
checked, twice, because an unchanged number is exactly what a stale build looks
like. What that rules out is collection *frequency*: the cost is the per-release
graph walk, and `nts_each_reference` at 23.9% is mostly destruction rather than
collection.

So the serialize row's 65% is not tunable by a threshold, and the honest next
question is whether a document tree needs to be reference-counted at all —
`json-stringify-doc` pins `rc` deliberately, and `json-parse` under NoGC has a
completely different profile. That is a representation question and it is filed
rather than guessed at.

## What is refused

`stringifyJsonValue` itself was not touched. It is 21% of a row whose other 65%
is the runtime, and changing it would be measured against noise. The parse-side
change is the one the numbers supported.
