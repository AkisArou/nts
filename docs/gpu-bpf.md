# RFC: Multi-Domain Execution for Host, GPU, and BPF

**Status:** Draft  
**Target:** Compiler frontend, HIR, runtime, and code-generation architecture  
**Scope:** Host execution, heterogeneous GPU execution, and Linux eBPF execution  
**Source syntax:** Existing TypeScript-compatible syntax only  
**Out of scope:** Function decorators, `"use ..."` directives, WebGL

---

## 1. Summary

This RFC proposes extending the compiler from a multi-backend compiler into a **multi-domain compiler**.

Currently, source code is conceptually compiled as:

```text
TypeScript
    │
    ▼
   HIR
    │
    ├── LLVM IR → native
    ├── C
    ├── Wasm
    └── JVM bytecode
```

Under this proposal, individual source-level function bodies may belong to different **execution domains**:

```text
                           TypeScript
                               │
                               ▼
                              HIR
                               │
              ┌────────────────┼─────────────────┐
              │                │                 │
              ▼                ▼                 ▼
             HOST             GPU               BPF
              │                │                 │
       ┌──────┼──────┐    GPU-specific HIR      │
       │      │      │         │                 │
       ▼      ▼      ▼         │                 ▼
     LLVM    Wasm    JVM       │             LLVM/BPF
       │                        │                 │
       ▼                 ┌──────┴──────┐          ▼
     native              │             │        eBPF
                        WGSL         SPIR-V        │
                         │             │           ▼
                         ▼             ▼       Linux kernel
                      WebGPU        Vulkan
```

The key abstraction is therefore not the final instruction format.

The key abstraction is:

```text
Execution Domain
```

The initial execution domains are:

```text
Host
GPU
BPF
```

A single source module may contain code for multiple domains.

The compiler partitions the module, validates each domain independently, generates the required binaries/assets, and generates the host-side glue required for communication between domains.

---

## 2. Motivation

The compiler already supports multiple host execution targets:

```text
LLVM/native
C
Wasm
JVM bytecode
```

These targets primarily answer the question:

> Where does normal application code execute?

GPU and eBPF introduce a different question:

> Which computational environment should execute this particular function?

A GPU compute function is not an ordinary host function.

An eBPF program is not an ordinary host function.

These functions have different memory spaces, different available operations, different calling conventions, and different lifetime/execution models.

The compiler should model those distinctions explicitly.

---

## 3. Terminology

### 3.1 Host

The normal application environment.

Examples:

```text
native x86-64
native ARM64
WebAssembly
JVM
```

Host code may:

```text
allocate normal application memory
perform OS calls
create windows
perform networking
access files
allocate GPU resources
dispatch GPU work
load and attach eBPF programs
read data emitted by eBPF programs
```

---

### 3.2 GPU

A graphics or compute device execution environment.

GPU code may execute as:

```text
WGSL through WebGPU

or

SPIR-V through Vulkan

or, in future backends:

MSL through Metal
HLSL/DXIL through D3D12
```

GPU functions execute in massively parallel device execution contexts.

A GPU function is called a **GPU kernel** where appropriate, but the word "kernel" alone MUST NOT mean the GPU domain because it conflicts with the operating-system kernel.

---

### 3.3 BPF

A restricted program executing through an eBPF runtime, initially the Linux kernel eBPF implementation.

BPF functions execute at specific kernel hooks such as:

```text
XDP
traffic control
tracepoints
kprobes
uprobes
cgroups
LSM hooks
socket hooks
```

BPF code is verified before execution.

BPF code cannot be treated as arbitrary kernel-native code.

---

## 4. Design Principle

Backend format and execution domain are separate concepts.

For example:

```text
Host
 └── LLVM

GPU
 ├── WGSL
 └── SPIR-V

BPF
 └── eBPF
```

SPIR-V therefore MUST NOT define GPU language semantics.

The GPU domain defines its own semantic model.

SPIR-V and WGSL are lowerings of that semantic model.

---

## 5. Source-Level GPU Functions

GPU programs are introduced through compiler-recognized intrinsic constructors.

Example:

