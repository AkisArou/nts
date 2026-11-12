# Runtime, conformance and configuration readers: #728

This slice declares fourteen population and asset readers, preserves their supplied roots and repository-relative case keys, and makes corpus membership distinct from executable traversal. The comparison pins and complete delta are in runtime.json.

The production readers cover definitions, assembly, native C, blockers, representation facts, integrity, JVM verification, outcome materialization, runtime fuzzing, types, configuration and native-compression interop. The generic outcome runtime resolver remains an anchor: each case selects its runtime imports; it does not enumerate the runtime population.

The pure reader-inputs owner moves unchanged into reader-inputs/main.ts with its own one-file project. The parser control proves project discovery selects that project, without changing a larger fixture's compiler options.

## Ownership controls

Exact production data links are reusable only with the explicit link or reuse option, only when the destination resolves to the declared source, and only for declared tracked members. Directories still walk their membership. Four negative controls cover untracked file and directory links in both modes. Wrong-source and missing-child controls remain, and repeated staging proves it never writes into the source. Private namespace substitutions continue to reject data links.

The selector retains all declared files as inputs but traverses only module-owned files, with the existing file-kind guard. Shell and Python launches retain the same parsed JavaScript continuation. Controls retain directory members without interpreting their path-shaped data as further reads; a non-module .bin asset cannot manufacture reach. A Set indexes launched module membership rather than repeatedly scanning the file list.

The blockers fixture declares its private three-case corpus before staging. The pending-outcome fixture declares an empty private outcomes corpus before adding its one case. Both assert their exact staged inventories. The growth replay uses its existing captured stdout for diagnostics rather than publishing another file.

## Measured selection delta

The fixed source comparison is `36503491ce4a6248421f44fdbd71c42e10ba1627` against `243ef93225090a497302d4563dd5ea750ed6833c`.

| Observation | Main | Reader tip |
| --- | ---: | ---: |
| Tracked paths | 28520 | 28521 |
| Switch-off lost edges | 176677 | 109288 |
| Lost paths | 24965 | 24957 |
| First-loss sites / readers | 588 / 169 | 477 / 150 |
| Edges without provenance | 0 | 0 |
| Unplaced / policy, scanner on | 149 / 33 | 142 / 33 |
| Unplaced / policy, scanner off | 149 / 33 | 142 / 33 |


On common tracked paths, the live selector retires exactly ten obligations from tooling/unicode-cases/url-hosts.ts. Each is classified as offline generator provenance: a corpus comment names its producer, but no consumer executes it. runtime.json lists every retired pair. No real-reader edge is lost.

The 940 additions are 925 interop inputs (924 under the web-platform test corpus and its host), seven configuration inputs and eight inherited fixture-config obligations. Seven formerly unplaced configuration/helper paths now have explicit placement, and the tool-written full-gate ratchet retires their rows. The scanner-off engine adds no fallback.

The switch-off experiment closes 67,390 edges and adds one, a net reduction of 67,389. The remaining runtime/config and TypeScript rows are generic project-context or tooling-command work; they stay conservative for the remaining-reader slice. No guessed nearby project is declared just to force a target count.

| Remaining reader group | Assigned preservation edges |
| --- | ---: |
| benches-and-oracles | 41699 |
| tooling | 2102 |
| runtime-and-config | 52 |
| test262-and-typescript | 2 |

## Proof and reproduction

Focused reader/copy/consumer/timing checks passed 185 tests. The corrected blocker/selection/timing batch passed 117, and the final stdout replay/timing batch passed 3. The latest host audit checked 1871 sources, 254 closures and 412 reads. Strict checked 812 modules with zero new diagnostics. These are separately repeated batches, not an additive test inventory.

The supported check reported green in 731 seconds including preparation; its gate summary records 725.064 seconds. Tooling passed 2155 tests with 0 failures and 2 existing TODOs (2157 tests total). Rust passed 3043 with 0 failures and 8 ignored, across 55 binaries and 18 doctest crates. Its compiler and oracle environment came from the supported route.

| Step | Cgroup CPU seconds | Wall seconds | Peak bytes |
| --- | ---: | ---: | ---: |
| tooling | 2529.824252 | 244.462 | 11897995264 |
| tests | 4629.052606 | 451.564 | 10357211136 |

The CPU basis is `cgroup-v2-scope-v1`. These are proof costs, not a performance comparison. The run is `/home/akisarou/.cache/nts-landing/runs/here-243ef9322509-1794525908880`.

The first incomplete local run and the idle run that exposed #769 are excluded from proof. A completed earlier run identified two private outcome-staging failures fixed here and a bounded-entry 50 ms wiring failure on unchanged supervision code, retained by codex-worker for #756.

The final source repositories and their private .git directories were removed together after the census. The full edge index remains off tree under the existing #728 keep entry. The source pin, pinned Node version and reviewed namespace-sites.tsv determine its bytes. From an independent repository at either compared pin, run:

```sh
node "$tool_tree/tooling/gate/reader-census.ts" inspect "$PWD" "$output" \
  "$tool_tree/docs/records/reader-inputs-728/namespace-sites.tsv"
```

The final index has 109288 edges in 3600077 bytes, SHA-256 `c55890176e52ec7d573dbb5817037eabeee34fe58391c6ce4751d1c159875a77`, at `/home/akisarou/.cache/nts-scratch/728/runtime-census-rebased/namespace/edges.json`.

The frozen original reproduction remains byte-equal to SHA-256 0c409f453dee0c913ef9dcebadc2968a7361f295469f47f10c49dd37d64a5475. The capture and analysis commands, comparisons and proof logs stay under ~/.cache/nts-scratch/728/ until #728 closes. No giant edge index is committed.
