// node --test tooling/full-check/scratch-prune.test.ts
//
// The scratch pruner over a fixture ~/.cache: committed records are supplied
// whole, issue state is supplied, and the folder is real. Each wrong-accept
// input (a spelling of a citation the pruner could miss) is a control that
// must keep its target; each refusal removes nothing.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {test,type TestContext} from 'node:test';
import {applyFolder,expandBraces,planFolder,removeListed,verifyFolder,type IssueState,type PlanInput} from './scratch-prune.ts';
import {citationTokens,jsonStrings,scratchRecordCitations,type CitingRecord} from './keep.ts';

const ISSUE=4242,FOLDER=`nts-scratch/${ISSUE}`;
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');

function fixture(t:TestContext,files:Record<string,string>){
  const cache=mkdtempSync(join(tmpdir(),'scratch-prune-'));
  t.after(()=>{chmodTree(cache);rmSync(cache,{recursive:true,force:true});});
  const root=join(cache,FOLDER);mkdirSync(root,{recursive:true});
  for(const [path,text] of Object.entries(files)){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);}
  const input=(records:CitingRecord[],state:IssueState='CLOSED'):PlanInput=>({cache,issue:ISSUE,state,records});
  return {cache,root,input,has:(path:string)=>existsSync(join(root,path))||isLink(join(root,path))};
}
const isLink=(path:string)=>{try{return lstatSync(path).isSymbolicLink();}catch{return false;}};
/** Read-only fixture directories become removable again for cleanup. */
function chmodTree(path:string){if(!lstatSync(path).isDirectory())return;chmodSync(path,0o755);for(const name of readdirSync(path))chmodTree(join(path,name));}
const record=(text:string,path='docs/records/r.md'):CitingRecord=>({path,text});
const kept=(f:{input:(r:CitingRecord[])=>PlanInput},records:CitingRecord[])=>{
  const {plan,remove,kept}=planFolder(f.input(records));
  return {plan,removed:new Set(remove.map(e=>e.path)),kept:new Set(kept.map(k=>k.entry.path))};
};

test('every spelling of a citation keeps its target: home and cache forms, a directory, a relative table, braces, punctuation, no digest',t=>{
  const f=fixture(t,{
    'home.log':'h','dollar.log':'d','braced-home.log':'b','absolute.log':'a','bare.log':'n',
    'dir/a.json':'1','dir/nested/b.json':'2',
    'table/x.json':'x','table/y.json':'y',
    'phi/before/s.json':'pb','phi/after/s.json':'pa',
    'dot.json':'dot','paren.json':'paren',
    'json-root/rows.json':'rows','json-root/other.json':'other',
    'uncited.bin':'junk','junk/deep/file':'junk',
  });
  const text=[
    `Raw outputs remain under \`~/.cache/${FOLDER}/\`.`,'',
    `See \`~/.cache/${FOLDER}/home.log\` and $HOME/.cache/${FOLDER}/dollar.log and \${HOME}/.cache/${FOLDER}/braced-home.log.`,
    `The absolute ${f.cache}/${FOLDER}/absolute.log and the bare ${FOLDER}/bare.log.`,
    `Saved files are under \`~/.cache/${FOLDER}/dir/\`.`,'',
    `| file relative to scratch/${ISSUE} | SHA-256 |`,'|---|---|',
    `| \`table/x.json\` | \`${sha('x')}\` |`,'| `table/y.json` | |','',
    `Both arms are in \`~/.cache/${FOLDER}/phi/{before,after}/\`.`,
    `It ends a sentence ~/.cache/${FOLDER}/dot.json. And (${FOLDER}/paren.json).`,
  ].join('\n');
  const json=record(JSON.stringify({root:`/home/someone/.cache/${FOLDER}/json-root`,files:['rows.json']},null,1),'results/gate/r.json');
  const r=kept(f,[record(text),json]);
  assert.deepEqual(r.plan.refusals,[]);
  for(const path of ['home.log','dollar.log','braced-home.log','absolute.log','bare.log','dir','dir/a.json','dir/nested','dir/nested/b.json',
    'table/x.json','table/y.json','phi/before/s.json','phi/after/s.json','dot.json','paren.json','json-root','json-root/rows.json','json-root/other.json'])
    assert.ok(r.kept.has(path),`${path} is cited and kept`);
  for(const path of ['uncited.bin','junk','junk/deep','junk/deep/file'])assert.ok(r.removed.has(path),`${path} is not cited and removed`);
  const x=r.plan.kept.find(k=>k.path==='table/x.json')!,y=r.plan.kept.find(k=>k.path==='table/y.json')!;
  assert.equal(x.verification,'verified');assert.equal(y.verification,'sha-less');
  assert.equal(r.plan.kept.find(k=>k.path==='dir')!.why,'directory');
});

