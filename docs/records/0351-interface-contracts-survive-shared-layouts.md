# Interface contracts survive shared layouts

Physical layout sharing does not identify an interface declaration or its
instantiations. Two empty interfaces can share storage, and nullable and
optional pointer fields can share storage while requiring different absence
conversions. Canonicalizing those contracts to a layout representative loses
the distinction needed by interface access plans.

`Program.interface_identities` records one identity per declaring symbol,
with its used schema types sorted and distinct. Collection uses hierarchy
faces and used layouts; augmented classes retain their class identity, and
provided classes such as Error remain classes. Each interface schema ID
survives object canonicalization. Anonymous storage aliases still normalize,
and class aliases retain their existing priority. One indexed lookup replaces
the canonicalizer's repeated searches through alias groups.

C pointer casts depend on physical struct types. The C emission context now
builds the existing shared `LayoutIndex` once and uses exact object-layout
equality at its upcast sites. The call emitter shares its declaration lookup
between arguments and results. These queries change pointer spelling only:
they grant no assignability edge, conversion or field-access license.

## Evidence

The control pin is `098e86fa5f3d`, SHA-256
`ff43d756eb6eec219848fdfcaf615bec4ea38aa18689db1bc3ef10111a406f5d`.
It is byte-identical to the previous landed compiler, `da4a2a4a874b`.
The source pin is `b124b59d4151`, SHA-256
`5ec74dd0e7530af382e6cfefd5c48b3db1704818147f2e810a964a30a75e4752`.
The paired tsgo binary is unchanged from record 0350.

Three prepared-HIR witnesses distinguish empty declarations, group generic
instantiations with different layouts under one declaration, and preserve
nullable and optional instantiations sharing one layout. Controls retain the
augmented Token class and provided Error identity. All 12 focused core tests
and 162 C backend tests pass, as does strict workspace Clippy.

Every runtime module emits valid HIR and compiles at O2. All 29 O2 object
hashes match the control exactly. A mechanical comparison accepts every
generated-C difference as a deleted pointer cast: 2,215 deletions across 20
modules, with no other edits. Native tables remain 62,592 bytes and aggregate
O2 object size remains 11,703,074 bytes.

All 25,429 JVM class and jar products across the 29 runtime modules and 62
benchmark projects are byte-identical. All 62 benchmark C sources, translated
LTO objects and linked binaries match the quiet measured binaries from record
0348, with unchanged support sources and flags. Those native timings carry
forward. Compiler cost is 8,516 billion instructions against 8,722 recorded
(0.98x); this is the existing ratchet, not a paired timing comparison.

Definitions remain 51,680, with every module's count unchanged. Normalized
refusal occurrences remain 17,020, distinct messages 658 and sites 1,535.
The function-state comparison reports no moves. Every final differential lane
(C, LLVM, JVM and C with reference counting) compares all 512 examples
unchanged, with no regressed, changed, unstable or unmeasured results. All 322
blockers behave as expected; all 139 outcomes retain their records (67 holds,
72 reproductions). No fixture is promoted or re-recorded in this stage.

## Boundary

This stage supplies identity for later interface access plans. JVM reference
and allocation naming still follows the existing layout readers. Stateful
interface implementations, accessors, field-layout stops and stored-method
value handling remain the later stages' work. The separate frame-object
initialization defect is next before access-family implementation.
