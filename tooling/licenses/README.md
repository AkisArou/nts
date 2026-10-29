# Benchmark inputs

CC-BY-4.0 material is admitted only as opaque input to a benchmark. It stays
beneath that case in `benchmarks/cases/`, with its full licence and attribution.
It cannot be imported, included or embedded in nts or any program nts builds,
including a benchmark. A package's unpackers are code, not data. An existing
upstream runtime data-loading boundary must be preserved; adding a shim or
rewriting upstream code to create one requires a separate user decision.

Each case with such data declares `input-licenses.json` beside `case.ts`:

```json
{
  "version": 1,
  "inputs": [
    {
      "directory": "benchmarks/cases/example/inputs/upstream-data",
      "upstream": "https://example.org/upstream/blob/exact-revision/data",
      "license": {
        "spdx": "CC-BY-4.0",
        "path": "benchmarks/cases/example/inputs/upstream-data/LICENSE",
        "sha256": "<SHA256 of the full licence bytes>"
      },
      "provenance": {
        "path": "benchmarks/cases/example/provenance.md",
        "attribution": "Data by its authors, CC-BY-4.0."
      },
      "files": [
        {
          "path": "benchmarks/cases/example/inputs/upstream-data/packed.json",
          "sha256": "<SHA256 of the unmodified input bytes>"
        }
      ]
    }
  ]
}
```

Paths are repository-relative. The directory contains exactly the licence
and the listed files, without symlinks. The provenance contains the attribution
as one exact line, the pinned upstream URL, and the existing upstream loading
boundary for review. The declaration does not approve executable code.

`node tooling/licenses/licenses.ts --check` validates declarations, hashes and
attribution offline. Notices, package licences and SPDX headers independently
detect undeclared CC-BY material. The pinned TypeScript resolver checks every
project's roots and source graph, including inherited paths and package
resolution. Direct imports, re-exports, `require`, native includes/embedding,
and explicit product file references are also checked. Refused and currently
unbuilt checked-in sources remain in the audit. This checks declared source
and build edges; upstream provenance and the data/code classification still
require review, as does vendored code under every other licence.

The existing tsrs NOTICE contains TypeScript's WHATWG DOM attribution. Its
exact bytes have one reviewed component-notice pin. It does not license the
tsrs tree under CC-BY or admit any new material; a changed or different
notice cannot use that pin.
