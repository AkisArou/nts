# Synchronous infrastructure questions (#742)

The [inventory](../infrastructure-probes-2026-11-12.tsv) contains thirteen
invocations in seven modules: twelve used the short timeout declarations;
the artifact tool-location query was previously unbounded. Five of the calls
shared comment-changes.ts's single options object.

One infrastructure-probe.ts owner preserves stdin, environment and output
limits. Its five-minute guard is for a wedged tool, not a performance verdict.
It explicitly uses SIGKILL: spawnSync's default SIGTERM can be ignored, leaving
it waiting after its timeout. A supplied-runner control models that case.
A timeout, signal, spawn error, missing status or undeclared exit is a named
tooling-setup instrument failure and publishes its receipt before throwing.
Source/lexer checks explicitly declare which ordinary exits they classify.

commentsOnly and gateScope no longer catch that instrument failure as a
fallback. artifactShadow no longer turns a broken identity query into an
unavailable observation; its shell CLI prints the failure too. Rust lexer
paths are cached per supplied owner, and a failed probe leaves no cached
fallback. No Worker bridge or async API propagation was introduced.

The affected suites passed 97 tests. The initial run passed 95 of 96: the
counted-affinity fixture copied affinity.ts and a handwritten helper list,
missing its newly imported owner. It now stages the module closure. The
post-rebase run passed all 28 probe, affinity and timing controls, followed by
the host audit and strict types (753 modules, no diagnostic increase).

The per-case 30-second bounds in census attempt262.ts, output-oracle.ts,
suites/typescript.ts and conformance outcomes-oracle.ts/outcomes-check.ts
remain product decisions and were not changed. This task owns only the
infrastructure questions and generation precheck instrumentation.

Detailed proof logs and the separately classified fixture-copy list are kept
in ~/.cache/nts-handover/codex-helper/probes-742/.
