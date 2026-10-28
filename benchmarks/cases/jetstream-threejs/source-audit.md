# Three.js transcription audit

## Source identity

The source is JetStream 3.0's `threejs/three.js` and `threejs/benchmark.js` at
`3967678fa8ab98d847ab33cf3728dba726fa854b`. `source-audit.json` records each
original byte count, Git blob ID, SHA-256, the original static reflection
operations, and the complete three-frame oracle summaries. The original library
has 31,208 lines; no library declaration or dormant branch is intentionally
removed from the TypeScript transcription.

The additional type declarations come from `@types/three` 0.178.1 and
`@types/webxr` 0.5.22, with corrections where their shapes differ from the
actual r178 implementation or the deliberately incomplete mock context. Both
are MIT licensed. Their original MIT notice is reproduced in
`../LICENSE-jetstream`.

## Constructor functions

These six original constructor functions become classes with erased field
declarations, preserving their constructor bodies and `new` call sites:

- `WebGLBufferRenderer`
- `WebGLClipping`
- `WebGLIndexedBufferRenderer`
- `WebGLProgram`
- `WebGLShadowMap`
- `WebGLTextures`

Twenty-five other original functions are also constructed with `new`, but
explicitly return a record of closure functions and state. They become classes
whose constructors still return that original record. The class declares its
returned shape, and the call site still uses `new`. Returning an object from a
constructor replaces the constructed instance, so these objects retain the
same plain-object prototype as upstream. The complete names are listed in
`source-audit.json`.

The nested `ColorBuffer`, `DepthBuffer`, and `StencilBuffer` functions in
`WebGLState` receive the same treatment. Their original `new` calls and explicit
returned records remain. `ShadowUniformsCache` remains a plain factory because
upstream calls it directly.

Existing classes retain their original constructor statements. Erased `declare`
fields describe fields initialized by constructors, descriptors, closures,
subclasses, or guarded later assignments. The driver's custom `Group.velocity`
field is declared on the same class; it is still assigned at the original point
in particle initialization.

## Dynamic and host boundaries

The program uses heterogeneous materials, textures, scene objects, events,
images, uniform values, and caches. The port gives their common and optional
variant fields structural types. Checked property reads, writes, method calls,
array views, numeric values, and instance checks bridge genuinely dynamic
`unknown` values. They keep the original receiver when calling a method. No
`any`, unchecked `as` cast, missing-method fallback, or alternate algorithm is
used to stand in for the source operation.

The context is typed as `RenderContext`, which describes the actual properties
and return values the original library consumes. It explicitly admits the
mock's absent constants and `undefined` resource handles. Optional methods are
called at the original sites; the annotation does not install a native browser
API or a successful fallback. The mock's empty functions have erased
`undefined` return annotations, preserving their bodies and JavaScript arity.

Number and string conversions make existing JavaScript coercions explicit at
arithmetic, bitwise, string-replacement, and dynamic property-key boundaries.
For example, missing WebGL constants remain `undefined` for equality checks;
they become `NaN` or zero only where the original arithmetic or bitwise operator
already produces that result. Numeric shader replacement strings retain the
same decimal representation as native `String.replace` coercion.

`copyTextureToTexture` retains an absent z coordinate when passed a `Vector2`.
`getSize` retains the original undefined width/height before a mock canvas has
been sized. Uniform-cache and array narrowing preserve the original loop and
assignment order. Targeted non-null annotations describe values initialized by
the preceding original branch; they do not manufacture runtime values.

The constructor's context acquisition is kept in its original `try`/`catch`.
Its nullable temporary is followed by a checked constant binding after the
existing context-failure branch, allowing nested closures to use the same
resolved context safely. The active benchmark still uses its original mock.

Empty overridable hooks retain their empty implementations and JavaScript
parameter lists; erased overload signatures describe their actual call sites.
This matters for hooks whose function text is used as a cache key.

## Original descriptor and prototype behavior

The full upstream library contains ten `Object.defineProperty` call sites and
two `Object.defineProperties` call sites. They define original IDs,
Object3D/BufferAttribute properties, material reflectivity, and background
material map properties. All remain. Three frozen namespace records retain
their `__proto__: null` literals. The source has no `Object.setPrototypeOf`,
`Object.getPrototypeOf`, `Object.getOwnPropertyDescriptor`, or
`Object.getOwnPropertyDescriptors` call sites.

The original RGTC format branch compares its format against the BPTC constant,
an unreachable comparison for that branch. The port preserves that comparison
rather than correcting it. An identity numeric conversion prevents TypeScript's
literal narrowing from rejecting the original condition.

No compiler refusal has been evaluated here. Maintainers compile this complete
row with nts; an unsupported original descriptor or host operation remains a
finding rather than a reason to substitute different code.

## Driver and random state

The full driver is enclosed in `createDriver`, preserving its lexical variables,
mock objects, initialization loop, update loop, and `Benchmark.runIteration`
body. `work` holds one result of this factory, so its scene, renderer, particles,
initialization flag, and renderer caches persist just as they do upstream.
Validation creates a separate fresh result of the same factory.

The suite driver's deterministic random function is moved to `random.ts` and
called locally by both the library and the benchmark. Its six integer-hash
steps, seed, unsigned conversion, divisor, reset position, and random-call
ordering are unchanged. Global `Math.random` is not reassigned by the row.

