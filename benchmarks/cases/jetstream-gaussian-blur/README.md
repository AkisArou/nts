# JetStream Gaussian blur

Source: [WebKit/JetStream, revision `3967678fa8ab98d847ab33cf3728dba726fa854b`, `SeaMonster/gaussian-blur.js`](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/gaussian-blur.js).

The source is **MIT**, copyright 2014 Andrei Tupitcyn. Its full original notice, nodeca/glur attribution and Intel IIR-filter reference are retained.

## Workload and independent trials

The original constructor generates all **800×450 pixels** with its local Jenkins generator seeded with `49734321`. The radius remains **15**. Every iteration performs both original convolution passes, including the transposition and the `Float32Array` intermediate line and coefficients, and modifies the original `Uint32Array` image in place.

For a deterministic standalone `work(n)`, each call starts one fresh original `Benchmark` and then runs **n consecutive in-place iterations on that instance**. This preserves the source's buffer lifetime within a trial. **Original input construction is included in the measured work.** No cached-input copy, unrecorded reset, precomputed result, changed dimensions or shortened pass is used.

`runIterations(n)` exposes the complete resulting buffer; `runIterations(0)` exposes the original generated image. The original benchmark has no output assertion, so independent tests compare full buffers with fresh original-source trials. `work(n)` observes 64 evenly spaced final computed words, including both endpoints, using `checksum = (checksum * 31 + word) >>> 0`; `work(0)` returns zero. This bounded checksum is backed by the complete output comparison. `seed` is 1.

## Adaptations

The algorithm is transcribed with number and typed-array annotations; its arithmetic and control flow are unchanged. Module coefficient bindings retain the original update order. The class declares its fields without adding eager initialization. A checked overload preserves the original six-parameter convolution implementation while accepting the caller's ignored seventh radius argument. The adapter adds the explicit independent-trial scope and bounded final-output observation.

No npm dependency, Node API, reflection, descriptor operation, runtime prototype mutation, generated code or alternative blur implementation is used. A compiler refusal of an original source builtin remains a finding.

## Timing

Timing exception (approved): **14.713337833 ms at seed = 1 under Node 24.20.0**; one full iteration exceeds 10 ms and retains its complete original input.

The unchanged suite harness warms and calibrates inside Node and takes the best of five trials. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41bbe2ce3b000000`. Maintainers compile with nts, record oracle counts and measure their own machines.
