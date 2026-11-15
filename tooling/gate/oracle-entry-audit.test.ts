import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {inspectSourceBatches,type SourceInput} from './source-facts.ts';
import {oracleEntryFacts,auditOracleEntries,type OracleEntryFacts} from './oracle-entry-audit.ts';
import {shellCommands} from './shell-commands.ts';

function inspect(source:string){
  const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync');
  const api=new API(),modules=new Map<string,OracleEntryFacts>();
  const sources:SourceInput[]=[
    {file:'tooling/gate/entry.ts',source},
    {file:'tooling/differential/check-command.ts',source:'export function runCheck(){}'},
    {file:'tooling/differential/check-report.ts',source:'export function decodeCheck(){}'},
  ];
  try{inspectSourceBatches(api,sources,facts=>modules.set(facts.file,oracleEntryFacts(facts)));}
  finally{api.close();}
  return modules;
}
const imports="import {runAsCommand} from '../differential/command-entry/main.ts'; import {runCheck} from '../differential/check-command.ts';\n";
test('an unowned entry and an unused or wrong preparation function refuse by entry name',()=>{
  for(const body of [
    "runAsCommand(import.meta.url,()=>runCheck());",
    "import {withPreparedOracle} from './canonical-environment.ts'; function unused(){withPreparedOracle(()=>{});} runAsCommand(import.meta.url,()=>runCheck());",
    "import {withPreparedOracle} from './fake.ts'; runAsCommand(import.meta.url,async()=>{await withPreparedOracle(()=>{});runCheck();});",
  ]){
    const result=auditOracleEntries(inspect(imports+body),[]);
    assert.equal(result.problems.length,1);
    assert.match(result.problems[0]!,/tooling\/gate\/entry.ts: oracle consumer has no preparation owner/);
  }
});
test('a standalone owner and an explicit consume-only handoff cover the actual entry body',()=>{
  for(const [prefix,body,kind] of [
    ["import {withPreparedOracle} from './canonical-environment.ts';",'await withPreparedOracle(()=>{}, {entry:import.meta.url,ambient:true});','prepared'],
    ["import {requireSealedOracleRun} from './host-environment.ts';",'requireSealedOracleRun(process.env);','sealed-parent'],
  ]){
    const result=auditOracleEntries(inspect(imports+prefix+`runAsCommand(import.meta.url,async()=>{${body}runCheck();});`),[]);
    assert.deepEqual(result.problems,[]);
    assert.equal(result.rows.find(row=>row.entry==='tooling/gate/entry.ts')?.kind,kind);
  }
});
test('a report-only import remains a reader without acquiring preparation',()=>{
  const modules=inspect("import {runAsCommand} from '../differential/command-entry/main.ts'; import {decodeCheck} from '../differential/check-report.ts'; runAsCommand(import.meta.url,()=>decodeCheck());");
  assert.deepEqual(auditOracleEntries(modules,[]).problems,[]);
  assert.equal(auditOracleEntries(modules,[]).rows[0]?.kind,'no-consumer');
});
test('the shell inventory includes a consumer after a redirected substitution and prefixes',()=>{
  const modules=inspect(imports+'runAsCommand(import.meta.url,()=>runCheck());');
  const source='node unrelated.ts "$(cat < input)" # comment\ntimeout 10 node tooling/gate/entry.ts\n';
  const result=auditOracleEntries(modules,[{file:'tooling/launch.sh',source,shell:shellCommands(source)}]);
  assert.ok(result.problems.some(row=>row.startsWith('tooling/launch.sh:')));
});
