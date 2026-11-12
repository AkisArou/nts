import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,statSync,utimesSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {SourceFacts,GeneratedSourceFacts} from './source-facts.ts';
import {shellCommands} from './shell-commands.ts';
import {inspectGitInvocations,inspectShellGit,inspectPythonGit,inspectGeneratedGitShells,recordGitDebt,parseGitDebt,gitInvocationProblems,type GitInvocation} from './git-observations.ts';
import {gitArguments} from './git-arguments/main.ts';
import {inspectRecordPublications} from './test-readiness.ts';
import {testScratch} from './test-scratch.ts';
import {spawnTest} from './test-wait.ts';
import {generatedJavaScript} from './generated-javascript.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {scratchRepo} from '../landing/scratch-repo.ts';
import {Pool} from '../landing/pool.ts';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';

const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync');
function inspect(source:string){const api=new API(),lease=api.createSourceFile('tooling/gate/control.ts',source);
  try{return inspectGitInvocations(new SourceFacts('tooling/gate/control.ts',source,lease.sourceFile));}finally{lease.dispose();api.close();}}

test('the leaf disables optional refresh and preserves mutation arguments',()=>{
  assert.deepEqual(gitArguments(['status','--porcelain']),['--no-optional-locks','status','--porcelain']);
  assert.deepEqual(gitArguments(['add','--','file']),['--no-optional-locks','add','--','file']);
  assert.deepEqual(gitArguments(gitArguments(['commit','-m','message'])),['--no-optional-locks','commit','-m','message']);
});

test('the oracle compiles the Git leaf under its own one-file project',()=>{
  const entry=fileURLToPath(new URL('./git-arguments/main.ts',import.meta.url));
  const project=new OracleFilesystem().projectFor(entry);
  assert.equal(project,fileURLToPath(new URL('./git-arguments/tsconfig.json',import.meta.url)));
  const api=new API();
  try{
    const parsed=api.parseConfigFile(project!);assert.deepEqual(parsed.fileNames,[entry]);
    const program=api.createProgram(parsed.fileNames,parsed.options);
    try{assert.deepEqual([...parsed.errors,...program.getProgramDiagnostics(),...program.getGlobalDiagnostics(),
      ...program.getSyntacticDiagnostics(),...program.getBindDiagnostics(),...program.getSemanticDiagnostics()],[]);}
    finally{program.dispose();}
  }finally{api.close();}
});

test('command positions include aliases, arbitrary forwarders, vectors and probe objects',()=>{
  const rows=inspect(`import {gitArguments as protect} from './git-arguments/main.ts';
const git='git';run(git,protect(['status']));command('git',['diff']);
const vector=['git',...protect(['log'])],bad=['git','status'];
probe({command:git,args:protect(['rev-parse','HEAD'])});probe({command:'git',args:['status']});`);
  assert.deepEqual(rows.map(row=>[row.kind,row.protected]),[['call',true],['call',false],['argv',true],['argv',false],['probe',true],['probe',false]]);
  assert.equal(gitInvocationProblems(rows,{version:1,sites:[]}).length,3);
});

test('lookalikes and shadowed argument owners cannot bless an invocation',()=>{
  const rows=inspect(`import {gitArguments} from './lookalike.ts';
run('git',gitArguments(['status']));function local(gitArguments:Function){run('git',gitArguments(['status']));}`);
  assert.equal(rows.length,2);assert.ok(rows.every(row=>!row.protected));
  assert.deepEqual(inspect(`const prose="run('git',['status'])";const data={meaning:'git'};`),[]);
});

test('shell facts distinguish arguments from prose, substitutions and redirects',()=>{
  const source=`printf '%s' 'git status'\ncat <<'DATA'\ngit status\nDATA\n"git" '--no-optional-locks' status > output\nresult=$(git status)\n`;
  const rows=inspectShellGit('tooling/control.sh',source,shellCommands(source));
  assert.deepEqual(rows.map(row=>row.protected),[true,false]);
  assert.equal(rows[0]!.source,'"git" \'--no-optional-locks\' status');
});

