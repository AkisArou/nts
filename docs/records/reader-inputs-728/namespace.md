# Declared fixture data namespaces: #728

The namespace slice implements the four reviewed data-ownership rules before
any corpus reader is converted. The graph distinguishes data membership from
module ownership. `dataDirectory(new URL(..., import.meta.url))` is an identity
brand recognized through its lexical owner, including aliases and namespace
bindings; a shadow or lookalike is not that owner. Other source languages can
supply the same detached declaration rows.

The copier accepts an already-populated private directory only at an exact
declared data namespace. Its manifest names the relative namespace, the
declaring readers and the fixture owner. Entries, imports and unbranded URL
modules retain production bytes. Without a grant, every tracked data member is
copied. Unknown, missing, overlapping and symlinked grants fail before copying.
A repeated staging call must repeat its earlier grant; omission cannot replace
private data while leaving a manifest that still claims that data owner.

## Selection and switch-off comparison

The base is `972360283d344e74548d80b03d604b97d437394e`. The measured namespace
pin is `e2f119663683adb866a88ce572b2f3bbf70a6dca`. Both were materialized as
independent repositories under pool 7's target, with explicit private
`GIT_DIR`/`GIT_WORK_TREE`, disabled global/system config, a read-only alternate
object store and immutable parser package links. Both source copies, their
private Git directories and package links were removed afterward.

| Observation | Base | Namespace |
| --- | ---: | ---: |
| Tracked paths | 28,509 | 28,510 |
| Switch-off lost (path, step) edges | 298,515 | 298,553 |
| Lost paths | 24,954 | 24,959 |
| First-loss sites / readers | 626 / 177 | 626 / 177 |
| Edges without provenance | 0 | 0 |
| Unplaced / full-policy paths, scanner on | 149 / 33 | 149 / 33 |
| Unplaced / full-policy paths, scanner off | 149 / 33 | 149 / 33 |

Comparing the live selectors over common tracked paths loses **zero** existing
obligations and gains 103: 34 each for `source-facts.ts` and
`shell-commands.ts`, seven for `memory-watch.ts`, and 28 for
`tooling/inputs/node-inputs.json`. The shared parser is now an actual dependency
of the graph. The shell/Python handoff follows the parsed closure of its named
JavaScript entry, while its inferred origin remains additive and cannot place
an unknown input.

No old switch-off loss retires in this infrastructure slice. The 38 additional
switch-off losses are three each for the new reader-input owner, SourceFacts
and the shell parser, one for the memory worker, and 28 for the Node input
record. A shell launch of `node-inputs.ts` acquires its URL-declared JSON asset;
when that shell itself is reached only through inferred module text, removing
the inference loses the JSON too. The investigation tool now attributes that
parsed continuation to the shell launch site. Selector policy is unchanged.

Five first-loss sites appeared between the original frozen census and this
base. They are all data: run-recording's population metadata and printed pin
command, the census classifier's `tests/interop` prefix, and records.test's
private `tests/programs` directory and private `tsconfig.json`. The reviewed
[current site table](namespace-sites.tsv) includes those five rows;
[namespace.json](namespace.json) holds the exact deltas, new classifications,
per-step counts and capture digests. The original frozen table remains intact.

## Proof and reproduction

The namespace, SourceFacts, census, owed and timing suites passed 132 tests.
The landing selection, report-consumer and timing suites passed 36 tests.
The host audit checked 1,869 sources, 252 entry closures and 412 reads. The
strict project checked 810 modules with zero new diagnostics. The final proof
units were `nts-agent-728-namespace-reviewed-proof.service` and
`nts-agent-728-namespace-consumer-proof.service`.

The frozen reproduction still produces 295,122 edges, 6,754,577 bytes and
SHA-256 `0c409f453dee0c913ef9dcebadc2968a7361f295469f47f10c49dd37d64a5475`.
The current namespace index is 298,553 edges, 6,810,309 bytes, with SHA-256
`d51510bbb7aeb974dda0dee15491ef775715c841ef625e905aa707bb3a912983`.
Both indexes stay outside Git under `~/.cache/nts-scratch/728/`.

The frozen replay uses the original record's `reader-census.ts reproduce`
command. To regenerate a current capture, materialize either named pin as an
independent Git repository with its own configuration and provisioned parser,
then run from that repository through admission:

```sh
node "$tool_tree/tooling/gate/reader-census.ts" inspect "$PWD" "$output" \
  "$tool_tree/docs/records/reader-inputs-728/namespace-sites.tsv"
```

Here `tool_tree` is a pool tree carrying this slice. The output contains the
live and switch-off full censuses, raw provenance, classified index and digest.
The retained capture and comparison commands are
`~/.cache/nts-scratch/728/namespace-census-reviewed.py` and
`~/.cache/nts-scratch/728/namespace-analysis.ts`; their outputs live in
`~/.cache/nts-scratch/728/namespace-census-reviewed/`. The existing #728 keep
entry protects them until the task closes. The next reader slice measures
against this pin rather than treating the original projected budget as an
observed reduction.
