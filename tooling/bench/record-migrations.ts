/** Exact, owner-approved corrections to immutable published records. Git blob SHA-1s. */
export const RECORD_MIGRATIONS = [{
  run: "2026-11-24-d9941ea0f4e8-c3770a55231b4a27ad84b26fa0e3fdac",
  original: "0f1686a88596e0a7f455af54eba777c5c90fb96d",
  replacement: "b71eb78654d32ff19d7ca5bcffab1a9cb37d9390",
  reason: "#1032: recompute semantic workload identities after default Returned fragmented own-best history; measurements unchanged",
  approval: "Owner: Yes, migrate the 11-24 record. Signalbox 1032-record-migration, 2026-11-25",
}, {
  run: "2026-11-26-4de56c302544-22b9619f772845f382884116c177084d",
  original: "01b0606f134333f20fe7d26ff93d8dda6d52e451",
  replacement: "ccb490fd269790798cf26a9f72d4a78e078c790f",
  reason: "#1032: published by the unfixed identity function; recompute semantic workload identities; measurements unchanged",
  approval: "Owner: yes, migrate 11-26 the same way. Signalbox bench-identity-migration-1032-20261127, 2026-11-27",
}, {
  run: "2026-11-27-0cd07c4baf18-fd2c4e9c08e84cdb8985aee8fc3a0141",
  original: "d04ac8a7cc02d57941678ecb19bf2fa71be75d06",
  replacement: "9a4c6eec612d9b9cc25a8ec3da008ac308a38c58",
  reason: "#1032: published by the unfixed identity function; recompute semantic workload identities; measurements unchanged",
  approval: "Owner: yes, and 11-27 if it publishes before #1032 lands. Signalbox bench-identity-migration-1032-20261127, 2026-11-27",
}] as const;
export function approvedRecordMigration(run: string, original: string, replacement: string): boolean {
  return RECORD_MIGRATIONS.some(entry => entry.run === run && entry.original === original && entry.replacement === replacement);
}
