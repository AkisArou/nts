# JetStream 3.0: UniPoker

The complete original Unicode-card poker program from release revision `3967678fa8ab98d847ab33cf3728dba726fa854b`. Seed **1** performs **2,000 hands for all four players**, with the original 52-card deck, scoring regular expressions, shuffle, statistics and expected-result validation.

## Sources and licences

- [`RexBench/UniPoker/poker.js`](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/RexBench/UniPoker/poker.js) — SHA-256 `fc83bea3d610877569501ec4f6c33ba3b93c2baf7e43f9e012e2f7964bd19029`.
- [`RexBench/UniPoker/expected.js`](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/RexBench/UniPoker/expected.js) — SHA-256 `30cfc0333a223e4cbcbbe37f25861624c5d4de3677505ab164dbed664b13f86f`.
- [`RexBench/UniPoker/benchmark.js`](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/RexBench/UniPoker/benchmark.js) — SHA-256 `db2f4914a54257bf3c49ff9c2f9b42148714dffa26e9d826525f6eba02063ed4`.
- [`JetStreamDriver.js`](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/JetStreamDriver.js) — SHA-256 `05d3e59df671e03bdb81c6896d3784d15db993447de2acb07207a1733dd8a5cd`.

The three UniPoker sources and their complete embedded inputs are Apple 2017 BSD-2-Clause. The exact driver RNG is Apple 2018–2024 BSD-2-Clause. Full original notices remain in each corresponding source file; companion notices are collected in [LICENSE-jetstream](../LICENSE-jetstream). `provenance.json` records the source blobs and precise adaptations.

## Complete workload and trial boundary

Each source `playHands` call creates its original deck, shuffles all 52 cards before every hand, clears each player’s hand, deals five rounds to all four players, scores the sorted Unicode hands, and records every winning/tied player. The loop remains exactly **2,000 hands**. The original complete regular expressions and all card/rank/scoring constants remain unchanged.

The exact driver RNG starts at **49734321** and resets before every original iteration. It performs **104,000 draws per iteration**: 52 per shuffle, including the source's final one-element shuffle step. Player wins and ten hand-type counters accumulate across iterations.

**`work(n)` is one independent original trial and includes setup.** It constructs the original Benchmark and its four Players once, runs all `n` complete iterations with the source's evolving player state, then invokes the original validation and original expectation scaling. This boundary is the user-approved adaptation needed for repeatable independent calls; the release driver constructed Benchmark outside its iteration timer. No player state resets occur between the iterations within a call. The latest Benchmark is retained for observation, as the original driver retains its Benchmark instance.

`work(0)` returns zero without invoking the source's invalid-zero-trial validation. The exported original `Benchmark.validate(0)` still throws `"Invalid iterations"`.

## Type adaptations and retained behavior

All original classes, methods, accessors and fixed static assignments remain. Erased `declare` fields preserve constructor/lazy-assignment property order. `dealOneCard()` still returns undefined for an exhausted deck, and hands can still store that result. Checked narrowing at the original card dereference preserves its TypeError without fabricating a replacement card. Undefined code-point values use `?? 0` only at the source's bitwise conversions.

The full-house score retains the original expression **`threeOfAKindCardRank < 12`**. The port explicitly converts that boolean with `Number(...)` for TypeScript's bitwise typing; it does not “correct” the source to a shift. All other scoring arithmetic and regular-expression text are unchanged.

## Results and checksum

After every complete iteration, the adapter mixes all four players’ ranks, accumulated wins, ten hand-type counters, and five complete Unicode card code points into an unsigned multiply-by-31 checksum. Thus every requested iteration contributes, including suit information. `render(n)` returns copied observations of the latest player state; the copies are made after work. `observation()` also reports the completed iteration count and checksum.

| Call | Expected checksum |
| --- | ---: |
| `work(0)` | 0 |
| `work(1)` | 2585762842 |
| `work(2)` | 4242378396 |

The complete original one-iteration statistics are:

| Player | Wins | Final hand rank | Hand-type counts, original order |
| --- | ---: | ---: | --- |
| Player 1 | 501 | 759907 | `[1005, 850, 84, 42, 12, 3, 4, 0, 0, 0]` |
| Player 2 | 504 | 1038435 | `[1003, 830, 98, 51, 10, 3, 4, 1, 0, 0]` |
| Player 3 | 512 | 960082 | `[1010, 831, 92, 51, 9, 4, 3, 0, 0, 0]` |
| Player 4 | 483 | 1956228 | `[1011, 837, 92, 48, 7, 4, 1, 0, 0, 0]` |

## Verification

Strict TypeScript checking passes. The untouched release completes one full iteration and its original validation. The original and port match **all 2,000 complete shuffled decks**, **all 8,000 scored hands**, all final player state, and the exact RNG draw count. The deck-trace SHA-256 is `181d20a66b53423508143dbae134627819e8719d992755f2abea0a672292199a`; the scored-hand trace is `ee21a1632dd143043832532dfa7a554bb97e7997faff8e21fe6f5ba02b28f6d4`.

The structural audit proves all 5 original classes and 24 members match after type erasure and the documented numeric/binding adaptations. Both free functions, every original static-data assignment, literal Unicode/regex escaping and the complete expectation tables match. Separate cases cover major hand categories, exhausted decks, nullary/invalid validation, empty code points and instance property order. Repeated independent calls and two-iteration accumulation also agree with the original.

## Timing

Timing: **7.779689923 ms at seed = 1 under Node 24.20.0**, within the 1–10 ms target.

The unchanged suite harness warms and calibrates inside Node and takes the best of five trials. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41e343f383400000`. Maintainers compile with nts, record oracle counts and measure on their own machines.