```ts
const simulate = gpu.compute(
  {
    workgroupSize: [256, 1, 1],
  },

  (particles: GpuBuffer<Particle>, dt: f32) => {
    const i = gpu.globalId.x;

    particles[i].velocity.y -= 9.81 * dt;

    particles[i].position += particles[i].velocity * dt;
  },
);
```

`gpu.compute()` is treated specially by the compiler.

It is not an ordinary runtime higher-order function.

Its callback body is extracted and compiled into the GPU execution domain.

---

## 6. GPU Kernel Type

The value returned from `gpu.compute()` is not a normal callable function.

Conceptually:

```ts
GpuComputeKernel<(particles: GpuBuffer<Particle>, dt: f32) => void>;
```

Therefore this is invalid:

```ts
simulate(particles, dt);
```

Diagnostic:

```text
error GPU001:

GpuComputeKernel cannot be invoked as a host function.

Use gpu.dispatch() to execute GPU kernels.
```

Execution instead occurs through:

```ts
await gpu.dispatch(
  simulate,
  {
    x: Math.ceil(particles.length / 256),
    y: 1,
    z: 1,
  },
  particles,
  dt,
);
```

---

## 7. GPU Resource Types

The language/runtime introduces GPU-specific resource types.

Initial examples:

```ts
GpuBuffer<T>;
GpuTexture1D<T>;
GpuTexture2D<T>;
GpuTexture3D<T>;
GpuSampler;
GpuStorageTexture<T>;
GpuUniformBuffer<T>;
```

These values represent resources owned or visible by the GPU runtime.

They MUST NOT be interchangeable with ordinary host pointers or arrays.

For example:

```ts
function cpuFunction(data: Float32Array) {}

const kernel = gpu.compute(
    (data: GpuBuffer<f32>) => {
        ...
    }
);
```

The distinction is intentional.

---

## 8. GPU Memory Transfer

Host code may explicitly create and transfer resources.

Example:

```ts
const input = await gpu.upload(values);

const output = gpu.alloc<f32>(values.length);

await gpu.dispatch(
  calculate,
  {
    x: divCeil(values.length, 256),
  },
  input,
  output,
);

const result = await gpu.download(output);
```

The initial implementation SHOULD favor explicit transfers.

Automatic host/device transfer may be added later.

Explicit transfer provides predictable performance and semantics.

---

## 9. GPU Builtins

GPU-only intrinsics MAY include:

```ts
gpu.globalId;
gpu.localId;
gpu.workgroupId;
gpu.numWorkgroups;
gpu.localIndex;

gpu.barrier();
gpu.storageBarrier();
```

and GPU-compatible atomic operations.

For example:

```ts
const sum = gpu.compute(
    (values: GpuBuffer<f32>) => {
        const index = gpu.globalId.x;

        ...
    }
);
```

Access to these intrinsics outside a GPU function is a compile-time error.

---

## 10. GPU Semantic Restrictions

GPU functions MUST use a statically verifiable GPU-compatible subset of the language.

The initial implementation SHOULD disallow:

```text
arbitrary host pointers
normal heap allocation
host OS APIs
file IO
network sockets
exceptions
reflection
JVM objects
arbitrary JavaScript objects
host callbacks
async/await inside a kernel
unbounded recursion
```

Supported constructs MAY include:

```text
scalar arithmetic
vectors
matrices
fixed-layout structures
bounded loops
conditionals
GPU resources
GPU atomics
GPU synchronization
GPU-compatible helper functions
```

---

## 11. GPU-Compatible Helper Functions

A GPU kernel may call an ordinary source function if the compiler can instantiate that function for the GPU domain.

Example:

```ts
function gravity(velocity: Vec3, dt: f32): Vec3 {
  return velocity + vec3(0, -9.81, 0) * dt;
}

const simulate = gpu.compute((particles: GpuBuffer<Particle>, dt: f32) => {
  const i = gpu.globalId.x;

  particles[i].velocity = gravity(particles[i].velocity, dt);
});
```

The compiler MAY generate:

```text
gravity.host
gravity.gpu
```

provided `gravity()` is valid in both domains.

Domain propagation occurs through the call graph.

---

## 12. GPU Closure Capture

Version 1 SHOULD be conservative.