test('the folder root is an anchor: a record citing only the root keeps nothing by itself',t=>{
  const f=fixture(t,{'a.log':'a','b/c.log':'c'});
  const r=kept(f,[record(`Raw output remains under ~/.cache/${FOLDER}, and ~/.cache/${FOLDER}/.`)]);
  assert.deepEqual(r.plan.refusals,[]);assert.equal(r.kept.size,0);
  assert.deepEqual([...r.removed].sort(),['a.log','b','b/c.log']);
});

test('issue boundaries: a citation of issue 7610 neither cites nor keeps anything of 761',()=>{
  assert.deepEqual(scratchRecordCitations('nts-scratch/7610/raw.json and ~/.cache/nts-scratch/7610`','/c'),['nts-scratch/7610']);
  assert.deepEqual(citationTokens('nts-scratch/7610/raw.json ~/.cache/nts-scratch/7610/','nts-scratch/761').tokens.filter(t=>t.form==='absolute'),[]);
  assert.deepEqual(scratchRecordCitations('$HOME/.cache/nts-scratch/12 and ${HOME}/.cache/nts-scratch/13.','/c'),['nts-scratch/12','nts-scratch/13']);
});

test('an open issue, an unknown issue state and unreadable records refuse the folder, and apply removes nothing',t=>{
  const f=fixture(t,{'a.log':'a','uncited':'u'});
  const records=[record(`\`~/.cache/${FOLDER}/a.log\``)];
  for(const state of ['OPEN',{error:'gh offline'}] as IssueState[]){
    const {plan}=planFolder(f.input(records,state));
    assert.ok(plan.refusals.some(r=>r.startsWith(`issue #${ISSUE} is`)),plan.refusals.join('\n'));
    assert.equal(applyFolder(plan,f.input(records,state)).status,'refused');
  }
  assert.ok(planFolder({...f.input(records),records:{error:'main unreadable'}}).plan.refusals.some(r=>r.includes('main unreadable')));
  assert.ok(planFolder(f.input([])).plan.refusals.some(r=>r.includes('no committed record cites')));
  assert.ok(f.has('uncited'));
});

test('a cited file whose SHA-256 disagrees refuses the folder; a digest of something else beside it does not',t=>{
  const f=fixture(t,{'a.log':'a','b.log':'b','uncited':'u'});
  const bad=[record(`The log is \`~/.cache/${FOLDER}/a.log\`, SHA-256 \`${sha('not a')}\`.`)];
  const refused=planFolder(f.input(bad)).plan;
  assert.ok(refused.refusals.some(r=>r.includes('a.log has SHA-256')),refused.refusals.join('\n'));
  assert.equal(applyFolder(refused,f.input(bad)).status,'refused');assert.ok(f.has('uncited'));
  const tableBad=[record(`| \`a.log\` | \`${sha('nope')}\` |\n\nunder ~/.cache/${FOLDER}/`)];
  assert.ok(planFolder(f.input(tableBad)).plan.refusals.some(r=>r.includes('a.log has SHA-256')));
  // JSON pairs by structure: frozenSha256 beside an analysis path is not its digest.
  const json=record(JSON.stringify({reproduction:{analysis:`/home/u/.cache/${FOLDER}/a.log`,frozenSha256:sha('elsewhere')},
    log:{file:`/home/u/.cache/${FOLDER}/b.log`,sha256:sha('b')}},null,1),'results/r.json');
  const r=planFolder(f.input([json])).plan;
  assert.deepEqual(r.refusals,[]);
  assert.equal(r.kept.find(k=>k.path==='a.log')!.verification,'sha-less');
  assert.equal(r.kept.find(k=>k.path==='b.log')!.verification,'verified');
  const jsonBad=record(JSON.stringify({log:`/home/u/.cache/${FOLDER}/b.log`,logSha256:sha('not b')}),'results/r.json');
  assert.ok(planFolder(f.input([jsonBad])).plan.refusals.some(r=>r.includes('b.log has SHA-256')));
});

test('a digest after another file named in prose belongs to that file, not the cited one',t=>{
  const f=fixture(t,{'exp/restoration.json':'r'});
  const text=`Under \`~/.cache/${FOLDER}/exp/\`.\n\n\`restoration.json\` verifies each file against its blob: own.rs\n\`${sha('own.rs')}\`.`;
  const {plan}=planFolder(f.input([record(text)]));
  assert.deepEqual(plan.refusals,[]);
});

