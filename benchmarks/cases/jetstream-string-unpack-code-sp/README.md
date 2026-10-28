# JetStream 3 string-unpack-code-SP

This is a strict TypeScript transcription of [SunSpider/string-unpack-code.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SunSpider/string-unpack-code.js) at JetStream revision `3967678fa8ab98d847ab33cf3728dba726fa854b`.

## Original workload and validation

One `work(1)` executes the complete original program: two passes decoding the four complete packed MochiKit 1.3.1, jQuery 1.2.1, Dojo 0.9.0, and Prototype 1.5 rc0 inputs. All packed literals, symbol tables, radix values, and decoder argument expressions are preserved byte for byte. The decoded lengths per pass are 106415, 39024, 72458, and 37857. The original program requires their two-pass total to equal **511508** and throws its original error on disagreement. No decoded code is evaluated.

`n` controls repetitions of this whole program. JetStream originally registers 120 outer iterations. The port uses `seed = 1`, with no reduction of either the two-pass loop or the four inputs. `work` folds each computed, validated length into an unsigned integer checksum; `work(1) = 511508` and `work(2) = 16368256`. A module-level `Benchmark` retains the original driver object identity between calls. The original `var` declarations and per-pass string replacement lifetime are retained. `render(n)` is a test observation of the complete decoded strings and is not used in the timed path.

## Strict typing and harness adaptations

The decoder's incoming dictionary strings and its later replacement callbacks have different types. The original arguments remain unchanged; typed locals represent these original stages without type assertions. The incoming zero encoder placeholder is likewise retained while a declared local holds the original recursive function. `parseInt(String(c / a))` spells the native string coercion already performed by the original `parseInt(c / a)`.

The string-or-callback replacement uses a type-narrowing branch so that both `String.replace` overloads are checked. It preserves the original truthiness test, pattern construction, subsequent dictionary read, and replacement order. Optional observation calls follow the original length additions. The original `run` returns its computed length after validation, and `Benchmark.runIteration` forwards that scalar to the benchmark adapter. The source's dormant old-engine replacement path remains present.

All four complete decoder bodies match their original syntax trees after reversing these listed type adaptations and normalizing optional braces and empty statements. The independent oracle executes the unmodified original program with runtime code generation disabled, then compares all full decoded strings for one and two whole iterations. Each decoder's six raw argument expressions match exactly.

## Licences

Apple's benchmark glue is BSD-2-Clause under the pinned JetStream root licence. All embedded input notices remain in the source. MochiKit offers MIT or AFL-2.1; **MIT is selected**. jQuery offers MIT or GPL; **MIT is selected**. Dojo offers modified BSD or AFL-2.1-or-later; **BSD-3-Clause is selected**. Prototype's original 1.5rc0 header identifies Sam Stephenson and its MIT-style licence. The matching packer decoder templates carry Dean Edwards's 2004–2007 MIT notice in the Dojo 0.9.0 source release. Component notices are collected in the shared `LICENSE-jetstream`.

## Runtime

## Timing

Timing: **6.957760462 ms at seed = 1 under Node 24.20.0**, within the 1–10 ms target.

The unchanged suite harness warms and calibrates inside Node and takes the best of five trials. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `411f385000000000`. Maintainers compile with nts, record oracle counts and measure on their own machines.