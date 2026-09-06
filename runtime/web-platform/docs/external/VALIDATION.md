# Validation record

Executed in this authoring environment on **2026-09-06**. Results apply to the source
files in this archive, not to a compiled NTS program or Android application.

## Environment

| Tool | Observed version |
|---|---|
| Node.js | v22.16.0 |
| TypeScript | 5.8.3 |
| Node development declarations | @types/node 25.1.0 |
| Java runtime / javac | OpenJDK 21.0.11 / javac 21.0.11 |
| Java compilation target | `--release 8` |
| OpenSSL test-fixture utility | 3.5.5 |

The installed tools were used locally. No npm dependency installation from a clean
network environment was tested. Runtime code has no npm dependencies. The supplied
package.json pins the two direct development dependencies; transitive type-only
dependencies are not vendored and a package-lock is not included.

## Final execution results

| Command | Result | Evidence |
|---|---|---|
| `npm run check` | PASS, exit 0 | Shared source and Android TS adapter with ESNext only, no DOM/Node ambient types; separate Node adapter and example check. |
| `npm test` | **80/80 pass**, 0 skipped, exit 0 | TypeScript compilation followed by local deterministic, differential and real Node network tests. |
| `npm run audit` | PASS, exit 0 | AST scan of 31 shared TS files, 0 listed structural violations. |
| `bash tools/test-java.sh` | **11/11 pass**, exit 0 | Real JVM TCP/TLS, policy, cancellation, callback-lane and lifecycle tests. |
| `bash tools/build-java.sh` | PASS, exit 0 | Java primitive implementation compiled with release-8 API/language target and warnings treated as errors. |
| `node tools/test-upstream.mjs` | **8/9 pass**, 1 failure, exit 1 | Two complete unchanged WPT files, content hashes verified first. |

Raw command output is retained under [test-results](test-results/). A machine-readable
summary is in [validation.json](validation.json). Test durations in raw output are
ordinary test-run timings, not performance benchmarks. There were no retries hidden
inside this final test execution and no skipped local tests.

### What the 80 local TS/Node tests exercise

Headers, body ownership, stream locking and cancellation, clone teeing, abort races,
UTF-8 validation/differential cases, forms and multipart parsing, event ordering,
HTTP redirects and request replay, incremental HTTP parsing, malformed framing,
chunked uploads/downloads, trailers, pool reuse and shutdown, read/connect/header
failures, gzip/deflate/Brotli, independent WebSocket peer framing, client masking,
fragmentation and control frames, payload limits, clean/unclean close, and HTTPS/WSS
certificate and hostname checks.

The network test process replaces host `globalThis.fetch` and `globalThis.WebSocket`
with throwing functions. Shared semantics are not fulfilled by those globals.
Node's HTTP servers and native TLS are used as peers/primitives, not as a delegated
Fetch or WebSocket implementation. Host Headers and UTF-8 APIs are used in selected
core tests as differential oracles only.

### What the Java tests exercise

TCP reads/writes and EOF, 200 repeated round trips, callback executor identity,
overlapping-read rejection, close interrupting blocked I/O, cleartext policy refusal,
policy exceptions releasing capacity, connection limits, secure-random primitive
smoke behavior, timer delivery/cancellation races, private-root TLS success, untrusted
certificate rejection, hostname mismatch rejection and stalled-handshake cleanup.
These tests run the real platform primitives directly; they do not run TypeScript
compiled to JVM bytecode or the Android-specific NetworkSecurityPolicy factory.

### Visible upstream failure

`headers-combine.any.js`: **6/6** pass.

`headers-normalize.any.js`: **2/3** pass. The constructor test uses a JavaScript
record/dictionary initializer, which this typed profile does not accept. It fails
with `TypeError: entries is not iterable`. Append and set normalization tests pass.

The runner preserves this failure and exits 1. It does not rewrite upstream tests,
wrap the implementation to convert the dictionary, or treat the missing feature as
passing. The runner implements only the synchronous assertion API required by those
two files; it is not the upstream WPT testharness or a full WPT environment.

## Not executed / not certified

* NTS HIR verification, LLVM/native output, JVM bytecode output, generated ABI glue,
  existing project URL-parser integration, active libuv environment integration.
* Android Gradle/SDK compilation, AndroidNetworking factory execution, D8/R8 release
  builds, emulator/device execution or lifecycle/connectivity instrumentation.
* The repository's complete pinned Node v24.20.0 suite, full WPT, Autobahn, large-scale
  fuzzing, independent security audit or comparative throughput/memory benchmarks.

The Node adapter is a working Node-host primitive provider. The Android bridge is
implemented and its Java I/O code is tested on a desktop JVM. Neither statement means
that the NTS compiler/runtime glue has already been completed. The local agents must
perform the downstream gates in [INTEGRATION](INTEGRATION.md).
