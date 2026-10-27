# nts — Native TypeScript

nts compiles TypeScript and TSX ahead of time into native code, JVM bytecode and
WebAssembly. A compiled program carries no JavaScript engine: no interpreter, no
JIT.

## Scope

- **TypeScript as written.** TypeScript's own type checker answers every type
  question -- inference, overloads, narrowing -- so a program means what `tsc`
  says it means.
- **Whole program, ahead of time.** Everything reachable is compiled. A
  construct nts cannot compile yet is refused by name at build time, and a
  value it cannot hold (a BigInt past 128 bits) stops the program by name at
  run time. Nothing is compiled wrong on purpose: a wrong answer is a defect,
  recorded until it is fixed.
- **JavaScript's semantics.** Compiled programs are checked against node, and
  the compiler against test262.
- **Fast.** The aim is to beat node and Bun on every benchmark and to come close
  to hand-written C++ and Java. The latest measurements are in
  [`results/benchmarks/`](results/benchmarks).

nts is early: a growing part of the language compiles today, and the rest is
refused by name.

## Compilation targets

| Target | What it emits |
|---|---|
| Native, through C | C, compiled by clang into executables and libraries |
| Native, through LLVM | LLVM IR, for the same native outputs and for cross targets (iOS, Android) |
| JVM | class files and jars, and DEX for Android |
| WebAssembly | WasmGC modules with their JavaScript glue, for node or the browser |
| Node.js addons | N-API native modules |

Memory follows the target: reference counting with a cycle collector natively,
and the host's own collector on the JVM and WebAssembly.

## Application targets

Products are declared in `nts.config.ts` (`@nts/config`). Applications and
libraries are peers: a shared library another program links against is as
ordinary a product as an app.

| Platform | Products | Through |
|---|---|---|
| Linux | applications, executables, shared and static libraries | GTK |
| macOS | applications, frameworks | Apple's frameworks, via Objective-C |
| iOS | applications, xcframeworks | Apple's frameworks, via Objective-C |
| Windows | applications, DLLs | Win32, WinRT and WinUI 3 |
| Android | applications, AARs | the JVM backend (DEX) |
| JVM | jars | the JVM backend |
| Node.js | native addons | N-API |
| Chromium | applications hosted in Chromium | Blink, called directly |

Beside them: React surfaces that embed in a native application, and a
cross-platform native UI SDK.

## More

- [`docs/README.md`](docs/README.md) indexes the design documents, and
  [`docs/records/`](docs/records) holds each decision with its evidence.
- [`results/`](results) holds what nts's tools measured: benchmarks, test262 and
  the conformance records.
- [`AGENTS.md`](AGENTS.md) is how to work on nts.

## License

[Apache License 2.0](LICENSE).
