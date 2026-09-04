# 0014 — Where a substring actually went

Record 0013 measured the slicing benchmark at 6.64x the C++ reference and
concluded the cost was the allocation, with a *view* as the answer. Half of that
was right. The half that was wrong was wrong for an instructive reason: it was
reasoning about the benchmark rather than measuring parts of it.

## Bisecting instead of reasoning

The method is worth stating because it is what found everything below. Take the
generated C, edit *one thing* out of it, rebuild with the harness's own flags,
and time it. Three variants, each a superset of the next:

| | ns | |
| --- | ---: | --- |
| as generated | 10,540 | 5.1x C++ |
| with the arithmetic kept in integers | 7,740 | −27% |
| and with no substring at all | 2,130 | **0.98x C++** |

The last row is the one that mattered. With the slicing removed the benchmark is
*at parity with C++*, so the scan loop — which is most of the instructions
executed — was never the problem. The gap decomposed into 53% allocation and 27%
arithmetic, and the arithmetic was not something record 0013 had considered at
all.

Getting the build flags wrong made the first attempt read 20 µs for both
variants and say the change was worth nothing. `-DNTS_PROVIDER_RC` is what the
harness passes for this case; without it the allocator was different and swamped
everything. A control build of the *unmodified* source is what caught it, and it
is cheap enough that there is no reason to skip it.

## A string's length had no bound

`total + word.length * step` was computed in doubles and truncated back with the
full wrapping ToInt32, per word. Not because anything about it is floating point
— `total` is an `int32`, `step` is an `int32`, and `word.length` is a `uint32` —
but because the *product* of an unbounded length and an `int32` can leave the
exactly-representable integers, and past 2^53 an `f64` multiply is not the exact
product. So the compiler was right to refuse, and the fix is upstream of it: give
the length a bound.

`Length` was exact for a literal and `[0, 2^32)` for everything else. But every
string-producing operation this compiler emits either says its length outright or
bounds it by its input's, so following the chain back is enough:

```
substring(s, a, b) ≤ length(s)      slice(s, a, b) ≤ length(s)
charAt(s, i) ≤ 1                    a + b = length(a) + length(b)
"literal" = exactly its code units
```

`word.length` is `[0, 80]`, the product fits an `int64`, and `| 0` is a cast.

**This is a fact a string needs and an array does not.** An array's length is its
allocation's and the allocation is usually right in front of the read. The whole
point of a tokenizer is that it makes strings whose length is written down
nowhere.

## A guarded length proved nothing

`if (word.length > 0) { word.charCodeAt(0) }` kept its bounds check, and with it
the NaN that an out-of-range read returns — which is what stopped the result
being an integer and made the second `| 0` a real ToInt32.

No structural fact can settle this. A slice's length is `[0, n]` whatever it was
cut from; it is the *branch* that rules out the empty case. And the fact was
already computed: `word.length` is an ordinary SSA value and the comparison
refined it to `[1, 80]` on that edge. `bounds::eliminate_checks` simply never
looked at it, because it recomputed the length from the container's shape.

Sound only for a string, and the reason is worth keeping: a string's length is
fixed for its lifetime, so a fact proved about `Length(s)` anywhere holds
everywhere. An array's is not — `push` makes a length read from before it a fact
about the past, and using one to bound a later index would remove a check that
can fail.

## `nts_to_integer` called `floor`

On the argument path of every string method. So `charCodeAt` in a scan loop made
a call into libm to *truncate a number that was already whole*, and because a
call clobbers the caller-saved registers, the five constants the surrounding loop
was holding were spilled and reloaded around each one. A value whose truncation
fits in an `int64` needs one instruction.

## A string that does not outlive its frame is built in it

That leaves the allocation, and it is 53%. A view does not help here and record
0013 says why: the words are three to six characters, so the copy is nothing and
the `malloc`/`free` around it is everything.

The compiler already knew enough to skip both, in two facts computed for other
reasons:

- **`escape`** says whether a reference outlives the frame that made it. It was
  asked only about `ObjectNew`. A substring made, read and dropped inside one
  loop body is the same answer to the same question.
- **the length bound above**, which is the part an object does not need. An
  object's size is its type's. Nothing at a `substring` says what its result will
  be, so without a bound there is no frame slot to declare.

Neither implies the other, and together they are exactly the condition. So
`OpKind::Call` carries a capacity, `place_allocations` fills it in where both
hold, and the runtime gained `_into` forms that build in storage the caller
supplies. The result is `NTS_IMMORTAL`, so the release the counting pass emits is
already a no-op: **no rule changes anywhere else**, which is the test of whether
a new mechanism belongs.

There is no run-time fallback and no capacity check in the runtime. The capacity
is a proof. A fallback would allocate an object the compiler has decided not to
free.

The limit is 128 code units. Storage is per allocation *site*, so a function with
several pays for all of them for the whole call and a deep recursion pays again
per level — and a longer slice is one where the allocation is a smaller share of
the copy anyway.

## The four together

| | ns | vs C++ | vs V8 |
| --- | ---: | ---: | ---: |
| record 0013 left it at | 12,040 | 5.49x | 1.67x |
| a length bound | 8,000 | 3.70x | 1.12x |
| a guarded length, and no `floor` | 7,860 | 3.70x | 1.09x |
| built in the frame | 5,150 | 2.36x | 0.72x |
| and the build inlined | **4,280** | **1.99x** | **0.59x** |

(The middle rows are from filtered runs and the outer ones from the full suite,
which is why the C++ column moves under them; the ratios are the thing to read.)

## The last one, and why it was the cheap answer rather than the right one

What remained after the frame was that `nts_str_substring_into` is an out-of-line
call which re-derives what the caller already knew. The compiler held two
`int32`s and widened them to doubles to pass them; the callee's first act was to
work out that they were whole and in range.

Two ways to have that back, different in kind:

- **An inline fast path in the runtime header.** Two comparisons and a
  conversion test settle the clamping, the width question is answered by a flag,
  and the rest is a header and a `memcpy`. It duplicates the logic and it costs
  nothing to be wrong about — the general form is still there.
- **A lowering that emits the unclamped build directly**, which is where the fact
  actually lives, and is the same shape as `bounds::eliminate_checks`: the
  compiler declining to emit a test it has proved.

The second is the better design and it does not work here yet, which is worth
recording. Proving the precondition needs `start ≤ text.length`, and `start` is
`i + 1` where `i` runs to the length — so the interval domain says `[0, 81]` for
a string of 80. The clamp is doing real work on the last iteration, and only the
*runtime* value is in range. So the test has to happen; the only question was
where, and inline is where it costs a predicted branch instead of a call.

The order of the comparisons in it is load-bearing: `from` and `to` are proved to
be in `[0, length]` before either is converted, because converting a double
outside `uint32` is undefined rather than merely wrong.

A **view** is still the answer for *long* slices, where the copy rather than the
allocation is the cost. Nothing here changes that, and nothing here makes it
urgent: this benchmark never had a long slice in it.
