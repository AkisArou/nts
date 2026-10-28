// Scratch repositories expose the same selection API as the real rule module.
export function selectorFixture({
  steps = 'existsSync("INTEROP") ? ["fake", "interop"] : ["fake"]',
  projects = 'existsSync("INTEROP") ? readFileSync("INTEROP", "utf8").trim().split(/\\s+/) : null',
  body = "",
}: { steps?: string; projects?: string; body?: string } = {}): string {
  return `import {execFileSync} from "node:child_process";
import {existsSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
export function changedPaths(argv) {
  const range=argv[argv.indexOf("--range")+1];
  return execFileSync("git",["diff","--name-only",range],{encoding:"utf8"}).trim().split("\\n").filter(Boolean).map(path=>({path}));
}
export function owed(changes) {
  ${body}
  return [{name:"scratch selector",paths:changes.map(c=>c.path),steps:${steps},interop:${projects},arms:[]}];
}
export const gateSteps=rules=>[...new Set(rules.flatMap(r=>r.steps))];
export const allSteps=()=>["fake","interop","tree-check","other","memory","dex","format","on-device"];
export const interopOwed=rules=>rules.find(r=>r.steps.includes("interop"))?.interop??null;
export const isStrictPath=()=>true;
export const selfTest=()=>null;
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const rules=owed(changedPaths(process.argv.slice(2))),p=interopOwed(rules);
  console.log('NTS_GATE_STEPS="'+gateSteps(rules).join(" ")+'"'+(p?' NTS_INTEROP_PROJECTS="'+p.join(" ")+'"':"")+" sh tooling/gate/all.sh");
}
`;
}
