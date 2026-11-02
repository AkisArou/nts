// Control for an-interface-to-string-skipped-by-string-conversion: the same object typed by its own literal type.
const shown = { toString(): string { return "own"; } };
function viaString(value: typeof shown): string { return String(value); }
function viaTemplate(value: typeof shown): string { return `${value}`; }
observe("String calls toString", String(viaString(shown) === "own"));
observe("template calls toString", String(viaTemplate(shown) === "own"));
done();
