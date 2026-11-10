// Read-only project issue audit, run at coordinator checkpoints, never a timer.
//   node tooling/tasks/audit.ts [--json] [--snapshot <file>] [--protect N,N]
// Exit 0: complete without errors; 1: drift; 2: incomplete measurement.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gh, type Gh } from "./new.ts";
import { bodyProblems, labelProblems, parentProblems, parseCard, readSpec, roleOf, type LabelSpec } from "./spec.ts";
import { issueOfBranch } from "./branch.ts";

export type Issue = { number: number; title: string; body: string; labels: string[]; state: string;
  parent: number | null; children: number[]; updatedAt: string; closedAt?: string | null };
export type Snapshot = { version: 1; complete: boolean; capturedAt: string; issues: Issue[]; branches: string[]; refs?: string[]; reason?: string };
export type Finding = { code: string; severity: "error" | "warning" | "info"; issue?: number; message: string; protected?: boolean };
export type RowList = { page: string; name: string; rows: string[] };
export type Options = { spec?: LabelSpec; streams: readonly number[]; cases?: readonly string[]; rows?: readonly RowList[];
  exists?: (path: string) => boolean; protected?: readonly number[]; now?: string; readyDays?: number };
export type Report = { version: 1; complete: boolean; capturedAt: string; open: number; findings: Finding[]; errors: number; warnings: number };

/** Cycles are found without a depth/round cutoff. */
export function cycles(edges: ReadonlyMap<number, readonly number[]>): number[][] {
  const finished = new Set<number>(), out: number[][] = [];
  for (const start of edges.keys()) {
    if (finished.has(start)) continue;
    const stack: { node: number; at: number }[] = [{ node: start, at: 0 }], path: number[] = [start], visiting = new Map([[start, 0]]);
    while (stack.length) {
      const frame = stack.at(-1)!, next = edges.get(frame.node) ?? [];
      if (frame.at >= next.length) { finished.add(frame.node); visiting.delete(frame.node); stack.pop(); path.pop(); continue; }
      const node = next[frame.at++]!;
      if (visiting.has(node)) { out.push([...path.slice(visiting.get(node)!), node]); continue; }
      if (!finished.has(node)) { visiting.set(node, path.length); path.push(node); stack.push({ node, at: 0 }); }
    }
  }
  return out;
}

