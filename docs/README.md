# nts documentation

nts compiles TypeScript ahead of time to native code (through C or LLVM), JVM
bytecode, WebAssembly and Node addons. A compiled program carries no
JavaScript engine, and it behaves like the same program run by node. These
pages describe what nts compiles, how it represents a program, where the
result runs, and how it is held to each standard.

## The bar

- **Faster than node and Bun on every benchmark row, and never behind the
  ahead-of-time compilers:** against node and Bun's JIT a row is won at 0.8×
  their time or better, for now; against Bun's AOT compiler and ScriptC nts is
  faster or ties, a tie being within about 5% in the same sitting, set per row
  from its measured spread. Each row's bar is set again when that row is
  worked on, and meeting it does not end the row: every row is profiled for
  what more nts can do, and is held to nts's own best result as well as to
  theirs. nts also comes as close as it can to each target's own language:
  C++ for native code, Java for the JVM, C++ compiled to Wasm for Wasm.
- **Correct first.** The ECMAScript specification decides what a program
  means, and node what the specification leaves to the host; node is the
  oracle every program is compared with, down to the last digit of a formatted
  number. A construct nts cannot compile is refused by name at build time;
  nothing is compiled wrong on purpose.
- **Clean architecture.** A problem is fixed at its cause; no workaround stands
  in for a fix. Nothing in nts is fixed in place: a slow representation or
  runtime is replaced outright.

## Where to start

- [`plan.md`](plan.md): what is being built now, in what order, and what each
  step waits on. The one page that changes as work goes.
- [`open-questions.md`](open-questions.md): every fundamental question not yet
  decided, with a recommendation for each.
- [`architecture.md`](architecture.md): how nts works, from TypeScript source
  to a binary.

## The pages

| section | what it covers |
|---|---|
| [`language/`](language) | What a program means: the TypeScript nts compiles, feature by feature, and what it does not compile |
| [`foundations/`](foundations) | How each kind of value is represented, and what each operation costs |
| [`targets/`](targets) | Where programs run: native, GTK, Apple, Windows, the JVM and Android, Wasm, Chromium, Node addons |
| [`reference/`](reference) | `nts.config.ts`, the `nts` commands, the web-platform contract |
| [`conformance/`](conformance) | How nts is held to test262, TypeScript's own tests and node's tests |
| [`contributing/`](contributing) | How work is done and landed, and what it has taught |
| [`records/`](records) | Decision records with their evidence, and the notebooks the pages were distilled from |
| [`primitives.md`](primitives.md) | Each primitive operation and what it costs, held by a gate step |

## Elsewhere in the repository

- [`../AGENTS.md`](../AGENTS.md): the rules every contributor follows.
- [`../tests/`](../tests): what nts must pass, one kind per directory.
- [`../benchmarks/`](../benchmarks): what is measured, against node, Bun, C++
  and Java.
- [`../results/`](../results): what the tools measured. Every number these
  pages rely on is there, written by a tool.
- Lanes keep their own notes beside their code, such as
  [`../runtime/chromium/docs/`](../runtime/chromium/docs).

## How these pages are kept

- A page states the current design, the way a specification does: no dates,
  no history, no running log. It changes when a decision changes it.
- `plan.md` is the only page updated as work progresses.
- Numbers are not copied into pages; they live in `results/`.
- Measurements, investigations and long notes go to `records/`.
