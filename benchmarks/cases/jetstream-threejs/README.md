# JetStream 3: Three.js

This row transcribes the complete Three.js r178 library and JetStream's
original 8,000-particle scene. It compares native JavaScript engine execution
of scene updates and renderer work against the original mock WebGL context.
There is no C++ reference and no GPU rendering.

## Source and licence

The release is pinned to
[`WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b`](https://github.com/WebKit/JetStream/tree/3967678fa8ab98d847ab33cf3728dba726fa854b).
The complete source files are:

- [`threejs/three.js`](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/threejs/three.js),
  1,246,430 bytes, Three.js r178, MIT.
- [`threejs/benchmark.js`](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/threejs/benchmark.js),
  6,547 bytes, Mozilla's 2025 BSD-2-Clause driver.
- [`JetStreamDriver.js`](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/JetStreamDriver.js),
  the deterministic random generator in `Scripts.addDeterministicRandom`,
  Apple 2018–2024 BSD-2-Clause.

Type descriptions were adapted from the MIT-licensed
[`@types/three` 0.178.1](https://www.npmjs.com/package/@types/three/v/0.178.1)
and [`@types/webxr` 0.5.22](https://www.npmjs.com/package/@types/webxr/v/0.5.22).
They are included as TypeScript declarations; the row does not load either
package at runtime. All source headers remain in the port. The complete
Three.js r178 MIT licence, Mozilla and Apple BSD notices, and DefinitelyTyped
MIT notice are reproduced in `../LICENSE-jetstream`.

## Original operation and input

Each particle retains its 32-segment `CircleGeometry`, white `MeshBasicMaterial`,
black `LineLoop` outline, and enclosing `Group`. Initialization uses the exact
size range, initial positions, and two-component velocity from upstream. The
camera retains its 75-degree field of view, aspect ratio 1, position at z = 500,
and near/far planes 0.1/1000. The renderer is set to 1920 × 1080.

The first original `Benchmark.runIteration` creates all 8,000 particles before
updating their positions and rendering the scene. Later calls update and render
the same scene. `work(n)` repeats that complete operation `n` times, keeping the
original persistent scene and initialization flag. `seed` is 1. No particle,
segment, iteration within a frame, or renderer operation is reduced.

The mock canvas and context retain the original methods, missing properties,
return values, and constants. In particular, the canvas initially has no width
or height, and the mock's shader/program/buffer creation methods return
`undefined`. Its missing draw-mode constants mean the original renderer reports
16,000 calls and 344,000 triangles, with zero line and point counts, for these
frames. Those results are preserved rather than repairing the mock.

The local `random.ts` is the release driver's exact six-step Robert Jenkins
32-bit hash generator, with seed 49,734,321. The adapter resets it before every
original iteration, as JetStream does. Library and driver random calls use this
local function, keeping all draws in their original order without changing
`Math.random` for other rows.

The timed observer mixes particle count, scene-child count, renderer geometry
count, draw-call count, triangle count, point count, and line count into an
unsigned polynomial checksum. It excludes the advancing frame counter so that
repeated complete calls have stable results while the animation retains its
original persistent state. Full position, velocity, geometry, and matrix
validation runs separately from `work`.

| Observation | Value |
| --- | ---: |
| Particles / top-level scene children | 8,000 |
| Geometries after initialization | 16,000 |
| Draw calls per observed frame | 16,000 |
| Reported triangles per observed frame | 344,000 |
| `seed` | 1 |
| `work(1)` | 252155840 |
| `work(2)` | 3774019584 |

## TypeScript adaptations

The full library is retained, including browser loaders, texture formats,
lighting, shadows, PMREM, WebXR, and other paths unused by this scene. The UMD
publication wrapper becomes a module export. The driver is enclosed in a
factory so correctness checks can create a fresh copy of its original lexical
state; `work` keeps one factory result for its lifetime.

Existing classes receive erased field declarations and strict parameter,
return, cache, event, and image types. Constructor functions become classes with
the same fields. Constructors that originally return a record still return the
same record and still run through `new`; their returned objects retain their
original prototypes. The source audit lists these conversions.

The mock WebGL surface is described structurally, including its deliberate
`undefined` values, instead of asserting that it is a complete native context.
Dynamic property access and calls use checked `unknown` boundaries. Explicit
numeric or string conversions occur where the original operator already
performs that conversion. Non-null declarations at initialized cache, render
list, image, and variant-specific accesses express the source's control-flow
invariants. The audit describes the adaptations and their limits; they are not
claimed to be entirely erased annotations.

Original `Object.defineProperty`, `Object.defineProperties`, frozen namespace
objects, and null-prototype namespace literals remain. No descriptor or
prototype operation is replaced with a different representation. An nts
refusal of an original operation is a compiler-support finding for maintainers.

## Fidelity checks

The unmodified pinned library and driver were executed together in an isolated
JavaScript realm using JetStream's exact deterministic random generator. For
three successive complete iterations, the audit serializes every particle's
position and velocity, both complete geometry position arrays, all geometry
indices, and both world matrices. The original program contains no separate
value assertion; its original successful completion remains part of the row.
The additional full-output checks do not add work to the timed operation.

| Frame | Serialized value characters | SHA-256 |
| --- | ---: | --- |
| 1 | 24,992,197 | `86f2cb40ec664d62f411126b2d6c71e31e3a793164344ac43ba0a2da7d6b121e` |
| 2 | 24,992,011 | `2c520ca2225e238f746f55fec8eece14d68a766596f1ddc16d91695e477da0b1` |
| 3 | 24,992,378 | `febc2564f1c93a98ea0ee62f1af89534b161c25f5c8b795ee6a42ff6e879e41c` |

The shared tests independently compare those hashes, all renderer counters,
the full particle count, repeatability, and the opaque iteration count. They
contain no timing assertions.

Run with Node **24.20.0**, as selected by `.tool-versions`:

```sh
node --test benchmarks/jetstream.test.ts
```

## Local validation and timing

Validated with Node **24.20.0**, pnpm **10.15.0**, and TypeScript **7.0.2**:

```sh
pnpm install
node node_modules/typescript/lib/tsc.js --ignoreConfig --strict --noEmit --skipLibCheck --target es2024 --lib es2024,dom,esnext.float16 --module nodenext --allowImportingTsExtensions benchmarks/cases/jetstream-threejs/case.ts
node --test benchmarks/jetstream.test.ts
```

The strict check reports **zero diagnostics**. `esnext.float16` supplies the
declaration for the original optional `Float16Array` feature check; it does not
replace that check or add a runtime dependency. The shared suite passes **7/7
tests**, with no failures, skips, or timing assertions. An additional semantic
type audit finds no inferred `any` values; the source contains no explicit
`any`, casts, or TypeScript diagnostic suppressions.

The source audit accounts for all **2,171 original named definitions**, with
1,849 bodies identical after type erasure and printer normalization, 322 listed
adapted bodies, and none missing. All 1,341 original assigned fields across 259
classes or converted constructors have declarations. All 50 original template
literals retain their exact string contents. The exact mock WebGL trace also
matches: 60 initialization calls, 224,044 calls in the first frame, and 64,003
calls in each later frame, including every argument and shader-source string.
Additional complete geometry, animation, and serialization differentials are
recorded in `source-audit.json`.

The unchanged `benchmarks/common/bench.mjs` measured five sequential fresh
processes with the other porting processes idle. Each process retains the
harness warm-up, calibrated loop, and best-of-five trials:

| Process | Milliseconds per `work(1)` |
| --- | ---: |
| 1 | 95.497246 |
| 2 | 94.659240 |
| 3 | 96.437004 |
| 4 | 96.307574 |
| 5 | 94.389965 |

**Timing exception:** the best result is **94.389965 ms** for one complete
original scene update and render. The row keeps all 8,000 particles and all
renderer work. Warm-up initializes the persistent scene, exactly as the
original iteration model requires; these figures describe the later complete
iterations. Every process returns checksum bits `41ae0f2f80000000`.

The operation audit also identifies original descriptor work: initialization
performs 31 `Object.defineProperty`, 11 `Object.defineProperties`, and three
`Object.freeze` calls. The first complete iteration adds 96,000
`defineProperty` and 24,000 `defineProperties` calls; later observed iterations
add none. Original and port counts match. These operations remain unchanged
for maintainers to compile and record any nts refusal.

Input domains, node oracle counts, nts compilation, the gate, measurements,
and landing remain the maintainers' work.