Compile-time immutable scalar/POD constants MAY be captured.

Example:

```ts
const gravity = 9.81;

const simulate = gpu.compute(
    (particles: GpuBuffer<Particle>) => {
        ...
        velocity.y -= gravity;
    }
);
```

The compiler may:

```text
inline gravity

or

lower gravity to a GPU constant/uniform
```

Arbitrary host object capture MUST be rejected.

Example:

```ts
const database = new Database();

const kernel = gpu.compute(() => {
  database.query();
});
```

Diagnostic:

```text
error GPU014:

GPU kernel captures host-only value `database`.

Host objects are not accessible from the GPU execution domain.
```

Future versions MAY automatically lower compatible captured POD values into uniforms or push constants.

---

## 13. Portable GPU Profile

The compiler SHOULD define a portable baseline GPU semantic profile.

The baseline SHOULD approximately correspond to functionality available across modern WebGPU/Vulkan/Metal/D3D12 implementations.

Programs using only this profile SHOULD be portable.

Example:

```ts
const kernel = gpu.compute(...);
```

MAY be compiled for:

```text
Web
Windows
Linux
Android
macOS
iOS
```

subject to runtime hardware/API availability.

---

## 14. GPU Target Selection

### Web

```text
GPU-HIR
   │
   ▼
 WGSL
   │
   ▼
Browser WebGPU
```

Host:

```text
HIR
 │
 ▼
Wasm
```

Final application:

```text
app.wasm
GPU WGSL payload
small WebGPU runtime/glue
```

---

### Windows

Preferred native routes:

```text
GPU-HIR
   │
   ├── WebGPU-native → D3D12
   │
   └── SPIR-V → Vulkan
```

---

### Linux

Preferred:

```text
GPU-HIR
   │
   └── SPIR-V → Vulkan
```

A native WebGPU implementation MAY alternatively be used.

---

### Android

Preferred:

```text
GPU-HIR
   │
   └── SPIR-V → Vulkan
```

A native WebGPU implementation MAY alternatively be used.

---

### macOS / iOS

Preferred:

```text
GPU-HIR
   │
   └── Metal backend
```

Possible implementations include:

```text
GPU-HIR
   ↓
WGSL
   ↓
native WebGPU implementation
   ↓
Metal
```

or:

```text
GPU-HIR
   ↓
SPIR-V
   ↓
SPIR-V → MSL translation
   ↓
Metal
```

Direct Metal lowering may be added later.

---

## 15. GPU Runtime Portability

Two implementation modes are proposed.

### Mode A — Portable WebGPU Runtime

The compiler emits WGSL and uses a WebGPU implementation on every platform.

Conceptually:

```text
                WGSL
                  │
          WebGPU abstraction
                  │
       ┌──────────┼─────────┐
       │          │         │
     D3D12      Metal     Vulkan
```

Advantages:

```text
one shader representation
one runtime API
strong portability model
less compiler backend work
```

---

### Mode B — Direct Native GPU Backends

The compiler generates platform-native representations.

```text
GPU-HIR
   ├── SPIR-V → Vulkan
   ├── MSL → Metal
   └── DXIL → D3D12
```

Advantages:

```text
greater control
potentially smaller runtime
backend-specific optimization
direct access to platform-specific features
```

Mode A is RECOMMENDED for the initial implementation.

Mode B MAY be added incrementally.

---

## 16. GPU Capability Model

The presence of a GPU MUST NOT be assumed.

Host code must be able to query capabilities.

Example:

```ts
const adapter = await gpu.requestAdapter();

if (!adapter) {
    ...
}
```

Possible capability API:

```ts
adapter.features;
adapter.limits;
adapter.backend;
adapter.vendor;
adapter.device;
```

Features SHOULD be represented independently of the physical graphics API wherever possible.

---

# 17. BPF Execution Domain

The BPF domain allows restricted source functions to compile into eBPF programs.

Initial platform:

```text
Linux
```

Example:

```ts
const firewall = bpf.xdp((ctx: XdpContext): XdpAction => {
  const packet = ctx.packet.ipv4();

  if (!packet) return XDP_PASS;

  if (blockedAddresses.has(packet.source)) {
    return XDP_DROP;
  }

  return XDP_PASS;
});
```

