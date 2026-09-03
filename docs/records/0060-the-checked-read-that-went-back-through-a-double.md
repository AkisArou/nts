# 0060 — The checked read that went back through a double

`charCodeAt` is lowered as an operation rather than a call, and the lowering
says why:

    // `charCodeAt` is an operation rather than a call: as a call its index
    // would have to match a C signature, which pins the loop counter that
    // produces it to a `double` and makes every step downstream floating
    // point.

That is right, and it was only half true. `StringUnitAt` has two emissions. The
unchecked one — where `bounds` proved the index inside the string — is
`nts_unit`, a load. The checked one was:

    static inline double nts_str_char_code_at(const NtsString *s, double at) {
      at = nts_to_integer(at);
      if (at < 0 || at >= (double)s->length) { return (double)NAN; }
      return (double)nts_unit(s, (uint32_t)at);
    }

A `double` index, truncated in floating point, compared against a length
converted to floating point, converted back to index. Exactly the round trip the
lowering keeps `charCodeAt` an operation to avoid, reintroduced on the path that
could not prove its index.

## Why it has to take a double, and why the index does not

The general form is right: `s.charCodeAt(0.5)` is the character at 0, not an
error, so an index really can be fractional and really does have to be
truncated. That is `nts_to_integer`, and differential testing found it.

But a *scan* does not produce halves. Its index is a loop counter that
specialization has already made an `i32` or an `i64`, and for that index the
whole test is one unsigned comparison:

    static inline double nts_str_char_code_at_int(const NtsString *s, int64_t at) {
      if ((uint64_t)at >= (uint64_t)s->length) { return (double)NAN; }
      return (double)nts_unit(s, (uint32_t)at);
    }

Both backends pick between them on the index's HIR type. It is a choice, not a
flag: an integer index gets the integer form and everything else gets the one
that existed.

## What it is worth

`node-utf8` is the row that has checked reads in it — three of them, and three
unchecked beside. Nine runs each, same machine, alternating:

    before   min 30152ns   median 30447ns
    after    min 29861ns   median 29987ns

About 1.5% on the median and 1.0% on the minimum, in the same direction on both.
Real, and small, and the reason it is small is that `charCodeAt` is not most of
what that row does. Said plainly rather than rounded up.

`case-convert` has four checked reads and gets **nothing**, because its index is
not specialized to an integer at all. That is a separate question and a more
interesting one — the read is fine, the index is the thing that stayed a double —
and it is where the next measurement on this path should go.

## The check that caught the mistake

The LLVM backend emitted the call and never declared it, so the module did not
compile and the whole row went to `--` in the benchmark table. That is what
`ALWAYS_DECLARED` is for and adding the helper to it was the fix.

Worth recording because the failure was silent in every other instrument: the
gate had not run yet, the C backend was fine, and the only thing that said
anything was a column of dashes where a number belonged. A benchmark table that
prints `--` for a refusal is a check that can fail.
