# 0132 — Five hypotheses died and the reference stayed still

`dispatch` publishes anywhere from 0.70x to 1.24x hand-written Java. Record 0130
refuted warmup as the cause and left the question open. Five more hypotheses died
today, and what killed them also says the column is trustworthy, which is the
opposite of what I expected to conclude.

## The modes are real and they belong to the process

Ten runs of one binary:

    28497  27947  34198  28994  28361  27882  28354  28290  18155  17838

Three modes -- about 18, 28 and 34 us -- not a spread. Twelve *independent*
measurement passes inside one JVM, four JVMs:

    jvm 1   30981 27995 28495 28367 28495 28829 27154 28021 27900 28034 28198 28005
    jvm 2   17980 21948 19367 17813 17811 18793 18607 17566 17494 17828 18222 25005
    jvm 3   34176 31618 34654 33561 34618 35366 32387 33801 35848 33012 35487 34714
    jvm 4   28125 30601 28255 28117 29396 30647 28293 28703 29021 28388 28715 28893

**Whatever chooses is chosen once per JVM and then held.** Passes inside a run
agree to a few percent; runs differ by 1.95x.

## What it is not

**Not a compilation decision.** `-XX:+PrintCompilation` on a fast run and a slow
one, filtered to our own methods, is character-for-character the same: the same
OSR of `run$whole` at bci 232, the same tier 3 then tier 4 for the same four
methods, the same deoptimisations. The slowest run differs only in the order two
background C2 jobs finished. I expected this to be where the answer was.

**Not SMT.** Cores 8-15 are four physical cores paired as siblings, so a
benchmark thread sharing a core with a compiler or GC thread was the obvious
mechanism. Pinning to `8,10,12,14`, no two logical CPUs sharing a core:

    with-siblings   28573 27914 32446 27778 28388 33378 27935 34100
    no-siblings     27988 28245 33632 34054 33072 33304 32314 32881

**Not address randomisation.** `setarch -R` disables ASLR for the whole process
tree:

    randomized      28408 17825 28236 33417 18057 31347 33739 34045
    setarch -R      33407 31963 28615 28174 33332 17910 34038 28208

All three modes, in both.

**Not allocation.** The row allocates 2064 bytes/op, which looked like the
mechanism -- young-gen placement varying per process. The reference allocates
**2064 bytes/op**, the same number to the byte.

## What settles it

The Java reference, on the same JVM, same flags, same heap, same eight cores,
in the same locked window:

    nts (JVM)         28090 27938 28039 31800 33857 28082 32212 33700
    Java reference    25374 25949 26952 27202 27066 25322 26330 26608

**7.4% and stable.** The modes are not the harness, the machine or the JVM.
They are a property of the code this backend emits, and hand-written Java for
the same program does not have them.

## And it is two rows, not the column

    checksum            5039  5039  5042  5039  5039  5045     0.1%
    loop                1320  1320  1321  1321  1321  1321     0.1%
    absences             554   554   554   554   554   554     0.0%
    user-iterable     432451 ...                               0.0%
    module-closures     4693  4688  4687  4687  4707  4695     0.4%
    array-predicates   13142 13166 13172 13106 13159 13165     0.5%
    closures            2695  2697  2714  2698  2702  2696     0.7%
    arrays              1432  1419  1425  1418  1413  1426     1.3%
    map-and-set         9214  9227  9070  9050  9035  9180     2.1%
    awfy-bounce         4951  4590  5067  4403  5037  4459    15.1%
    dispatch           28207 27854 28238 32801 33305 34349    23.3%

Ten of twelve are under 2.1% and four are under half a percent. **A row at 1.05x
is measurably above 1.00x**, which I had stopped believing.

## The correction I owe

Record 0130 said three rows moved further than the changes being judged against
them, and named `array-predicates` at "1.25x, 1.31x, 1.35x, 1.65x and 1.76x
across the day". Measured properly -- one binary, one session, six runs -- it is
0.5%.

Those five numbers came from five different trees. **I attributed to the
instrument what was the tree changing underneath me**, and the fix was to hold
the binary still, which is what a pinned worktree is for and what I had not done.
`awfy-bounce` was the one I was right about.

## What the two have in common, as a hypothesis rather than a finding

`dispatch` compiles to 199 instructions in `run$whole` against the reference's
97, and the class carries a second full copy in `run(double)` -- 4.1x the hot
code for the same program. `awfy-bounce` is record 0099's row, 2.9x javac's
bytecode. Both modal rows are the big ones.

That is a correlation over two points and I am not calling it a cause. It is
testable the moment either method shrinks: if the modes go with the size, this
is the same finding as record 0099 seen through a different instrument.

## The instrument change this justifies

`SPREAD_WORTH_SAYING` is 1.25, chosen before there was any data about what
spreads look like. The stable rows top out at 1.021 and the modal ones start at
1.151. **1.10 separates them with room on both sides**, and it is now a
calibrated threshold rather than a guess.

## A sixth measurement, and the contradiction it dissolves

The finding above that the compilation log is identical between a fast run and a
slow one sat awkwardly beside the modes being real. `-XX:+PrintAssembly` on the
C2 body of `run$whole`, six runs, addresses stripped and reduced to the opcode
sequence:

    280, 284, 289, 284, 289, 284 instructions -- six distinct hashes

**C2 emits different machine code for the same method on every run.**

`PrintCompilation` answers *what was compiled* -- which methods, which tiers, in
what order, entered at which bci. It does not answer *what code came out*. I
read the first as though it were the second, which is the same error as the
`rem` dump in record 0133: a correct answer to an adjacent question.

So "not a compilation decision" stands as written and means less than it looked
like it meant. The decisions are identical and the output is not.

**This is suggestive and not settled, for a reason that matters.**
`PrintAssembly` runs the case at 84 us against 18-34, so it changes the timing,
so it changes the profile C2 compiles from -- which is plausibly the very thing
that varies. The measurement may be of a configuration with more nondeterminism
than the one being asked about.

The clean test is `-Xbatch`: compilation synchronous, no race between the
compiler thread and the running loop. If the modes collapse under it,
profile-dependent codegen is the answer. It is a diagnostic only -- a number
that needs `-Xbatch` to be good is a number about `-Xbatch`.
