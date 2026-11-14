# Command-first Git forwarders — #770

The source audit previously returned no Git invocation for the benchmark helper
shape `command(root, "git", argv)`, which forwarded those arguments to
`spawnSync` unchanged. It now takes command, arguments and root; both Git
argument vectors use the existing `gitArguments` owner.

The audit enforces a local convention: a function forwarding its own parameter
directly to child_process spawn/execFile takes a required identifier command
first and uses ordinary call syntax. Constructors/accessors cannot own these
forwarders; known local forwarders used with `new` refuse. Parameter-pattern
leaves retain lexical identity, so destructured shadows cannot borrow imported
reader/process ownership. Ordinary string data gains no command meaning.
The only additional nonconforming forwarder found was Chromium's label-first
verifier helper. Its helper and three callers were mechanically reordered;
no Chromium run occurred.

Base `f373d495138bd19dd77815d0d40519f1250ac8dc`; source/proof `1e5f426647a81b4a284e2a1448dd8139eb800fe8`. The
[machine companion](git-forwarders-770.json) authenticates every changed source
at the baseline, two corrective boundaries and final proof.

Canonical run `here-1e5f426647a8-1794627269055`: 16 PASS steps, canonical environment,
no experiments, scope cleanup and diagnostics complete. Tooling 2348
passed/0 failed/2 TODOs; native 3047
passed/0 failed/8 ignored across
55 binaries and 18 doctest crates.
Actual `inner.ts --no-agree`: fmt 3 s, Clippy 1 s,
build 0 s, tests 361 s, all PASS.
Runner wall 560.649 s and CLI wall 566 s
are distinct; summed admission wait 329.249 s may overlap execution.

Focused controls pass 171/171; the full parsed sweep
finds 262 protected Git sites and zero unprotected sites, including all three
session calls. Actual private-repository controls compare index bytes and all
write statistics with optional locking enabled: the unprotected control forces
a refresh, the protected arm preserves the index, and mutation locks still
allow a commit. Exact full/unplaced/policy arrays remain 178/142/36, equal to
baseline with no census problems.

The old/current original-shape reduction is component evidence against fixed
current dependencies, not an entire old checkout or a historical collision
attribution. The first sweep, pinned array-hole implementation failure, peer
constructor/setter finding and private writer setup error remain separate from
the accepted proof. There is no deliberate load or performance claim.

The companion authenticates 182 artifacts (6,356,274 bytes)
and 44 source receipts. Only this issue's scratch folder is retained;
its keep entry ends when #770 closes.
