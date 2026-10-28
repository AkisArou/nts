# Container content-provider coverage

Authoritative current-provider payload eligibility by prepared identity, clones included. Unsupported slot or payload proofs remain explicit. Recognized writes are diagnostic witnesses, not a closed-writer proof or hypothetical selection.

941/942 modules prepared; 1 unmeasured inputs; 0 function budget exhaustions.

121 measured modules have preparation diagnostics or uncompiled functions. These are inspections of the retained prepared population, not claims that every source function compiled. Details remain in summary.json.

| Corpus / constructor | Allocations | Value candidates | Dynamic | Empty | Candidate delta |
|---|---:|---:|---:|---:|---:|
| benchmarks / nts_map_new | 14 | 12 | 2 | 0 | 0 |
| benchmarks / nts_set_new | 4 | 0 | 4 | 0 | 0 |
| benchmarks / nts_table_new | 2 | 2 | 0 | 0 | 0 |
| benchmarks / nts_map_copy | 0 | 0 | 0 | 0 | 0 |
| programs / nts_map_new | 215 | 139 | 75 | 1 | 1 |
| programs / nts_set_new | 103 | 0 | 103 | 0 | 0 |
| programs / nts_table_new | 115 | 35 | 80 | 0 | 0 |
| programs / nts_map_copy | 10 | 0 | 10 | 0 | 0 |

## Dynamic reasons

| Corpus / constructor | Failed proof | Allocations |
|---|---|---:|
| benchmarks / nts_map_new | identity escapes the closed writer scope | 2 |
| benchmarks / nts_set_new | allocation kind unsupported by current provider | 4 |
| programs / nts_map_new | heterogeneous possible payload tags | 2 |
| programs / nts_map_new | identity escapes the closed writer scope | 10 |
| programs / nts_map_new | not every writer is known | 39 |
| programs / nts_map_new | not one closed fresh identity | 6 |
| programs / nts_map_new | precise managed payload layout unprovided | 18 |
| programs / nts_set_new | allocation kind unsupported by current provider | 103 |
| programs / nts_table_new | identity escapes the closed writer scope | 8 |
| programs / nts_table_new | not every writer is known | 64 |
| programs / nts_table_new | precise managed payload layout unprovided | 8 |
| programs / nts_map_copy | allocation kind unsupported by current provider | 10 |

## Rejected uses

An identity may have several barriers. A sole barrier is diagnostic, not permission to discharge it. Budget-exhausted observations may be partial.

| Corpus / constructor | Rejected use | Affected | Sole barrier |
|---|---|---:|---:|
| benchmarks / nts_map_new | return | 2 | 2 |
| programs / nts_map_new | Binary | 2 | 0 |
| programs / nts_map_new | FieldSet | 6 | 6 |
| programs / nts_map_new | GlobalSet | 10 | 10 |
| programs / nts_map_new | ambiguous receiver identity | 6 | 4 |
| programs / nts_map_new | call | 9 | 7 |
| programs / nts_map_new | nts_is_map argument 0 | 2 | 2 |
| programs / nts_map_new | nts_map_keys_into argument 0 | 9 | 0 |
| programs / nts_map_new | nts_map_values_into argument 0 | 12 | 3 |
| programs / nts_map_new | nts_value_to_string argument 0 | 2 | 0 |
| programs / nts_map_new | return | 10 | 10 |
| programs / nts_table_new | FieldSet | 1 | 1 |
| programs / nts_table_new | GlobalSet | 14 | 14 |
| programs / nts_table_new | call | 12 | 9 |
| programs / nts_table_new | nts_is_array argument 0 | 1 | 1 |
| programs / nts_table_new | nts_is_map argument 0 | 2 | 2 |
| programs / nts_table_new | nts_map_copy argument 0 | 9 | 7 |
| programs / nts_table_new | nts_map_extend argument 0 | 7 | 5 |
| programs / nts_table_new | nts_map_extend argument 1 | 9 | 7 |
| programs / nts_table_new | nts_map_keys_str argument 0 | 15 | 12 |
| programs / nts_table_new | nts_value_to_string argument 0 | 2 | 0 |
| programs / nts_table_new | return | 8 | 8 |

## Unmeasured inputs

- programs/invalid: FAIL; tests/programs/invalid/src/main.ts:11:3: TS2322 Type 'number' is not assignable to type 'string'.
tests/programs/invalid/src/main.ts:14:14: TS2322 Type 'string' is not assignable to type 'number'.
Error: the program does not typecheck