---

## 18. BPF Program Type

The value produced by `bpf.xdp()` is not directly callable.

Conceptually:

```ts
BpfProgram<"xdp", (XdpContext) => XdpAction>;
```

This is invalid:

```ts
firewall(ctx);
```

The host application instead loads/attaches the program:

```ts
const link = await bpf.attach(firewall, {
  interface: "eth0",
});
```

---

## 19. BPF Compilation Pipeline

```text
TypeScript closure
       │
       ▼
      HIR
       │
       ▼
BPF semantic validation
       │
       ▼
 BPF-specific HIR
       │
       ▼
    LLVM IR
       │
       ▼
LLVM BPF backend
       │
       ▼
eBPF object
ELF + BTF + relocations
       │
       ▼
userspace loader
       │
       ▼
Linux bpf() interface
       │
       ▼
kernel verifier
       │
       ▼
attach to hook
       │
       ▼
kernel execution
```

Classic BPF is not an intermediate representation in this pipeline.

eBPF is the generated target instruction set.

---

## 20. Relationship Between Host and BPF

The host portion acts as the **control plane**.

The BPF portion acts as an event-driven **kernel datapath/program**.

Example:

```text
                 HOST
                  │
            configure map
                  │
                  ▼
             BPF map
                  ▲
                  │
               lookup
                  │
                 BPF
                  │
            packet/event
                  │
                  ▼
             Linux kernel
```

---

## 21. BPF Maps

Typed BPF maps SHOULD be exposed as first-class compiler/runtime concepts.

Examples:

```ts
const connections = bpf.hashMap<IPv4Address, ConnectionInfo>({
  maxEntries: 65536,
});
```

Other possible map abstractions:

```ts
bpf.array<T>();
bpf.perCpuArray<T>();
bpf.hashMap<K, V>();
bpf.lruHashMap<K, V>();
bpf.ringBuffer<T>();
```

The same declaration is visible to:

```text
host code

and

BPF code
```

but operations available in each domain may differ.

---

## 22. BPF Event Streaming

Kernel programs SHOULD be able to efficiently send structured events to host code.

Example:

```ts
interface ProcessEvent {
  pid: u32;
  uid: u32;
  timestamp: u64;
}

const events = bpf.ringBuffer<ProcessEvent>();

const program = bpf.tracepoint(
  "sched",
  "sched_process_exec",

  (ctx) => {
    events.emit({
      pid: bpf.pid(),
      uid: bpf.uid(),
      timestamp: bpf.time(),
    });
  },
);
```

Host:

```ts
for await (const event of events) {
  console.log(event.pid);
}
```

This allows the compiler to generate the layout and serialization contract shared between kernel and host.

---

## 23. BPF Semantic Restrictions

BPF programs execute under the requirements of the target verifier.

The compiler MUST reject unsupported constructs before producing bytecode whenever possible.

Initially disallowed:

```text
general heap allocation
garbage-collected objects
exceptions
async/await
unbounded recursion
arbitrary host pointers
normal libc calls
normal syscalls
arbitrary kernel calls
dynamic dispatch
reflection
general strings
```

Allowed functionality depends on the BPF program type.

Examples:

```text
XDP has networking-specific operations

tracepoints have event context

LSM has security hook context

cgroup programs have cgroup-specific context
```

---

## 24. BPF Helpers

Kernel functionality exposed to BPF MUST be represented as typed compiler/runtime intrinsics.

Example:

```ts
bpf.pid();
bpf.uid();
bpf.time();
```

The available functions depend on the BPF program type.

The compiler SHOULD reject helpers that are invalid for the selected program type.

---

## 25. BPF Verifier Awareness

The compiler SHOULD attempt to detect verifier failures statically.

For example:

```ts
const p = bpf.xdp((ctx) => {
  const packet = ctx.data;

  return packet[1000000];
});
```

should preferably produce a source-level diagnostic instead of waiting for the Linux verifier.

Example:

```text
error BPF031:

Packet access cannot be proven to be within bounds.

The Linux BPF verifier would reject this access.
```

The kernel verifier remains authoritative.

---

