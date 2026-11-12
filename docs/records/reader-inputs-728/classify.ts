import {pathToFileURL} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const base=pathToFileURL(process.argv[2]+'/'),capture=JSON.parse(readFileSync(new URL('./frontiers.json',base),'utf8'));
type Role='reader'|'data'|'project-context'|'existing-import'|'generator-provenance';
const dataModules=new Set(`tooling/migrate/table.ts
tooling/full-check/service.ts
tooling/full-check/state.ts
tooling/records/summary.ts
tooling/gate/test-fixture-copies.ts
tooling/gate/test-host-owners.ts
tooling/gate/test-profile-audit.ts
tooling/gate/test-readiness.ts
tooling/differential/oracle-execution.ts
tooling/bench/run-outcomes.ts
tooling/bench/outcomes.ts
tooling/gate/test-host-audit.ts
tooling/census/audit.ts
tooling/bootstrap/typescript.ts
tooling/gate/compile-counter-calibrate.ts
tooling/gate/registry-inputs-fixture.ts
tooling/inputs/node-inputs-test-fixture.ts
tooling/gate/test-layout.ts
tooling/gate/step-table.mjs
tooling/migrate/old-paths.ts
tooling/landing/scratch-repo.ts
tooling/conformance/outcomes-verdict.ts
tooling/census/typescript-record.ts
tooling/census/generate/writer.ts`.split('\n'));
const readerModules=new Set(`tooling/conformance/web-platform/unrouted.mjs
tooling/differential/check-consumers.ts
tooling/records/record-pending.ts
tooling/differential/oracle-records.ts
tooling/differential/oracle-runtime.ts
tooling/differential/program-oracles.ts
tooling/conformance/expect-ir.ts
tooling/bench/build-records.ts
tooling/bench/run-session.ts
tooling/bootstrap/node.ts
tooling/inputs/linker.ts
tooling/gate/compile-counter.ts
tooling/inputs/node-inputs.ts
tooling/licenses/licenses.ts
tooling/conformance/blockers-check.mjs
tooling/bench/run-record.ts
tooling/bench/groups.ts
tooling/full-check/count.ts
tooling/tasks/audit.ts
tooling/gate/records.ts
tooling/differential/oracle-emit.ts
tooling/android/dex-record.ts
tooling/gate/tooling-types.ts
tooling/gate/environment.ts
tooling/conformance/integrity.ts
tooling/census/definitions.ts
tooling/conformance/assembles.ts
tooling/conformance/types-check.mjs
tooling/conformance/jvm-verifies.ts
tooling/conformance/outcomes-check.ts
tooling/conformance/outcomes-project.ts
tooling/conformance/c-compiles.mjs
tooling/config/audit.mjs
tooling/differential/new-projects.ts
tooling/differential/record-oracles.ts
tooling/gate/inner.ts
tooling/census/conformance262.ts
tooling/census/typescript-oracles.ts
tooling/census/generate/precheck.ts
tooling/conformance/run.mjs
tooling/differential/oracle-filesystem.ts
tooling/differential/agree.mjs
tooling/gate/gate-resource.ts
tooling/gate/tooling-discovery.ts
tooling/gate/module-closure-fixture.ts
tooling/conformance/fuzz-runtime.mjs`.split('\n'));
const entireTestReaders=new Set(`tooling/gate/jvm-launcher-audit.test.ts
tooling/gate/benchmark-inputs.test.ts
tooling/differential/oracle-shared-owner.test.ts
tooling/gate/dex-shadow.test.ts
tooling/gate/artifact-reuse.test.ts
tooling/gate/verifier-worker-infrastructure.test.ts
tooling/gate/blockers-log.test.ts
tooling/bench/layouts-heap.test.ts
tooling/census/audit.test.ts
tooling/gate/corpus.test.ts`.split('\n'));
function classify(site:any):{role:Role;reason:string}{
  const file=site.reader,literal=site.literal;
  if(file.startsWith('tests/typescript/unicode/url-hosts-idna-'))return {role:'generator-provenance',reason:'Generated-output comment names its generator; the generator belongs to freshness checking, not execution of this output.'};
  if(file==='runtime/node/internal/errors.ts'||file==='runtime/node/internal/utf8.ts')return {role:'existing-import',reason:'A real static product import already exists; preserve it through the compiling reader\'s directory/project declaration, without editing product code.'};
  if(file==='runtime/web-platform/test/wpt/versions.ts')return {role:'reader',reason:'The WPT harness reads versions.json.'};
  if(file.startsWith('tests/interop/native-compression/'))return {role:'reader',reason:'The interop verifier executes the named compression tests/provider loader.'};
  if(file==='compiler/frontend-tsrs/vendor.ts')return literal==='tooling/licenses/licenses.ts'?{role:'data',reason:'The licensing command is printed provenance/instructions, not executed here.'}:{role:'reader',reason:'The vendor owner consumes patches and checks its generated names/roles outputs.'};
  if(file.startsWith('compiler/frontend-tsrs/')&&file.endsWith('.test.ts'))return {role:'reader',reason:'The frontend control loads its real sibling generated module or patch data.'};
  if(site.kind==='beside'&&literal==='tsconfig.json')return {role:'project-context',reason:'The basename is resolved against a selected project/private directory, not necessarily beside this reader. Declare the real owning project at the compiling reader; do not preserve this guessed edge blindly.'};
  if(file.endsWith('.test.ts')){
    if(entireTestReaders.has(file))return {role:'reader',reason:'The control reads, compiles, copies or executes this real repository input.'};
    if(file==='tooling/bench/build-records.test.ts'&&literal==='benchmarks/common')return {role:'reader',reason:'The benchmark fixture copies the real common namespace.'};
    if(file==='tooling/gate/dex-bound.test.ts'&&literal==='tooling/android/dexes.sh')return {role:'reader',reason:'The fixture copies and executes the real dex entry.'};
    if(file==='tooling/gate/compile-counter.test.ts'&&literal.endsWith('compile-time.mjs'))return {role:'reader',reason:'The fixture stages and executes the compile-time entry.'};
    if(file==='tooling/gate/check-report-consumers.test.ts'&&/\/(?:run|check)\.sh$/.test(literal))return {role:'reader',reason:'The fixture copies these real shell launchers.'};
    if(file==='tooling/gate/blockers-pool.test.ts'&&literal.endsWith('blockers-check.mjs'))return {role:'reader',reason:'The fixture copies and executes the real blocker entry.'};
    if(file==='tooling/gate/agree-new-projects.test.ts'&&literal.endsWith('agree.mjs'))return {role:'reader',reason:'The fixture stages the real agreement entry.'};
    if(file==='tooling/census/sampling-cli.test.ts'&&literal==='test262-exclusions.json')return {role:'reader',reason:'The private census starts from the real exclusion metadata.'};
    if(file==='tooling/jvm/member-name.test.ts'&&literal.endsWith('module-initializer.sh'))return {role:'reader',reason:'The control reads the real Android initializer script.'};
    if(file==='tooling/census/generate/integration.test.ts'&&literal==='index.ts')return {role:'reader',reason:'The integration control executes the generator CLI.'};
    return {role:'data',reason:'Private fixture paths, expected text, aliases or synthetic source; these literals do not read the corresponding repository input.'};
  }
  if(dataModules.has(file))return {role:'data',reason:'Validation, selection kind, ownership/exclusion table, migration map, output path or diagnostic text; no read of this named repository input.'};
  assert.ok(readerModules.has(file),'classify reader explicitly: '+file);
  if(file==='tooling/differential/oracle-records.ts'&&/\/(?:invalid|unsupported)$/.test(literal))return {role:'data',reason:'Subject exclusions are selection data; the actual parent inventory owns its directory input.'};
  if(file==='tooling/records/record-pending.ts'&&literal==='benchmarks'||file==='tooling/differential/check-consumers.ts'&&literal==='benchmarks')return {role:'data',reason:'The record/consumer mode name is an enum value, not the benchmarks directory.'};
  if(file==='tooling/differential/check-consumers.ts'&&literal.endsWith('/pin.ts')||file==='tooling/gate/compile-counter.ts'&&literal.endsWith('/compile-time.mjs')||file==='tooling/gate/records.ts'&&literal.endsWith('/claim-record.sh')||file==='tooling/census/conformance262.ts'&&literal.endsWith('/rows.ts')||file==='tooling/conformance/blockers-check.mjs'&&literal.endsWith('/bootstrap.sh'))return {role:'data',reason:'A runnable command in a diagnostic is advice, not a reader.'};
  if(file==='tooling/bootstrap/node.ts'&&literal==='build/node-deps/recipes.json')return {role:'data',reason:'Default recipe output location; the Python producer is the actual executable input.'};
  if(file==='tooling/android/dex-record.ts'&&literal!=='results/dex/outcomes.tsv')return {role:'data',reason:'Accepted subject prefixes and diagnostic commands are metadata, not reads of the whole corpus or another launcher.'};
  if(file==='tooling/conformance/integrity.ts'&&literal==='tests/programs/invalid')return {role:'data',reason:'The deliberately untypeable project is an exclusion label.'};
  return {role:'reader',reason:'The production reader enumerates, reads, compiles, executes or checks freshness of this repository input.'};
}
const sites=capture.sites.map((site:any)=>({...site,...classify(site)})),byId=new Map(sites.map((site:any)=>[site.id,site]));
const roleCounts:Record<string,number>={},edgeCounts:Record<string,number>={},byStep:Record<string,any>={};
for(const site of sites)roleCounts[site.role]=(roleCounts[site.role]??0)+1;
const edges=capture.edges.map((edge:any)=>{
  const roles=[...new Set(edge.frontiers.map((id:number)=>(byId.get(id) as any).role))];
  const disposition=roles.some(role=>['reader','existing-import','project-context'].includes(role))?'preserve-or-resolve':roles.includes('generator-provenance')?'freshness':'retire';
  edgeCounts[disposition]=(edgeCounts[disposition]??0)+1;
  const row=byStep[edge.step]??={total:0,'preserve-or-resolve':0,freshness:0,retire:0};row.total++;row[disposition]++;
  return {...edge,disposition};
});
const readers=capture.readers.map((reader:any)=>({...reader,roles:[...new Set(sites.filter((site:any)=>site.reader===reader.reader).map((site:any)=>site.role))]}));
writeFileSync(new URL('./classified.json',base),JSON.stringify({sites,readers,edges},null,2)+'\n');
writeFileSync(new URL('./classified-summary.json',base),JSON.stringify({sites:sites.length,readers:readers.length,roleCounts,edgeCounts,byStep},null,2)+'\n');
writeFileSync(new URL('./classified-sites.tsv',base),'id\treader\tkind\tliteral\trole\tsteps\treason\n'+sites.map((site:any)=>[site.id,site.reader,site.kind,site.literal,site.role,site.lostSteps.join(','),site.reason].join('\t')).join('\n')+'\n');
console.log(JSON.stringify({sites:sites.length,readers:readers.length,roleCounts,edgeCounts,byStep}));
