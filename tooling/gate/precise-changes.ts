import { commentsOnly } from "./comment-changes.ts";

export type ContentChange = {
  path: string; added?: boolean; deleted?: boolean;
  before?: string; after?: string; sameMode?: boolean;
};

// Only these keys are prose. An unrecognised new field keeps the ordinary
// gate: it may have gained a reader that this classifier does not know.
function classification(path: string, text: string): string | null {
  const json = JSON.parse(text);
  const prose = new Set(["//", "reason", "authority"]);
  if (path.endsWith("/features.json")) {
    if (Object.keys(json).some(k => !["//", "version", "features"].includes(k)) || json.version !== 1 || !json.features || Array.isArray(json.features)) return null;
    const rows = Object.entries(json.features).sort(([a], [b]) => a.localeCompare(b)).map(([name, row]) => {
      if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some(k => k !== "class" && !prose.has(k))) throw new Error("unknown feature row");
      return [name, (row as {class?: unknown}).class];
    });
    return JSON.stringify(rows);
  }
  if (Object.keys(json).some(k => !["//", "exclusions"].includes(k)) || !Array.isArray(json.exclusions)) return null;
  return JSON.stringify(json.exclusions.map((row: Record<string, unknown>) => {
    if (!row || Object.keys(row).some(k => !["kind", "match"].includes(k) && !prose.has(k))) throw new Error("unknown exclusion row");
    return [row.kind, row.match];
  }));
}

export function preciseChange(change: ContentChange): "documentation" | "classification prose" | "classification meaning" | "comments" | null {
  const { path, before, after } = change;
  if (/^docs\//.test(path) || path === "AGENTS.md" || path === "README.md") return "documentation";
  if (change.added || change.deleted || change.sameMode !== true || before === undefined || after === undefined || before.includes("\0") || after.includes("\0")) return null;
  if (/^tooling\/census\/(features|test262-exclusions)\.json$/.test(path)) {
    try {
      const a = classification(path, before), b = classification(path, after);
      return a === null || b === null ? null : a === b ? "classification prose" : "classification meaning";
    } catch { return null; }
  }
  // Fixture comments are assertions or compiler inputs. C and Rust sources
  // that are embedded as text are also excluded by owed's dependency map.
  if (/^(tests|third_party)\//.test(path)) return null;
  return commentsOnly(path, before, after) ? "comments" : null;
}
