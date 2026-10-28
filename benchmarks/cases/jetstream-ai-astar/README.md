# JetStream A* pathfinding

Source: [WebKit/JetStream, revision `3967678fa8ab98d847ab33cf3728dba726fa854b`, `SeaMonster/ai-astar.js`](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/ai-astar.js).

The original javascript-astar 0.4.1 source is **MIT**, with Brian Grinstead's complete notice retained in every source file. The original credit to Marijn Haverbeke for the included binary heap is also retained.

## Workload and lifetime

The entire original **500×500 weight grid** is retained byte-for-byte. Each upstream benchmark constructor creates its own grid and `Graph`; iterations search that existing graph from `[0, 0]` to `[123, 321]`. This port keeps one benchmark instance across calls, including the original dirty-node cleanup at the beginning of each search. Graph construction is setup, as upstream; it is not moved into the measured iteration.

The data module provides a factory containing the original array literal, so an additional explicitly constructed `Benchmark` still receives fresh input arrays. No parsing, generated input, shortened grid, changed endpoints, or reduced search is introduced.

The original driver has no explicit result assertion. `runIteration()` returns its original computed path for independent verification. `work(n)` repeats complete searches and folds every returned node's `x` and `y` coordinates using `checksum = (checksum * 31 + coordinate) >>> 0`. `seed` is 1.

## Adaptations

The fixed local module-registration wrapper becomes ordinary typed exports. Its selected source branch always initializes the same `astar` and `Graph` values; unused AMD and browser-global registration branches are not part of the workload. Constructor/prototype registration becomes classes with declared fields. Fields are still assigned in the original constructor and initialization methods, in their original order. The search, both heuristics, graph operations, node cost calculations and complete binary-heap methods retain their original bodies and arithmetic.

Three explicit `undefined` checks narrow values returned by `Array.pop`: one in the search and one each in heap `pop` and `remove`. The original dense-heap invariants make them false on valid search operations. They throw `TypeError` if a required node is absent and do not supply replacement nodes or defaults. In `bubbleUp`, the conditional `child1Score` operand uses an explicit `Number` conversion, matching the numeric conversion already performed by the original comparison; an uninitialized value remains `NaN` for that comparison.

The only result adaptation adds the path return and an outer coordinate checksum. No npm dependency, Node API, reflection, descriptor operation, runtime prototype mutation, or generated code is used. A compiler refusal of an original source feature remains a finding.

## Timing

Timing: **7.210395200 ms at seed = 1 under Node 24.20.0**, within the 1–10 ms target.

The unchanged suite harness warms and calibrates inside Node and takes the best of five trials. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41ee40c263200000`. Maintainers compile with nts, record oracle counts and measure their own machines.