## 26. eBPF Is Not a Replacement for Syscall Bindings

Normal host code continues to use generated Linux bindings.

Example:

```ts
const fd =
    linux.open(...);
```

This represents:

```text
userspace
   │
 syscall
   ▼
kernel operation
   │
   ▼
userspace
```

BPF instead represents:

```text
install program
      │
      ▼
 kernel hook
      │
 event occurs
      │
      ▼
 execute BPF
```

Both mechanisms are required.

---

## 27. Example: System Tracer

```ts
interface FileOpenEvent {
  pid: u32;
  timestamp: u64;
}

const events = bpf.ringBuffer<FileOpenEvent>();

const fileOpen = bpf.tracepoint(
  "syscalls",
  "sys_enter_openat",

  (ctx) => {
    events.emit({
      pid: bpf.pid(),
      timestamp: bpf.time(),
    });
  },
);

async function main() {
  const attachment = await bpf.attach(fileOpen);

  for await (const event of events) {
    console.log(event.pid, event.timestamp);
  }
}
```

Compilation:

```text
                         module
                           │
                           ▼
                          HIR
                    ┌──────┴──────┐
                    │             │
                   HOST          BPF
                    │             │
                    ▼             ▼
                  LLVM          LLVM
                    │             │
                    ▼             ▼
                 native         eBPF
                    │             │
                    └──────┬──────┘
                           ▼
                    packaged program
```

---

# 28. Domain Communication

Direct cross-domain function calls are forbidden.

The supported communication mechanisms are explicitly modeled.

### Host → GPU

```text
buffer upload
resource binding
uniforms
dispatch
```

### GPU → Host

```text
GPU buffers
readback
completion/fence events
```

### Host → BPF

```text
program loading
attachment
map updates
configuration
```

### BPF → Host

```text
maps
ring buffers
perf/event buffers
counters
```

### GPU ↔ BPF

No direct calls.

Communication MUST be mediated by host code.

---

## 29. Domain Call Matrix

```text
FROM \ TO      Host       GPU       BPF

Host           CALL       DISPATCH  LOAD/CONFIGURE

GPU            NO         CALL      NO

BPF            NO         NO        restricted calls
```

A normal language call is only available within compatible execution domains.

---

## 30. HIR Representation

HIR functions SHOULD carry explicit execution-domain information.

Conceptually:

```text
HIRFunction {
    name
    parameters
    returnType
    blocks

    domain:
        Host
        GPUCompute
        GPUVertex
        GPUFragment
        BPFXdp
        BPFTracepoint
        BPFKprobe
        BPFUprobe
        BPFLSM
        ...
}
```

The source expression:

```ts
const simulate = gpu.compute(options, fn);
```

causes `fn` to become:

```text
domain = GPUCompute
```

The source expression:

```ts
const firewall = bpf.xdp(fn);
```

causes `fn` to become:

```text
domain = BPFXdp
```

---

## 31. Domain-Specific HIR Validation

After common HIR generation:

```text
                   Common HIR
                       │
          ┌────────────┼─────────────┐
          │            │             │
          ▼            ▼             ▼
     Host verifier  GPU verifier  BPF verifier
          │            │             │
          ▼            ▼             ▼
       Host HIR      GPU HIR       BPF HIR
```

This permits shared optimization passes before domain-specific lowering.

---

## 32. GPU-HIR

GPU-specific operations SHOULD remain independent of WGSL and SPIR-V syntax.

Example:

```text
gpu.func simulate {
    workgroup_size [256, 1, 1]

    %gid =
        gpu.builtin.global_id

    %index =
        vector.extract %gid, 0

    %particle =
        gpu.buffer.load %particles[%index]

    ...

    gpu.buffer.store
        %particles[%index],
        %particle

    return
}
```

Then:

```text
GPU-HIR
   │
   ├── WGSL
   ├── SPIR-V
   ├── future MSL
   └── future DXIL
```

---

## 33. BPF-HIR

BPF-specific HIR SHOULD represent verifier-relevant semantics explicitly.

Possible operations:

```text
bpf.context.load
bpf.map.lookup
bpf.map.update
bpf.ringbuf.reserve
bpf.ringbuf.submit
bpf.helper.call
bpf.packet.bounds_check
```

