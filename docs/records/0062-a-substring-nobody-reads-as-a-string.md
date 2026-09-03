# 0062 — A substring nobody reads as a string

`substrings` was the worst C++ ratio on the board at 1.87x. It is now **0.93x**,
and 0.23x node. What it took was not a representation change; it was noticing
that the benchmark never reads the substring as a string.

## Two records of mine that were wrong about the same row

0049 said we allocate where C++ aliases. We do not — a substring that does not
escape is written into frame storage, and that was already true when it was
written. 0059 corrected that, put the copy at **13%** from a `perf` profile, and
blamed the rest on the scan loop not unrolling.

That was wrong too, and the way to find out was to stop profiling and cut. This
benchmark reads only `word.length` and `word.charCodeAt(0)`, so copying just the
*first byte* leaves its answer correct while removing the copy:

```text
full copy   3.02us   1.87x C++   0.48x node
one byte    1.91us   1.11x C++   0.28x node
```

The copy is 1.11us of a 1.32us gap. `perf` understated it by a factor of four
because the cost spreads across `memcpy`'s libc internals and the call rather
than landing on one symbol, and I read the one symbol.

## What the pass does

`hir::substring`: a substring whose every use asks for its length or one of its
characters is never read as a string, so it is not built.

```text
text.substring(a, b).length   ->  end - start
text.substring(a, b)[k]       ->  text[start + k]
```

**The clamping is the whole difficulty.** `substring` is not `slice`: it clamps
both endpoints into `[0, length]` and *swaps* them when they arrive out of
order, so `"abc".substring(2, 0)` is `"ab"`. Emitting `b - a` would be right for
the loop this was found in and wrong for the language. Four integer `Min`/`Max`
go in where a call and a `memcpy` came out.

It runs after specialization and declines a fractional endpoint, because that
case also needs `ToIntegerOrInfinity` — truncate toward zero, NaN becomes 0 —
and `Max(NaN, 0)` is NaN, so clamping does not stand in for it.

**The call has to be neutralised, not merely unlinked.** `dce` will not collect
an external call, since nothing can prove it has no effect. Removing it from its
block is not enough either: `place_allocations` finds every `Call` in the value
arena and hands it frame storage again, and the emitter then declares a `_frame`
nothing uses, which is `-Wunused-variable` and an error under the flags the
generated file is compiled with. So the operation stops being a call.

## The check that could not have failed

`examples/strings` had exactly one `substring`, and it *returns* the result — so
the pass declines on it and nothing in the suite exercised the rewrite. The
clamping could have been wrong in every direction and the gate would have been
green.

Three functions now read a substring's length and its characters, with `| 0` on
the endpoints so that the integer path is the one taken. The differential's pool
makes those endpoints negative, fractional, swapped and past the end; 306 cases,
agreed with node on every one.

## What it is worth

```text
before   3.02us C   3.19us LLVM   1.87x C++   0.48x node
after    1.89us C   1.56us LLVM   0.93x C++   0.23x node
```

Below the one-byte ceiling of 1.91us, because the endpoints the clamp produces
are bounded by construction and the arithmetic downstream of them specializes
where `i - start` would not have.

## The four things that did not work first

Worth listing, because each looked right:

    the allocation                  there isn't one (0049, retired in 0059)
    `nts_unit`'s width branch       measured at zero (0059)
    `i - start` by hand             slower: loses the bound, sinks the accumulator
    `Math.min`/`Math.max` by hand   slower: they are calls with NaN rules

The last two are why estimating this in TypeScript kept saying the opposite of
the truth. Neither is what the pass emits, and the thing that finally answered
it was changing the runtime rather than the program.
