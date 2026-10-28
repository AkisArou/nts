# JetStream 3.0: raytrace-private-class-fields

This is the complete original class-field ray-tracing workload from JetStream 3.0, pinned to release revision `3967678fa8ab98d847ab33cf3728dba726fa854b`. `work(1)` performs the original **15 complete renders**. The seed is **1**; no scene, render count, resolution, ray depth, or material value is reduced.

## Source and licences

The source is [`class-fields/raytrace-private-class-fields.js`](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/class-fields/raytrace-private-class-fields.js), whose Git blob is `e536a57b4cc2c40115da3f8657d36538429d5e15` and SHA-256 is `9b9871835860f514f3a532d16a527f4de38852cadadf2ea04cf39b1067e32da4`. It attributes the ray tracer to Adam Burmister, the standalone adaptation to Google, and the class-field refactoring to JetStream.

The [original Octane attribution](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/Octane/raytrace.js), [V8 BSD-3-Clause notice](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/Octane/LICENSE.txt), and [Apple BSD-2-Clause notice](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/LICENSE) cover the included program. The complete notices and original header are retained in `case.ts`; companion notices are collected in [LICENSE-jetstream](../LICENSE-jetstream). `provenance.json` records the pinned sources and adaptation details.

## Preserved workload and lifecycle

Each original `Benchmark.runIteration()` calls `renderScene()` 15 times. Each render constructs the original camera, background, two spheres, plane, two lights, materials, and engine. The original 100 by 100 dimensions and 5 by 5 pixel size produce a 20 by 20 grid: **400 pixels per render and 6,000 pixels per benchmark iteration**. Diffuse lighting, shadows, specular highlights, reflections, and ray depth 2 remain enabled exactly as in the source. There is no RNG.

One stateless `Benchmark` instance lives outside `work`, matching the release driver's lifecycle. Scene construction, field initialization, tracing, and the original validation all remain inside each iteration. Every render checks `checkNumber === 2321`; that original diagonal-pixel brightness check is unchanged.

The port retains all 16 original classes, 48 class fields, and 76 methods/accessors. The 41 `#private` fields, 7 private methods, and original accessors remain actual JavaScript private members. Every initializer stays in its original position, including the real `null`, `{}`, and `[]` initializers. Static default-color objects and inherited initialization order are preserved.

## Type adaptations

Type annotations and exports make the original classes usable in strict TypeScript. An erased overload on `Material.getColor` permits the original two-argument virtual calls while leaving the original zero-parameter implementation and function arity intact.

The original nullable fields have truthful union types. Checked narrowing at 51 dereference/vector-use sites returns the same object or throws `TypeError` for null/undefined; it never substitutes a vector, material, or scene. The original valid workload does not trigger these guards. A guard on an argument to a vector method can report an invalid-input error at its call site rather than inside that method. Compared original null/error cases retain their error names and messages.

The four numeric comparisons of nullable intersection distances use `?? 0`, preserving JavaScript's numeric conversion of null. Engine options keep the original empty-object field initializer and are typed as `Partial<EngineOptions>`. Missing numeric operands use `?? NaN`; the two compound divisions in the constructor are written as equivalent assignments over the same options object. These changes preserve undefined arithmetic and all supplied defaults/input values without asserting a fully initialized object before construction.

The source audit verifies that 68 of the 76 method/accessor bodies are identical after type erasure. The remaining eight match after removing these recorded narrowing/coercion adaptations and the post-validation scalar observations. The complete scene-building function and original 15-render benchmark loop are identical after erasure.

## Observable results and validation

After each original render assertion, the adapter records its check number, increments a render count, and mixes that number into an unsigned 32-bit checksum using `checksum = (checksum * 31 + checkNumber) >>> 0`. Thus every completed render in every requested iteration contributes. `work` clears only the adapter's checksum/count before running; it does not retain scenes or pixel buffers. `render(n = 1)` executes the same complete workload and returns the final validated check number. `observation()` reports the latest check number and the last call's render count/checksum.

| Call | Expected result |
| --- | ---: |
| `work(0)` | 0 |
| `work(1)` | 301702705 |
| `work(2)` | 2658908128 |
| `render(1)` | 2321 |
| `observation().renders` after `work(1)` | 15 |

Strict TypeScript checking passes. The untouched pinned source first passes its full original benchmark. Separate test-only instrumented contexts then compare all **6,000 ordered pixels**, including all three floating-point color channels and brightness values, against the port. All values and all 15 validations match. The original and port pixel-trace SHA-256 is `f4dfbaa99c35485feb340fa4c25ca7faf78e2b6d59f71d42a64ae24ee5420b86`.

An independent field trace compares 99 static/instance initialization events, including inherited order, null/default values, and public own-key order. The AST audit separately verifies all 48 original field initializers, privacy flags, and order. Representative hit, miss, tangent, plane, null initialization, original error, and member-arity cases also agree. Source-only instrumentation adds temporary component/pixel access in validation contexts; no such hooks exist in this case.

The measured checksum intentionally retains the source's diagonal-pixel validation strength; it is not a full-image hash. The all-pixel oracle supplies the stronger equality check outside benchmark work.

## Timing

Timing exception (approved): **12.455856250 ms at seed = 1 under Node 24.20.0**; one full iteration exceeds 10 ms and retains its complete original input.

The unchanged suite harness warms and calibrates inside Node and takes the best of five trials. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41b1fb9e31000000`. Maintainers compile with nts, record oracle counts and measure their own machines.