This makes verifier-aware analysis easier than relying solely on generic LLVM IR.

---

## 34. Packaging

A compiled application may contain multiple executable artifacts.

Example native Linux application:

```text
application
├── native host executable
├── embedded SPIR-V kernels
├── embedded eBPF objects
└── domain metadata
```

Example web application:

```text
application
├── app.wasm
├── embedded/generated WGSL
└── WebGPU runtime glue
```

The compiler MAY embed device/kernel binaries directly inside the host executable.

---

## 35. Reflection Metadata

The compiler SHOULD emit metadata describing embedded programs.

Example:

```text
GpuProgram {
    name
    kind
    entryPoint
    requiredFeatures
    workgroupSize
    bindings
}

BpfProgram {
    name
    programType
    hook
    maps
    requiredKernelFeatures
}
```

The host runtime can use this metadata to instantiate programs.

---

## 36. Platform Matrix

Initial intended support:

| Domain      | Web |  Windows |    Linux |                Android |    macOS |      iOS |
| ----------- | --: | -------: | -------: | ---------------------: | -------: | -------: |
| Host/native |   — |      Yes |      Yes |                    Yes |      Yes |      Yes |
| Host/Wasm   | Yes | optional | optional |               optional | optional | optional |
| Host/JVM    |   — |      Yes |      Yes |                    Yes |     Yes* |        — |
| GPU         | Yes |      Yes |      Yes |                    Yes |      Yes |      Yes |
| Linux eBPF  |  No |       No |      Yes | privileged/system only |       No |       No |

`*` JVM availability depends on runtime/deployment model.

The GPU row indicates architectural support, not guaranteed GPU availability on every device.

---

## 37. BPF Portability

The initial BPF specification is explicitly Linux-specific.

Future implementations MAY introduce:

```text
bpf.linux.*
bpf.windows.*
```

or a limited portable BPF subset.

Linux-specific program types MUST NOT automatically be assumed to exist on other kernels.

---

## 38. Security Model

GPU and BPF execution both involve externally validated execution environments.

The compiler MUST preserve target safety requirements.

For GPU programs:

```text
validate resource accesses where possible
validate layout
validate supported features
respect backend limits
```

For BPF programs:

```text
generate verifier-compatible code
never bypass target verification
model pointer provenance
model map/value lifetime
model bounds checks
model helper restrictions
```

The Linux verifier remains the final authority on whether an eBPF program may load.

---

## 39. Compiler Diagnostics

Errors SHOULD be reported in source-language terminology.

Bad:

```text
R2 type=scalar_value expected=ptr_to_map_value
```

Preferred:

```text
error BPF042:

`entry` may be null at this point.

A BPF map lookup can fail.

Check the result before dereferencing it.

    const entry = counters.get(key);
    entry.count++;
    ^^^^^
```

Underlying verifier diagnostics MAY be shown as supplemental information.

---

## 40. Recommended Initial Implementation Order

### Phase 1 — execution-domain infrastructure

Implement:

```text
HIR execution-domain field
domain call graph
domain validation framework
non-callable program value types
```

---

### Phase 2 — WebGPU compute

Implement:

```ts
gpu.compute();
GpuBuffer<T>;
gpu.alloc();
gpu.upload();
gpu.download();
gpu.dispatch();
gpu.globalId;
```

Lower:

```text
GPU-HIR → WGSL
```

Use WebGPU as the runtime API.

---

### Phase 3 — Native GPU

Use a native WebGPU runtime initially.

Support:

```text
Windows → D3D12
macOS/iOS → Metal
Linux → Vulkan
Android → Vulkan
```

This gives the same GPU programming model across native and web.

---

### Phase 4 — Direct SPIR-V

Add:

```text
GPU-HIR → SPIR-V
```

for direct Vulkan applications.

This permits:

```text
Windows/Vulkan
Linux/Vulkan
Android/Vulkan
```

and optionally Vulkan portability layers elsewhere.

---

### Phase 5 — Linux eBPF

Implement:

```ts
bpf.xdp();
bpf.hashMap();
bpf.array();
bpf.ringBuffer();
bpf.attach();
```

