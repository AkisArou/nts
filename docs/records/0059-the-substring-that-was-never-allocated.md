# 0059 — The substring that was never allocated

`substrings` is 1.83x C++ and the worst C++ ratio on the board. 0049 recorded it
as a statement rather than a target: "a `string_view` that aliases where we
copy". Re-measuring it found that account is wrong in its first half and
incomplete in its second.

## What is not happening: the allocation

There isn't one. The emitted C for the whole case calls three things:

    4 nts_unit(              charCodeAt
    2 nts_to_int32(
    2 nts_str_substring_into(

`nts_str_substring_into` writes into frame storage — `v35_frame` — so a
substring that does not escape its iteration never reaches the allocator. That
was already true when 0049 was written, and "we copy" was read as "we allocate"
by everyone since, including me at the start of this.

## What is not the cost either: the width branch

`nts_unit` branches on `NTS_TWO_BYTE` for every character, where C++'s `text[i]`
is one load. That is a per-character test in the inner loop of a scan, and it is
the obvious suspect.

Replacing it with an unconditional one-byte load — unsound, as a diagnostic —
moved the row from 3.02us to 3.09us. It costs nothing. clang hoists the flag
test out of the loop already.

## And an experiment that ran backwards

Rewriting the case to skip the substring entirely, taking the length as
`i - start` and the character as `text.charCodeAt(start)`, should have given the
ceiling. It gave 5.14us — *worse* than the 3.02 with the substring, and 3.05x
C++ — while node got 2.3x faster on the same edit.

So the substring is not what the row is paying for. Something about
`charCodeAt` on the parent at a variable index costs more than materializing a
whole string and reading its first character, which is its own finding and is
not chased here.

## What it actually is: the loop does not unroll

    nts   bench_run   354 instructions   11 cvtsi2sd   6 memcpy
    C++   main        422 instructions   20 cvtsi2sd   0 memcpy

C++ runs *more* instructions and more conversions, and is 1.83x faster. The
profiles say why. Ours has one hot `cmpb $0x20` at 23%; the C++ has the same
`cmpb`/`jne` pair at **four different addresses**, none above 7.6%. clang
unrolled the scan and we did not.

The scan runs 64 rounds over 81 characters — 5184 iterations — against about a
thousand substrings. Unrolling it is worth more than anything done to the
substring, and what blocks it is the substring branch sitting inside the same
loop body: the `memcpy` call makes the body too large to unroll.

So the copy does cost, but only about 13% of the row directly, in `memcpy@plt`
and its libc callees. The rest of what it costs is that it is *there*.

## What this changes

0049's reason is retired. The row is not "a copy where C++ aliases"; it is a
loop that does not unroll because a copy is inside it. A view would remove the
copy and shrink the body, which is the same change 0049 declined — but it is now
worth measuring against a different number, and the thing to measure after it is
whether the scan unrolls, not whether the substring got cheaper.

The two contradicted diagnoses are the point. Both were plausible, both were
inherited rather than measured, and both were wrong.