test('generated scripts and shell launch payloads share the same audit',()=>{
  const api=new API(),source=`import {generatedJavaScript} from './generated-javascript.ts';
const code=generatedJavaScript("const cp=require('node:child_process');cp.spawnSync('git',['status']);");
spawn('sh',['-c','git --no-optional-locks status']);`;
  const lease=api.createSourceFile('tooling/gate/control.ts',source),facts=new SourceFacts('tooling/gate/control.ts',source,lease.sourceFile),generated=new GeneratedSourceFacts(api,facts.file),rows:GitInvocation[]=[];
  try{inspectRecordPublications(facts.file,source,api,facts,(_source,tree,offset)=>rows.push(...inspectGitInvocations(tree,offset)),generated);
    rows.push(...inspectGeneratedGitShells(generated.shells));assert.deepEqual(rows.map(row=>row.protected),[false,true]);
  }finally{generated.close();lease.dispose();api.close();}
});

test('Python argv positions come from its parser without executing its modules',()=>{
  const rows=inspectPythonGit([{file:'tooling/control.py',source:`raise Exception('never execute')\ncommands=[['git','status'],['git','--no-optional-locks','status']]\ntext="['git','status']"\n`}]);
  assert.deepEqual(rows.map(row=>row.protected),[false,true]);
});

test('the tool-written ceiling permits only the same source sites to fall',t=>{
  const file=join(testScratch(t,'git-debt'),'record.json'),rows=inspect("run('git',['status']);run('git',['status']);");
  recordGitDebt(file,rows);const initial=parseGitDebt(JSON.parse(readFileSync(file,'utf8')));assert.equal(initial.sites[0]?.count,2);
  recordGitDebt(file,rows.slice(1),initial);const lowered=parseGitDebt(JSON.parse(readFileSync(file,'utf8')));assert.equal(lowered.sites[0]?.count,1);
  assert.throws(()=>recordGitDebt(file,inspect("run('git',['diff']);"),lowered),/must disable optional index locks/);
  assert.throws(()=>recordGitDebt(file,rows,lowered),/must disable optional index locks/);
  const future='{"version":2,"opaque":true}\n';writeFileSync(file,future);
  assert.throws(()=>recordGitDebt(file,[],lowered),/version 2|newer/);assert.equal(readFileSync(file,'utf8'),future);
});

test('observing a pool leaves every index byte and write statistic unchanged while commits still work',t=>{
  const s=scratchRepo(t,'git-observation'),p=new Pool(join(s.dir,'pool'),{root:s.root,env:s.env});
  s.commit({'tracked.txt':'contents\n'},'tracked input');p.init(1);
  const tree=p.trees()[0]!,index=s.git(['rev-parse','--path-format=absolute','--git-path','index'],tree.path);
  const writeStat=()=>{const row=statSync(index,{bigint:true});return {dev:row.dev,ino:row.ino,size:row.size,mode:row.mode,mtime:row.mtimeNs,ctime:row.ctimeNs};};
  // Access time is excluded: the test's own byte reads may update it. Every
  // statistic that can show an index write or replacement remains compared.
  const root=testScratch(t,'git-observation-stages');
  for(const [name,protect]of [['control',false],['protected',true]]as const){
    const stage=join(root,name);copyModuleClosure(['tooling/landing/pool.ts'],stage);
    if(!protect)writeFileSync(join(stage,'tooling/gate/git-arguments/main.ts'),'export function gitArguments(argv:readonly string[]){return [...argv];}');
    utimesSync(join(tree.path,'tracked.txt'),protect?2:1,protect?2:1);
    const bytes=readFileSync(index),before=writeStat();
    const program=generatedJavaScript(`const {Pool}=await import(${JSON.stringify(pathToFileURL(join(stage,'tooling/landing/pool.ts')).href)});new Pool(process.argv[1],{root:process.argv[2]}).trees();`);
    // The canonical fixture ambient already disables optional locks. Own the
    // opposite input here so only the argv owner can protect this observer.
    const result=spawnTest(process.execPath,['--input-type=module','-e',program,p.dir,s.root],{env:{...s.env,GIT_OPTIONAL_LOCKS:'1'},encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);
    const afterBytes=readFileSync(index),after=writeStat();
    if(protect){assert.deepEqual(afterBytes,bytes);assert.deepEqual(after,before);}
    else assert.notDeepEqual(afterBytes,bytes,'the control forced a real refresh opportunity');
  }
  const held=p.take('index-writer'),commit=s.commit({'tracked.txt':'new contents\n'},'required locks still work',held.path);
  assert.equal(s.git(['rev-parse','HEAD'],held.path),commit);
});
