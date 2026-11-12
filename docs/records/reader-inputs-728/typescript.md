# TypeScript and test262 reader declarations: #728

The fixed comparison is namespace main
`80e6d1eff3faf1e55d1456c982a006bb3db725bc` against reader tip
`72be0a1bef1310068ad2fdfa337cc958cce12a27`. This slice declares inputs at the
population-owning callers, without giving the generic
`selectTypescript(root, under)` helper an unconditional corpus dependency.

`conformance262.ts`, `typescript-oracles.ts` and `record-pending.ts` use their
data-directory URLs to derive the same repository-relative `tests/typescript`
value. Supplied fixture roots still govern execution. Feature and exclusion
ledgers, the generator's test entry, and inherited fixture options use exact
module-relative URLs. A generated program's own `tsconfig.json` remains a
caller-owned output, rather than an invented declaration of a similarly named
file beside the generator.

Four staging sites explicitly supply their private corpus: the sampled CLI,
the record CLI, its copied-consumer control, and the pending-outcome records
fixture. The copied consumer owns a physical copy of the two private cases;
its data namespace no longer follows a link through another fixture. Controls
count the sampled fixture's two cases and the outcome fixture's empty
TypeScript corpus. No production corpus is copied into these fixtures.

## Measured selection delta

| Observation | Namespace main | Reader tip |
| --- | ---: | ---: |
| Tracked paths | 28,515 | 28,515 |
| Switch-off lost edges | 298,565 | 176,665 |
| Lost paths | 24,963 | 24,961 |
| First-loss sites / readers | 626 / 177 | 588 / 169 |
| Edges without provenance | 0 | 0 |
| Unplaced / policy, scanner on | 149 / 33 | 149 / 33 |
| Unplaced / policy, scanner off | 149 / 33 | 149 / 33 |

On common tracked paths the live selector loses **zero** existing obligations
and gains ten. The switch-off experiment closes 121,910 edges and gains ten,
for a net reduction of **121,900**. The ten additions all reach
`tooling/unicode-cases/url-hosts.ts`: legacy scanning now sees the generator
comments in the declared corpus. Their existing classification is generator
provenance. Final removal owes freshness rather than execution of generated
outputs; this slice keeps that conservative additive reach.

An attempted conversion of record-pending's outcomes command to a URL exposed
four old additive `test-host` edges that an inferred JavaScript reader's URL
closure does not yet continue. That dispatch is restored byte-for-byte. It
will move with the remaining command readers and host-source declarations,
so these obligations are not silently retired. The two remaining preservation
edges assigned to this reader group are tooling command/project-context work;
the original projected reduction was an accounting budget, not an acceptance
count to force.

[typescript.json](typescript.json) contains the exact per-step delta, live-map
additions, remaining groups, capture digests and proof accounting. The next
preservation groups are:

| Group | Assigned remaining edges |
| --- | ---: |
| Runtime / conformance / configuration | 67,447 |
| Benchmarks / oracles | 41,694 |
| Remaining tooling | 2,083 |
| Residual command / project context from this group | 2 |

The reviewed classification keys remain those in
[namespace-sites.tsv](namespace-sites.tsv); no new first-loss site needed a
guessed role. The index stays outside Git at
`~/.cache/nts-scratch/728/typescript-census-final/namespace/edges.json`:
176,665 edges, 4,730,347 bytes, SHA-256
`6f4eafb158219a96868b9d0a94d484dd84b52d16fb09222836d4ce81883feb0c`.

## Proof and reproduction

The focused reader, record, generator, selection, report-consumer and timing
checks passed 171 tests. The host audit checked 1,870 sources, 253 entry
closures and 412 reads; strict checked 811 modules with zero new diagnostics.

The supported `check.ts <tip> --here` run was green in 590 seconds. It built
and sealed its own compiler environment. Canonical tooling passed 2,141 tests,
with zero failures and the two existing Unicode TODOs (2,143 tests total).
Rust passed 3,043, with zero failures and eight ignored, across 55 binaries
and 18 doctest crates. Tooling used 2,201.965146 cgroup CPU seconds and
207.078 wall seconds; Rust used 4,399.064595 CPU seconds and 367.641 wall
seconds. These are proof costs, not a performance comparison. The run is
`~/.cache/nts-landing/runs/here-72be0a1bef13-1794519021622`.

The private source repositories used the namespace record's isolated-Git
procedure. Both source copies and their Git directories were removed. Captures
and commands remain under `~/.cache/nts-scratch/728/`, protected by #728's keep
entry. `typescript-census-final.py` reuses the unchanged base capture from
`typescript-census-v1/` and captures the revised tip; `typescript-analysis-final.ts`
compares the selectors and frontiers. To regenerate either pin's complete
classified index, use the existing investigation tool from its independent
source repository:

```sh
node "$tool_tree/tooling/gate/reader-census.ts" inspect "$PWD" "$output" \
  "$tool_tree/docs/records/reader-inputs-728/namespace-sites.tsv"
```

The fixed pin, pinned Node version and classification table determine the
index bytes. The records contain no second dependency list or selector
exception.