test('an absolute citation that names nothing refuses the folder',t=>{
  const f=fixture(t,{'a.log':'a'});
  const {plan}=planFolder(f.input([record(`Kept in ~/.cache/${FOLDER}/missing/summary.json.`)]));
  assert.ok(plan.refusals.some(r=>r.includes('names nothing')&&r.includes('missing/summary.json')),plan.refusals.join('\n'));
});

test('a link out of the folder is never followed: it is removed as a link, its target untouched; hashed through it refuses',t=>{
  const f=fixture(t,{'inside/target.json':'t','cited-link-dir/.keep':''});
  const outside=join(f.cache,'outside');mkdirSync(join(outside,'deep'),{recursive:true});writeFileSync(join(outside,'deep','file'),'precious');
  symlinkSync(outside,join(f.root,'escape'));
  symlinkSync('../../../outside/deep/file',join(f.root,'cited-link-dir','escape-file'));
  symlinkSync('inside',join(f.root,'inner'));
  const records=[record(`Evidence: \`~/.cache/${FOLDER}/inner/target.json\`.`)];
  const r=kept(f,records);
  assert.deepEqual(r.plan.refusals,[]);
  assert.ok(r.kept.has('inner')&&r.kept.has('inside/target.json'),'an in-folder link keeps its target');
  assert.ok(r.removed.has('escape'));assert.ok(![...r.removed].some(p=>p.startsWith('escape/')),'the link out is not walked');
  const through=[record(`\`~/.cache/${FOLDER}/cited-link-dir/escape-file\`, SHA-256 \`${sha('precious')}\``)];
  assert.ok(planFolder(f.input(through)).plan.refusals.some(r=>r.includes('link out of the folder')));
  const unhashed=planFolder(f.input([record(`\`~/.cache/${FOLDER}/cited-link-dir/escape-file\``)])).plan;
  assert.deepEqual(unhashed.refusals,[]);
  assert.equal(unhashed.kept.find(k=>k.path==='cited-link-dir/escape-file')!.verification,'escaping-link');
  {const a=applyFolder(r.plan,f.input(records));assert.equal(a.status,'removed',a.lines.join('\n'));}
  assert.ok(!isLink(join(f.root,'escape')));assert.equal(readFileSync(join(outside,'deep','file'),'utf8'),'precious');
  assert.ok(existsSync(join(f.root,'inside/target.json')));
});

test('one hop of binding: a cited manifest keeps the files it hashes, and no further',t=>{
  const f=fixture(t,{'projects/per-project.json':'pp','projects/hir.txt':'hir','loose.log':'loose','unhashed.log':'u'});
  writeFileSync(join(f.root,'projects/per-project.json'),JSON.stringify({capture:'hir.txt',sha256:sha('hir')}));
  const pp=readFileSync(join(f.root,'projects/per-project.json'),'utf8');
  writeFileSync(join(f.root,'census.json'),JSON.stringify({reports:{'projects/per-project.json':sha(pp)},log:'unhashed.log'}));
  const records=[record(`The census decision report is \`~/.cache/${FOLDER}/census.json\`.`)];
  const r=kept(f,records);
  assert.deepEqual(r.plan.refusals,[]);
  assert.ok(r.kept.has('projects/per-project.json'),'bound by digest');
  assert.equal(r.plan.kept.find(k=>k.path==='projects/per-project.json')!.why,'binding');
  assert.ok(r.removed.has('projects/hir.txt'),'a second hop is not followed');
  assert.ok(r.removed.has('unhashed.log'),'a name without its digest does not bind');
  assert.ok(r.removed.has('loose.log'));
  assert.equal(r.plan.totals.binding.entries,1);
  // A binding whose file has since changed keeps that file and says so; it
  // does not refuse, since keeping it loses nothing.
  writeFileSync(join(f.root,'census.json'),JSON.stringify({reports:{'projects/per-project.json':sha('stale')}}));
  const stale=kept(f,records);
  assert.deepEqual(stale.plan.refusals,[]);
  assert.ok(stale.kept.has('projects/per-project.json'));
  assert.equal(stale.plan.kept.find(k=>k.path==='projects/per-project.json')!.verification,'stale-binding');
  assert.ok(stale.plan.notes.some(n=>n.includes('binds projects/per-project.json')));
  // A log pairs a path only with the one digest on its own line.
  writeFileSync(join(f.root,'census.json'),'{');
  writeFileSync(join(f.root,'run.log'),`ran ${f.root}/projects/per-project.json\nsome archive-sha256 ${sha('other')}\n${sha('loose')}  loose.log\n${sha('nope')}  unhashed.log\n`);
  const log=kept(f,[record(`The run log is \`~/.cache/${FOLDER}/run.log\`.`)]);
  assert.deepEqual(log.plan.refusals,[]);
  assert.ok(log.removed.has('projects/per-project.json'),'named on a line without its digest: not bound');
  assert.equal(log.plan.kept.find(k=>k.path==='loose.log')?.verification,'verified');
  assert.equal(log.plan.kept.find(k=>k.path==='unhashed.log')?.verification,'stale-binding');
});

