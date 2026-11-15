import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gitArguments} from './git-arguments/main.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {cargoRuntimeTargets} from './cargo-inputs.ts';
import {selectRange} from './owed-range.ts';
import {RUST_SELECTOR_RECORD} from './rust-selector-record.ts';
import {fullSelectorRepository} from './selector-repository-fixture.ts';

test('the complete Cargo population is selected through live private range endpoints',t=>{
  const directory=mkdtempSync(join(tmpdir(),'selector-population-')),repo=join(directory,basename(directory)+'-repo');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const env={...fixtureEnvironment(t),GIT_AUTHOR_NAME:'test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'test',GIT_COMMITTER_EMAIL:'test@example.invalid'};
  const git=(...args:string[])=>execFileSync('git',gitArguments(['-c','core.hooksPath=/dev/null',...args]),{cwd:repo,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  fullSelectorRepository(t,repo,env);
  const actual=cargoRuntimeTargets(repo),expected=cargoRuntimeTargets(fileURLToPath(new URL('../..',import.meta.url)));
  assert.deepEqual(actual,expected);assert.ok(actual.length>1,'this control must retain the actual complete population');
  assert.equal(existsSync(join(repo,RUST_SELECTOR_RECORD)),true);
  git('rm','--',RUST_SELECTOR_RECORD);git('commit','-qm','wide control requires fresh live runtime projection');
  const base=git('rev-parse','HEAD');git('update-ref','refs/heads/main',base);
  const path='tooling/census/full-population-control.test.ts';
  mkdirSync(join(repo,'tooling/census'),{recursive:true});writeFileSync(join(repo,path),"import {test} from 'node:test';test('new full-population leaf',()=>{});\n");
  git('add',path);git('commit','-qm','new leaf through the complete source population');
  const selected=selectRange(repo,`${base}..HEAD`);
  assert.deepEqual(selected.candidateNewPaths?.paths,[path]);assert.equal(selected.rustRecords?.length,2);
  for(const row of selected.rustRecords!){assert.equal(row.decision.record,'absent-live');assert.match(row.decision.reason,/^missing /);}
  assert.ok(selected.checks.steps.includes('tooling'));
  assert.equal(selected.views.some(view=>view.rules.some(rule=>rule.name==='owes the full gate')),false);
  assert.deepEqual([...selected.checks.steps].sort(),['build','clippy','gate-inputs','jvm-members','old-paths','rustfmt','test-host','tests','tooling','tooling-types']);
});
