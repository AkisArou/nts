import assert from "node:assert/strict";
const {owed}=await import(process.argv[2]);
const rules=owed([{path:"tooling/unicode-cases/case-mapping.ts",added:true}]);
assert.ok(!rules.some(r=>r.full),"offline Unicode generator must not force a full gate");