test('apply removes exactly the dry run, through read-only directories, and verify then holds',t=>{
  const f=fixture(t,{'keep/a.json':'a','ro/x/y':'y','ro/z':'z','keep-ro/k':'k','keep-ro/gone':'g','top.log':'t'});
  chmodSync(join(f.root,'ro/x'),0o555);chmodSync(join(f.root,'ro'),0o555);chmodSync(join(f.root,'keep-ro'),0o555);
  const records=[record(`\`~/.cache/${FOLDER}/keep/a.json\` and \`~/.cache/${FOLDER}/keep-ro/k\``)];
  const {plan,remove}=planFolder(f.input(records));
  assert.deepEqual(remove.map(e=>e.path).sort(),['keep-ro/gone','ro','ro/x','ro/x/y','ro/z','top.log']);
  const result=applyFolder(plan,f.input(records));
  assert.equal(result.status,'removed',result.lines.join('\n'));
  for(const path of ['keep/a.json','keep-ro/k'])assert.ok(f.has(path));
  for(const path of ['ro','top.log','keep-ro/gone'])assert.ok(!f.has(path));
  assert.equal(lstatSync(join(f.root,'keep-ro')).mode&0o777,0o555,'a kept directory keeps its mode');
  assert.ok(verifyFolder(f.input(records)).ok);
});

test('apply refuses a reopened issue, a changed folder or a new citation since the dry run',t=>{
  const files={'a.log':'a','b.log':'b','c.log':'c'};
  const records=[record(`\`~/.cache/${FOLDER}/a.log\``)];
  const cases:[string,(f:ReturnType<typeof fixture>)=>CitingRecord[]|IssueState][]=[
    ['reopened',()=>'OPEN'],
    ['entry added',f=>{writeFileSync(join(f.root,'new.log'),'n');return records;}],
    ['entry changed',f=>{writeFileSync(join(f.root,'b.log'),'B!');return records;}],
    ['entry removed',f=>{rmSync(join(f.root,'c.log'));return records;}],
    ['new citation',()=>[...records,record(`\`~/.cache/${FOLDER}/b.log\``,'docs/records/later.md')]],
    ['kept entry changed in mode only',f=>{chmodSync(join(f.root,'a.log'),0o600);return records;}],
  ];
  for(const [name,change] of cases){
    const f=fixture(t,files),{plan}=planFolder(f.input(records));
    assert.deepEqual(plan.refusals,[]);
    const changed=change(f);
    const input=typeof changed==='string'||!Array.isArray(changed)?f.input(records,changed as IssueState):f.input(changed);
    const result=applyFolder(plan,input);
    assert.equal(result.status,'refused',`${name}: ${result.lines.join('; ')}`);
    assert.ok(f.has('a.log'));
    assert.ok(name==='entry removed'||f.has('c.log'),`${name}: nothing removed`);
  }
});

test('a listed entry replaced after the last check is not removed: each unlink matches inode and ctime',t=>{
  const f=fixture(t,{'a.log':'a','b.log':'b'});
  const {remove}=planFolder(f.input([record(`\`~/.cache/${FOLDER}/a.log\``)]));
  writeFileSync(join(f.root,'b.log'),'rewritten');
  const result=removeListed(f.root,remove);
  assert.equal(result.removed,0);assert.match(result.error??'',/b\.log changed since the dry run/);
  assert.equal(readFileSync(join(f.root,'b.log'),'utf8'),'rewritten');
});

test('brace expansion and JSON string structure',()=>{
  assert.deepEqual(expandBraces('b/{x,y}/{1,2}'),['b/x/1','b/x/2','b/y/1','b/y/2']);
  assert.deepEqual(expandBraces('no{brace'),['no{brace']);
  const strings=jsonStrings('{"a":"p","b":{"c":"q"},"l":["r"]}')!;
  assert.deepEqual(strings.map(s=>[s.value,s.slot.key,s.slot.isKey]),[['a','a',true],['p','a',false],['b','b',true],['c','c',true],['q','c',false],['l','l',true],['r',null,false]]);
  assert.equal(jsonStrings('# not json'),null);
});