Compiler:

```text
BPF-HIR
   ↓
LLVM IR
   ↓
LLVM BPF backend
   ↓
ELF/eBPF/BTF
```

Runtime:

```text
load
verify
attach
detach
map access
ring-buffer access
```

---

### Phase 6 — Additional BPF program types

Add incrementally:

```text
tracepoints
kprobes
uprobes
cgroup
socket programs
traffic control
LSM
```

Each program type gets its own typed context and permitted intrinsic set.

---

## 41. Recommended Public API Shape

GPU:

```ts
const simulate = gpu.compute(
    {
        workgroupSize: [256, 1, 1]
    },
    (
        particles: GpuBuffer<Particle>,
        dt: f32
    ) => {
        const i = gpu.globalId.x;

        ...
    }
);

const particles =
    gpu.alloc<Particle>(1_000_000);

await gpu.dispatch(
    simulate,
    {
        x: divCeil(
            particles.length,
            256
        )
    },
    particles,
    0.016
);
```

BPF:

```ts
const events = bpf.ringBuffer<Event>();

const monitor = bpf.tracepoint("sched", "sched_process_exec", (ctx) => {
  events.emit({
    pid: bpf.pid(),
    timestamp: bpf.time(),
  });
});

const link = await bpf.attach(monitor);

for await (const event of events) {
  console.log(event);
}
```

Normal host code requires no special wrapper:

```ts
function application() {
    ...
}
```

The absence of `gpu.*` or `bpf.*` compilation constructs means the function belongs to the normal Host domain.

---

## 42. Final Architecture

The intended architecture is:

```text
                              TypeScript
                                  │
                                  ▼
                                 HIR
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
         HOST                    GPU                     BPF
          │                       │                       │
   ┌──────┼──────┬──────┐       GPU-HIR                 BPF-HIR
   │      │      │      │        │                       │
   ▼      ▼      ▼      ▼        ├──────────┐            ▼
 LLVM     C     Wasm    JVM      WGSL      SPIR-V       LLVM
   │                            │            │            │
   ▼                            ▼            ▼            ▼
native                       WebGPU        Vulkan        eBPF
                                │                          │
                    ┌───────────┼───────────┐              ▼
                    │           │           │        Linux kernel
                  D3D12       Metal       Vulkan
                    │           │           │
                 Windows    macOS/iOS   Linux/Android
```

For browser deployment:

```text
              TypeScript
                  │
                  ▼
                 HIR
           ┌──────┴──────┐
           │             │
          HOST          GPU
           │             │
           ▼             ▼
          Wasm          WGSL
           │             │
           └──────┬──────┘
                  ▼
                Web
               WebGPU
```

For Linux systems software:

```text
                     TypeScript
                         │
                         ▼
                        HIR
           ┌─────────────┼─────────────┐
           │             │             │
          HOST          GPU           BPF
           │             │             │
           ▼             ▼             ▼
         LLVM         SPIR-V         eBPF
           │             │             │
           ▼             ▼             ▼
       x86/ARM         Vulkan      Linux kernel
```

---

## 43. Core Design Rule

The language should expose **execution domains**, not backend file formats.

Users write:

```ts
gpu.compute(...)
```

not:

```ts
spirv.function(...)
```

and:

```ts
bpf.xdp(...)
```

not:

```ts
ebpf.bytecode(...)
```

Backend formats remain compiler implementation details.

This permits GPU programs to move between:

```text
WGSL
SPIR-V
MSL
DXIL
```

without changing application source.

Likewise, future BPF execution environments may be added without redefining the source-level domain model.

---

## 44. Long-Term Direction

The compiler evolves from:

```text
one language → many host backends
```

into:

```text
one program
    │
    ├── application code → host CPU/runtime
    ├── parallel code → GPU
    └── event/datapath code → operating-system kernel
```

The primary feature is therefore **heterogeneous multi-domain compilation**, rather than merely adding SPIR-V or eBPF as additional output formats.

The two pieces I'd design especially carefully before implementing this are GPU-HIR's type/memory model and BPF-HIR's verifier-aware pointer model. Those decisions will determine whether the implementation stays clean when the feature set grows.
