// Benchmark groups are declared by the foundation page that owns the rows:
// a `## Rows` section in docs/foundations/<page>.md, one `### <group>` per
// group and one backticked case name per list item, never numbers. This one
// reader serves nts-bench's --group selection, full.md's grouping and the
// task audit's ownership checks, so the three cannot disagree about which
// rows a group names.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** One list line's rows, under its page and group name. */
export type RowList = { page: string; name: string; rows: string[] };
/** One named group: every list under its name, merged, in declaration order. */
export type BenchmarkGroup = { name: string; pages: string[]; rows: string[] };

/** Canonical lists are Markdown Rows sections on their owning pages (#643).
 * Backticked row IDs in a list are declarations; prose examples elsewhere are not.
 */
export function parseRowLists(page: string, markdown: string): RowList[] {
  const out: RowList[] = [];
  let inRows = false, name = page, fence: string | null = null;
  for (const line of markdown.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    if (/^#{1,2} /.test(line)) {
      inRows = /^## Rows\b/.test(line);
      name = line.replace(/^#+ /, "");
    } else if (inRows && /^### /.test(line)) {
      name = line.slice(4);
    } else if (inRows && /^\s*- /.test(line)) {
      const rows = [...line.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)*)`/g)].map((m) => m[1]!);
      if (rows.length) out.push({ page, name, rows });
    }
  }
  return out;
}

/** Every canonical row list in the tree, in page order. */
export function rowLists(root: string): RowList[] {
  const dir = join(root, "docs/foundations");
  if (!existsSync(dir)) return [];
  const pages = readdirSync(dir).filter((p) => p.endsWith(".md")).sort().map((p) => `docs/foundations/${p}`);
  if (existsSync(join(root, "docs/primitives.md"))) pages.push("docs/primitives.md");
  return pages.flatMap((page) => parseRowLists(page, readFileSync(join(root, page), "utf8")));
}

/** The declared groups, lists under one name merged; a row repeated within a group is named once. */
export function benchmarkGroups(lists: readonly RowList[]): BenchmarkGroup[] {
  const groups: BenchmarkGroup[] = [];
  const byName = new Map<string, BenchmarkGroup>();
  for (const list of lists) {
    let group = byName.get(list.name);
    if (!group) {
      group = { name: list.name, pages: [], rows: [] };
      byName.set(list.name, group);
      groups.push(group);
    }
    if (!group.pages.includes(list.page)) group.pages.push(list.page);
    for (const row of list.rows) if (!group.rows.includes(row)) group.rows.push(row);
  }
  return groups;
}

/** The groups a tree declares. */
export function readBenchmarkGroups(root: string): BenchmarkGroup[] {
  return benchmarkGroups(rowLists(root));
}

/** The rows one named group measures, or undefined when no page names it. */
export function groupRows(groups: readonly BenchmarkGroup[], name: string): string[] | undefined {
  return groups.find((group) => group.name === name)?.rows;
}