`n` counts complete original `runIteration` calls. The first measured call
retains original particle initialization. The observer reads completed renderer
counters and object counts; it excludes the changing frame number. The observer
does not serialize arrays or run the full snapshot checks inside `work`.

## Independent output evidence

The untouched original library and driver were evaluated in a fresh Node
24.20.0 VM realm, with JetStream's own deterministic random function installed
before loading. The generator is reset immediately before each original
`runIteration`. Initialization and three complete frames consume 264,120 draws
in total; the frame updates themselves consume no further random values.

For each frame, the audit records all 8,000 particles in source order. Each
particle contributes position x/y/z, velocity x/y, and both children's type,
complete geometry position array, complete index array or null, and complete
world matrix. Their JSON value strings have the three hashes recorded in the
README and JSON audit. Frame counters are copied when sampled, avoiding a shared
reference to the renderer's later-mutated counter object.

The same original driver evaluated against the typed library matches all three
complete snapshots and counters. The actual port's separate `render` helper is
also checked against the original hashes by `benchmarks/jetstream.test.ts`.
Those checks include all numeric output values, not a bounded sample. The
original program has no independent assertion function; no original validation
has been removed.

## Final definition and type audit

The comparison enumerates all 2,171 original named functions, methods, and
constructors. After ordinary TypeScript erasure and printer normalization,
1,849 bodies are identical and 322 contain the dynamic-boundary checks,
coercions, local random calls, or required syntax adaptations described above.
No original definition is missing. The JSON audit lists every changed
definition with the original and port body hashes; these are comparison hashes
of the normalized bodies, not source-file hashes. This is an accounting of the
transcription, not a claim that runtime checks are erased annotations.

Eight parameter lists differ. Seven rename an input before narrowing it:
`MaterialLoader.parse`, `BufferGeometryLoader.parse`, `ObjectLoader.parse`,
`ObjectLoader.parseAsync`, `flatten`, `arraysEqual`, and `copyArray`. Their arity
and defaults are unchanged. The eighth is the original
`Texture` setter `set image(value = null)`: TypeScript rejects a setter default
parameter, so the default becomes `if (value === undefined) value = null` at the
start of the same setter. The setter retains its behavior, including an
explicit `undefined` assignment, but its function length changes from zero to
one. The original program does not read that metadata.

Erased overloads preserve the empty parameter lists of the ten WebGL state
forwarding functions. Their original `arguments` forwarding remains. The exact
function text of the empty `Material.onBeforeCompile` method is retained
because `customProgramCacheKey` reads it. All 50 original template literals
retain their exact raw segments, including leading tabs in GLSL strings.

The final AST audit finds zero explicit `any` types, zero type assertions, zero
diagnostic suppressions, 1,361 erased non-null expressions, and 2,302 property
declarations. A separate semantic check of variable, parameter, property,
binding, and `this` types finds zero inferred `any` values. All 1,341 assigned
fields found in the 259 original classes and constructor functions have
declarations in the port.

## Renderer and dormant-path differential checks

An instrumented original mock context and the port produce the exact same
ordered method and argument streams. The encoding distinguishes absent values,
argument count, `undefined`, `NaN`, negative zero, and typed-array kinds. It
therefore compares shader strings, resource handles, constants, complete
buffer uploads, uniforms, and draw commands, in addition to the output
snapshots. Initialization has 60 calls, the first frame 224,044, and the second
and third frames 64,003 each. The JSON audit contains all four hashes and
per-method counts.

The same instrumented executions count explicit original object operations.
Initialization uses 31 `defineProperty`, 11 `defineProperties`, and three
`freeze` calls. Cumulative counts after the first frame are 96,031 and 24,011
for the two descriptor functions; later frames add none. Both executions have
zero `setPrototypeOf`, `getPrototypeOf`, `getOwnPropertyDescriptor`,
`getOwnPropertyDescriptors`, and `Object.create` calls in these observations.
These are runtime counts, distinct from the static call-site counts above.

Additional original-versus-port comparisons cover all attributes, indices,
and groups for 22 geometry variants; holes, bevels, and path extrusion; six
curve variants and composite paths; numeric, boolean, string, quaternion, and
cubic animation tracks; clip serialization and legacy keyframe parsing;
actions and grouped bindings; scene, material, and geometry JSON round trips;
light and shadow cloning; raw buffers and typed-array images; the setter
default; color conversion; two-argument video sizing; matrix decomposition;
uniform-group cloning; BatchedMesh matrices and colors; and the original
shader callback cache key. The JSON audit records the complete serialized
output hashes and scenario lists. These checks supplement the full benchmark
output comparison; they do not claim exhaustive coverage of every browser API.

## Validation and timing

Node 24.20.0 with TypeScript 7.0.2 passes the strict command in the README and
all seven shared tests. The tests use output values and counts only. Five
fresh processes using the unchanged timing harness produce 95.497246,
94.659240, 96.437004, 96.307574, and 94.389965 ms per complete steady-state
iteration, with identical checksum bits. The full input is retained under the
approved over-10-ms timing exception. The port does not perform nts compilation
or replace maintainers' gate and measurement work.
