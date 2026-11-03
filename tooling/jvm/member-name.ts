// Fixed catalogue roles for shell and Java-source consumers.
import assert from "node:assert/strict";
import names from "../../compiler/codegen/jvm/generated-members.json" with {type: "json"};

const [role, ...extra] = process.argv.slice(2);
const fixed: Readonly<Record<string, string>> = names.fixed;
const member = role && Object.hasOwn(fixed, role) ? fixed[role] : undefined;
assert(extra.length === 0 && typeof member === "string",
  "usage: member-name.ts <fixed catalogue role>");
process.stdout.write(member + "\n");
