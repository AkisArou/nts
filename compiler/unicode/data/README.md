# Vendored Unicode Character Database

One directory per UCD release, named `ucd-<major>.<minor>.<patch>`. The
files are used verbatim as downloaded. They are large; the alternative is a
network fetch at build time.

| file | what the generator reads |
|---|---|
| `UnicodeData.txt` | simple case mappings (fields 12–14) |
| `SpecialCasing.txt` | unconditional full case mappings, and `Final_Sigma` |
| `DerivedCoreProperties.txt` | `Cased` and `Case_Ignorable` (the `Final_Sigma` context) |

## The version is node's (D2)

The directory's version always equals the Unicode version of the node pinned
in `.tool-versions`. `tooling/gate/unicode-version.test.ts` fails when a
compiled program's answers stop matching that node, and
`tooling/gate/unicode-census.test.ts` compares every code point.

## Updating, in the same landing as the node pin

1. Download the three files for the new release from
   `https://www.unicode.org/Public/<version>/ucd/` into a new directory
   `ucd-<version>/`.
2. `sha256sum *.txt > SHA256SUMS` inside it, and check the sums against a
   second download (or the release's published hashes) before trusting them.
3. Update `UCD_DIR` and `UNICODE_VERSION` in the crate
   ([../build.rs](../build.rs), [../src/lib.rs](../src/lib.rs)).
4. Delete the old directory in the same commit: one version per tree, so a
   stale copy can never be generated from by accident.
5. Run the census against the new node. `build.rs` re-checks every
   invariant the fast paths rely on (only U+0130 lengthens a lowercase,
   Latin-1 widening, no plane-crossing single mappings, a free sentinel
   value); a failure there is the upgrade telling you a fast path changed,
   not a test to relax.