/** Pure snapshot comparison: there is deliberately no write adapter. */
export function audit(snapshot: Snapshot, options: Options): Report {
  const findings: Finding[] = [], protectedIssues = new Set(options.protected ?? []);
  const add = (code: string, message: string, issue?: number, severity: Finding["severity"] = "error") => {
    const protected_ = issue !== undefined && protectedIssues.has(issue);
    findings.push({ code, message, ...(issue !== undefined ? { issue } : {}), severity: protected_ ? "info" : severity, ...(protected_ ? { protected: true } : {}) });
  };
  const finish = (complete: boolean): Report => ({ version: 1, complete, capturedAt: snapshot.capturedAt,
    open: snapshot.issues.filter(i => i.state === "OPEN").length, findings,
    errors: findings.filter(f => f.severity === "error").length, warnings: findings.filter(f => f.severity === "warning").length });
  if (snapshot.version !== 1 || !snapshot.complete) { add("incomplete", snapshot.reason ?? "the issue snapshot is incomplete"); return finish(false); }
  if (new Set(snapshot.issues.map(i => i.number)).size !== snapshot.issues.length) { add("incomplete", "snapshot repeats an issue number"); return finish(false); }
  const byNumber = new Map(snapshot.issues.map(i => [i.number, i])), spec = options.spec ?? readSpec();
  const knownRows = new Set(options.cases ?? []), declared = new Set((options.rows ?? []).flatMap(r => r.rows));
  const parentEdges = new Map<number, number[]>(), dependencyEdges = new Map<number, number[]>();
  for (const issue of snapshot.issues) {
    parentEdges.set(issue.number, issue.parent === null ? [] : [issue.parent]);
    const parsed = parseCard(issue.body), depends = parsed.card["Depends on"] ?? "";
    const dependencies = [...depends.matchAll(/#([1-9][0-9]*)\b/g)].map(m => Number(m[1]));
    dependencyEdges.set(issue.number, dependencies);
    const openChildren = issue.children.filter(n => byNumber.get(n)?.state === "OPEN");
    if (issue.state !== "OPEN") {
      if (openChildren.length) add("closed-parent", `closed issue has open children: ${openChildren.map(n => `#${n}`).join(", ")}`, issue.number);
      if (["stream", "group"].includes(roleOf(issue.labels)) && /- \[ \]/.test(parsed.card.Parts ?? "")) add("closed-parts", "closed group retains unchecked wanted parts; inspect its completion or superseding decision", issue.number, "warning");
      continue;
    }
    for (const problem of labelProblems(issue.labels, spec)) add("labels", problem, issue.number);
    for (const problem of bodyProblems(issue.body, issue.labels)) add("card", problem, issue.number);
    const role = roleOf(issue.labels), parent = issue.parent === null ? null : byNumber.get(issue.parent);
    if (issue.parent !== null && !parent) add("orphan", `parent #${issue.parent} is absent from a complete snapshot`, issue.number);
    for (const problem of parentProblems(issue.labels, parent ?? null)) add("parent-role", problem, issue.number);
    if (role === "stream" && !options.streams.includes(issue.number)) add("unknown-stream", "stream is not named in docs/plan.md", issue.number);
    if (role !== "stream" && parsed.card.Parent !== `#${issue.parent}`) add("parent-card", `Parent text does not match API parent #${issue.parent}`, issue.number);
    if (role !== "stream" && parent && !parent.children.includes(issue.number)) add("parent-link", `parent #${parent.number} does not list its child`, issue.number);
    for (const child of issue.children) if (byNumber.has(child) && byNumber.get(child)!.parent !== issue.number) add("child-link", `child #${child} names a different parent`, issue.number);
    if (role === "group") {
      const design = parsed.card.Design ?? "";
      const pages = [...design.matchAll(/docs\/[\w./-]+\.md/g)].map(m => m[0]);
      for (const page of pages) if (options.exists && !options.exists(page)) add("design", `design page is missing: ${page}`, issue.number);
      const acceptance = parsed.card["Tests and rows"] ?? "";
      const list = /Existing benchmark identifiers:\s*([^\n]+?)(?:\.\s|$)/.exec(acceptance)?.[1];
      if (list) for (const row of list.split(/,\s*/)) if (options.cases && !knownRows.has(row)) add("row", `unknown existing benchmark row: ${row}`, issue.number);
      if (list && pages.length && !(options.rows ?? []).some(r => pages.includes(r.page))) add("row-declaration", "design has no canonical Rows declaration yet; keep mechanism tasks unready until their instrument lands", issue.number, "warning");
    }
    for (const path of issue.body.matchAll(/(?:tests\/(?:outcomes|refusals|programs|memory|compile-time|interop)|benchmarks\/cases)\/[\w./-]+/g)) {
      const value = path[0].replace(/\.$/, "");
      if (options.exists && !options.exists(value)) add("fixture", `missing named fixture/case: ${value}`, issue.number, "warning");
    }
    if (depends && /\b(?:unresolved|unnamed|unidentified|names no issue|names no issue for)\b/i.test(depends)) add("dependency", "a prerequisite is unnamed or unresolved", issue.number, "warning");
    for (const n of dependencies) {
      const dep = byNumber.get(n);
      if (!dep) add("dependency", `dependency #${n} is absent from a complete snapshot`, issue.number);
      else if (dep.state !== "OPEN") add("closed-dependency", `#${n} is closed; verify its named slice and main evidence or duplicate replacement`, issue.number, "info");
    }
    const branch = parsed.card.Branch ?? "";
    const references = [...branch.matchAll(/`([^`]+)`/g)].map(m => m[1]!);
    for (const name of references) if (![...snapshot.branches, ...snapshot.refs ?? []].includes(name)) add("branch", `cited branch/ref is missing: ${name}`, issue.number, "warning");
    if (issue.labels.includes("task") && ![...snapshot.branches, ...snapshot.refs ?? []].some(b => issueOfBranch(b) === issue.number)) {
      const now = Date.parse(options.now ?? snapshot.capturedAt), age = now - Date.parse(issue.updatedAt);
      if (age > (options.readyDays ?? 3) * 86400000) add("queue-age", "ready task has no issue branch after several days; age alone never closes it", issue.number, "info");
    }
    if (/\b(?:tsgo|lanes\.json|old lander|cache results|results cached)\b/i.test(issue.title + "\n" + (parsed.card.Goal ?? ""))) add("wording", "review wording against the current frontend/workflow/no-result-cache decisions", issue.number, "warning");
  }
  for (const n of options.streams) if (!byNumber.has(n) || byNumber.get(n)!.state !== "OPEN" || roleOf(byNumber.get(n)!.labels) !== "stream") add("plan-stream", `plan stream #${n} is missing, closed or not a stream`);
  for (const [kind, edges] of [["parent", parentEdges], ["dependency", dependencyEdges]] as const)
    for (const cycle of cycles(edges)) add(`${kind}-cycle`, cycle.map(n => `#${n}`).join(" → "), cycle[0]);
  for (const branch of snapshot.branches) {
    const n = issueOfBranch(branch);
    if (n && byNumber.get(n)?.state !== "OPEN") add("branch-issue", `branch ${branch} has no open task issue`, n, "warning");
  }
  for (const row of knownRows) if (!declared.has(row)) add("unowned-row", `no canonical page Rows declaration names ${row}`, undefined, "warning");
  for (const list of options.rows ?? []) for (const row of list.rows) if (options.cases && !knownRows.has(row)) add("stale-row", `${list.page} (${list.name}) names missing row ${row}`);
  return finish(true);
}

type Connection = { nodes: any[]; pageInfo: { hasNextPage: boolean; endCursor: string | null }; totalCount?: number };
/** All issue states are needed to detect closed groups and stale task branches.
 * Every query is read-only. Pagination failures throw, never produce green.
 */
export function capture(run: Gh = gh, now = new Date().toISOString(), refs: readonly string[] = []): Snapshot {
  const issues: Issue[] = [], branches: string[] = [];
  try {
    const name = run(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
    const [owner, repo] = name.split("/");
    if (!owner || !repo || !/^[\w.-]+\/[\w.-]+$/.test(name)) throw new Error("repository identity is invalid");
    const query = (q: string, fields: Record<string, string | number> = {}) => {
      const value = JSON.parse(run(["api", "graphql", "-H", "GraphQL-Features: sub_issues", "-f", `query=${q}`, "-f", `owner=${owner}`, "-f", `repo=${repo}`, ...Object.entries(fields).flatMap(([k,v]) => [typeof v === "number" ? "-F" : "-f", `${k}=${v}`])]));
      if (value.errors || !value.data?.repository) throw new Error("GitHub query did not return a complete repository result");
      return value.data.repository;
    };
    const childQuery = 'query($owner:String!,$repo:String!,$n:Int!,$cursor:String){repository(owner:$owner,name:$repo){issue(number:$n){subIssues(first:100,after:$cursor){nodes{number}pageInfo{hasNextPage endCursor}}}}}';
    const children = (n: number, first: Connection): number[] => {
      const out = first.nodes.map(x => x.number), seen = new Set<string>(); let page = first;
      while (page.pageInfo.hasNextPage) {
        const cursor = page.pageInfo.endCursor;
        if (!cursor || seen.has(cursor)) throw new Error(`child pagination stopped at #${n}`);
        seen.add(cursor); page = query(childQuery, { n, cursor }).issue.subIssues;
        out.push(...page.nodes.map(x => x.number));
      }
      return out;
    };
    const issueQuery = 'query($owner:String!,$repo:String!,$cursor:String){repository(owner:$owner,name:$repo){issues(first:100,after:$cursor,orderBy:{field:CREATED_AT,direction:ASC}){totalCount nodes{number title body state updatedAt closedAt labels(first:100){nodes{name}pageInfo{hasNextPage}}parent{number}subIssues(first:100){nodes{number}pageInfo{hasNextPage endCursor}}}pageInfo{hasNextPage endCursor}}}}';
    let cursor: string | null = null, total: number | undefined; const seen = new Set<string>();
    for (;;) {
      const page = query(issueQuery, cursor ? { cursor } : {}).issues as Connection;
      total ??= page.totalCount;
      if (page.totalCount !== total) throw new Error("issue population changed during pagination; measure another snapshot");
      for (const i of page.nodes) {
        if (i.labels.pageInfo.hasNextPage) throw new Error(`label pagination incomplete at #${i.number}`);
        issues.push({ number:i.number, title:i.title, body:i.body, state:i.state, updatedAt:i.updatedAt, closedAt:i.closedAt,
          labels:i.labels.nodes.map((l: {name:string}) => l.name), parent:i.parent?.number ?? null, children:children(i.number,i.subIssues) });
      }
      if (!page.pageInfo.hasNextPage) break;
      cursor=page.pageInfo.endCursor;
      if (!cursor || seen.has(cursor)) throw new Error("issue pagination stopped before completion");
      seen.add(cursor);
    }
    if (issues.length !== total) throw new Error("issue count does not match the paginated population");
    const pages = JSON.parse(run(["api", "--method", "GET", "--paginate", "--slurp", `repos/${name}/branches?per_page=100`])) as {name:string}[][];
    for (const page of pages) for (const b of page) branches.push(b.name);
    return { version:1, complete:true, capturedAt:now, issues, branches, refs:[...refs] };
  } catch (e) { return { version:1, complete:false, capturedAt:now, issues, branches, refs:[...refs], reason:e instanceof Error ? e.message : String(e) }; }
}

/** Canonical lists are Markdown Rows sections on their owning pages (#643).
 * Backticked row IDs in a list are declarations; prose examples elsewhere are not.
 */
export function parseRowLists(page: string, markdown: string): RowList[] {
  const out:RowList[]=[];let inRows=false,name=page,fence:string|null=null;
  for(const line of markdown.split("\n")) {
    const marker=/^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if(marker){if(fence===null)fence=marker;else if(marker[0]===fence[0]&&marker.length>=fence.length)fence=null;continue;}
    if(fence!==null)continue;
    if(/^#{1,2} /.test(line)){inRows=/^## Rows\b/.test(line);name=line.replace(/^#+ /,"");}
    else if(inRows&&/^### /.test(line))name=line.slice(4);
    else if(inRows&&/^\s*- /.test(line)){
      const rows=[...line.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)*)`/g)].map(m=>m[1]!);
      if(rows.length)out.push({page,name,rows});
    }
  }
  return out;
}
export function rowLists(root: string): RowList[] {
  const dir=join(root,"docs/foundations"),pages=readdirSync(dir).filter(p=>p.endsWith(".md")).map(p=>`docs/foundations/${p}`);
  if(existsSync(join(root,"docs/primitives.md")))pages.push("docs/primitives.md");
  return pages.flatMap(page=>parseRowLists(page,readFileSync(join(root,page),"utf8")));
}
/** Local task branches and cited pins share the repository's object store. */
export function localRefs(root: string): string[] {
  const result=spawnSync("git",["-C",root,"for-each-ref","--format=%(refname)%09%(refname:short)","refs/heads","refs/cited","refs/archive"],{encoding:"utf8"});
  if(result.error||result.status!==0)throw new Error("local branch/ref inventory is incomplete");
  return result.stdout.trim().split("\n").filter(Boolean).flatMap(line=>line.split("\t"));
}
export function projectOptions(root: string, protected_: number[]=[]): Options {
  const plan=readFileSync(join(root,"docs/plan.md"),"utf8");
  const streams=[...plan.matchAll(/^\|[^\n]+\[#([1-9][0-9]*)\]\(https:\/\/github\.com\/[^\n]+$/gm)].map(m=>Number(m[1]));
  const cases=readdirSync(join(root,"benchmarks/cases"),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name);
  return {streams,cases,rows:rowLists(root),protected:protected_,exists:path=>!path.split("/").includes("..") && existsSync(join(root,path))};
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const args=process.argv.slice(2), value=(flag:string)=>{const at=args.indexOf(flag);return at<0?undefined:args[at+1];};
    const file=value("--snapshot"), root=resolve(value("--root")??fileURLToPath(new URL("../../",import.meta.url)));
    const protected_=value("--protect")?.split(",").map(Number)??[];
    if(protected_.some(n=>!Number.isSafeInteger(n)||n<1)) throw new Error("--protect needs positive issue numbers");
    const snapshot=file?JSON.parse(readFileSync(file,"utf8")) as Snapshot:capture(gh,new Date().toISOString(),localRefs(root));
    const report=audit(snapshot,projectOptions(root,protected_));
    if(args.includes("--json")) process.stdout.write(JSON.stringify(report,null,2)+"\n");
    else {process.stdout.write(`${report.open} open issues; ${report.complete?"complete":"INCOMPLETE"}; ${report.errors} errors, ${report.warnings} warnings\n`);for(const f of report.findings)process.stdout.write(`${f.severity} ${f.issue?`#${f.issue} `:""}${f.code}: ${f.message}\n`);}
    process.exitCode=!report.complete?2:report.errors?1:0;
  } catch(e){process.stderr.write(`tasks audit incomplete: ${e instanceof Error?e.message:String(e)}\n`);process.exitCode=2;}
}
