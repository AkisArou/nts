// expect: NTS1100 `document.title`
//
// Builtins study probe dom-document; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `document.title`, a global member with no definition here | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the document binding changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

const sourceDocument = { title: "source" };

export function subject(): void {
  console.log("d", document.title);
}

export function control(): void {
  console.log("d", sourceDocument.title);
}
