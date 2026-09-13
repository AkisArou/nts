# C calling TypeScript

`./build.sh` compiles the TypeScript, links a plain C caller, and runs it.
Build the compiler first with `cargo build --release -p nts-cli`.

The caller includes generated `program.h`. It declares the actual C symbols
(including `bool_` for TypeScript's `bool`) and checked object layouts. There
are no hand-written prototypes.

```text
add(2, 3)         = 5
clamp(42, 0, 10)  = 10
bool_(false)      = 1
greetLength(7)    = 4
greet: UTF-16 length = 6
counted(3)       = 0 1 2; done
makePoint(7)     = (7, 14)
later: state before checkpoint = 0
later: state after  checkpoint = 1
later: value                   = 42
```

## Using the generated header

`nts emit-c <project> --out <directory>` writes `program.h` beside `program.c`
and the runtime support files. Compile callers as C11. Regenerate the header
and implementation together when the TypeScript changes.

Object parameters have aliases named `<export>_<parameter>_t`; object returns
use `<export>_return_t`. Thus callers write `sumOf_o_t` and
`makePoint_return_t`, without depending on an internal `NtsObj_TypeN` name.
If an alias collides with another C identifier, the header adds a numeric suffix.
The declarations name the emitted C symbol; a comment identifies its TypeScript
export, including re-export aliases.

The struct definitions and their size/offset assertions come from the same
layout emission as `program.c`. Reading `point->x` uses that checked layout.
Numeric fields exposed to native callers retain their declared width; the
optimizer cannot assume only TypeScript code writes them. Managed pointers
still require the runtime's allocation and lifetime discipline.

The entry modules' emitted functions are declared; imported helpers and refused
bodies are omitted. If module-level initialization is needed, the header also
declares its initializer, which an embedder calls once before other exports.

## Driving promises

Call the async export, run `nts_checkpoint()`, then inspect
`nts_promise_state()` and `nts_promise_value()`. State 0 means pending, 1 means
fulfilled, and 2 means rejected. A checkpoint drains microtasks; asynchronous
I/O also requires a host event loop.

`later` contains an `await`, so its state changes across the checkpoint. An
async function without a suspension can already be settled when it returns.

## Managed inputs and generators

C constructs strings with `nts_string_from_utf8(bytes, length)` and numeric
arrays with `nts_array_of_numbers(length)`, accessing arrays via `NTS_ITEMS`.
The example constructs a Unicode string and passes it through `greet`. Objects
can be obtained through TypeScript factories such as `makePoint`.

For synchronous generators, `<export>_next(frame, &value)` returns true for each
yield and false after completion. Completion leaves the output unchanged and
repeated calls stay completed. The frame is borrowed by next; release it when
finished. Managed yielded values are borrowed until the next step or frame
release; retain a value if it must outlive that interval. Like `for...of`, this
interface discards the generator's final return value and supplies no next input.
There is no allocation per synchronous step. Async-generator stepping is not
exposed by this header yet.

A scalar-only library links without `nts_runtime.c`; managed exports require it.

Do not compile `quickjs/*.c` separately: `nts_runtime.c` includes those sources.
The build script carries the working link command.

TypeScript calling C is a separate capability. The `c-from-ts` example next
door still needs the native ABI and ownership language surface described in
`docs/native-interop.md`.
