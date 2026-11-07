import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {OracleResolutionDomain,ORACLE_NODE_RESOLUTION_RECIPE,type ResolutionDomainRecord} from './oracle-filesystem.ts';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,symlinkSync,realpathSync,lstatSync,readdirSync,readlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename,resolve,sep} from 'node:path';
import {test,type TestContext} from 'node:test';
import {OracleFilesystem,OraclePathPrefixes,validateHostObservations,writeOracleSnapshotIndex,readOracleSnapshotIndex} from './oracle-filesystem.ts';
test('invalid local file URL syntax has a complete empty ESM lookup domain',async t=>{
  const domain=new OracleResolutionDomain({recipe:ORACLE_NODE_RESOLUTION_RECIPE,roots:[],excluded:[],aliases:[],files:[],directories:[],absent:[],scopeAbsent:[],moduleAbsent:[],packages:[]});
  for(const nodeMajor of [26]){
    await t.test('local unobserved '+nodeMajor,()=>assert.equal(domain.prove({nodeMajor,mode:'esm',specifier:'file:///unobserved.js',parent:'/captured/main.mjs',direct:'/unobserved.js'}).complete,false));
    await t.test('CJS spelling '+nodeMajor,()=>assert.equal(domain.prove({nodeMajor,mode:'cjs',specifier:'file://hmm.js',parent:'/captured/main.cjs',extensions:ORACLE_NODE_RESOLUTION_RECIPE.extensions}).complete,false));
    for(const specifier of ['file://hmm.js','file:///unobserved%2ffile.mjs'])await t.test(specifier+' '+nodeMajor,()=>{
      assert.deepEqual(domain.prove({nodeMajor,mode:'esm',specifier,parent:'/captured/main.mjs'}),{complete:true,queries:[]});
    });
  }
  for(const nodeMajor of [24,99])await t.test('unsupported Node '+nodeMajor,()=>assert.equal(domain.prove({nodeMajor,mode:'esm',specifier:'file://hmm.js',parent:'/captured/main.mjs'}).complete,false));
});

test('snapshot metadata keeps namespace keys distinct and binds every lazy branch',t=>{
  const root=fixture(t),source='file\0/original/source.ts',mirror='file\0/mirror/source.ts';
  const reference=writeOracleSnapshotIndex(root,[[source,{kind:'file',sha256:'original'}],[mirror,{kind:'file',sha256:'mirror'}],['file\0/mirror/absent.ts',{kind:null}]]);
  const reader=readOracleSnapshotIndex(root,reference);
  assert.deepEqual(reader.get(source),{kind:'file',sha256:'original'});
  assert.deepEqual(reader.get(mirror),{kind:'file',sha256:'mirror'});
  assert.deepEqual(reader.get('file\0/mirror/absent.ts'),{kind:null});
  assert.equal(reader.get('file\0/mirror/unobserved.ts'),undefined,'a missing key is not a captured absence');
  assert.throws(()=>readOracleSnapshotIndex(root,{path:'../outside.json',sha256:reference.sha256}).get(source),/reference is invalid|escapes/);
  const format=JSON.parse(readFileSync(join(root,reference.path),'utf8')) as {data:{path:string}};
  const data=join(root,format.data.path),changed=readFileSync(data);changed.fill(32);
  rmSync(data);writeFileSync(data,changed);
  const fresh=readOracleSnapshotIndex(root,reference);
  assert.throws(()=>[source,mirror,'file\0/mirror/absent.ts'].map(key=>fresh.get(key)),/metadata changed/,'an altered bucket is checked when queried');
});
test('snapshot lookup authenticates one compact table and only requested buckets',t=>{
  for(const size of [2048,8192]){
    const root=fixture(t),records=Array.from({length:size},(_,index)=>['path\0/snapshot/source-'+index,{kind:'file',index}] as const);
    const reference=writeOracleSnapshotIndex(root,records);
    const format=JSON.parse(readFileSync(join(root,reference.path),'utf8')) as {version:number};
    assert.equal(format.version,2,'fixed-width authenticated index format');
    const reader=readOracleSnapshotIndex(root,reference) as ReturnType<typeof readOracleSnapshotIndex>&{readonly cost:{tableBytes:number;bucketReads:number;bucketBytes:number;recordsParsed:number;authenticationHashes:number}};
    const initial=reader.cost;assert.equal(initial.bucketReads,0);assert.equal(initial.authenticationHashes,2);
    assert.ok(initial.tableBytes>0&&initial.tableBytes<=65536*40);
    assert.deepEqual(reader.get(records[0]![0]),records[0]![1]);
    const first=reader.cost;assert.equal(first.tableBytes,initial.tableBytes);assert.equal(first.bucketReads,1);assert.equal(first.authenticationHashes,3);
    assert.ok(first.recordsParsed>=1&&first.recordsParsed<=64,'only the selected bucket is parsed');
    assert.ok(first.bucketBytes>0&&first.bucketBytes<initial.tableBytes);
    assert.deepEqual(reader.get(records[0]![0]),records[0]![1]);assert.deepEqual(reader.cost,first,'reuse consumes only already checked private bytes');
    assert.equal(reader.get('path\0/unobserved'),undefined,'an unobserved key is distinct from captured absence');
    assert.ok(reader.cost.bucketReads<=2);
    console.log('compact snapshot lookup cost',JSON.stringify({size,initial,first,afterMissing:reader.cost}));
  }
});
test('snapshot compact table and requested bucket each chain to the parent hash',t=>{
  const root=fixture(t),reference=writeOracleSnapshotIndex(root,[['descriptor',{role:'control'}],['file\0/original',{kind:'file',sha256:'original'}]]);
  const format=JSON.parse(readFileSync(join(root,reference.path),'utf8')) as {version:number;table:{path:string};data:{path:string}};
  assert.equal(format.version,2,'fixed-width authenticated index format');
  const table=join(root,format.table.path),data=join(root,format.data.path),originalTable=readFileSync(table),originalData=readFileSync(data);
  const changedTable=Buffer.from(originalTable);changedTable[0]!^=1;rmSync(table);writeFileSync(table,changedTable);
  assert.throws(()=>readOracleSnapshotIndex(root,reference),/snapshot.*changed/,'table substitution cannot change the trusted offsets or hashes');
  rmSync(table);writeFileSync(table,originalTable);
  const changedData=Buffer.from(originalData);changedData.fill(32);rmSync(data);writeFileSync(data,changedData);
  const reader=readOracleSnapshotIndex(root,reference);
  assert.throws(()=>reader.get('descriptor'),/snapshot.*changed/,'used bucket bytes are hashed before their fields are used');
  rmSync(data);writeFileSync(data,originalData);
  assert.deepEqual(readOracleSnapshotIndex(root,reference).get('descriptor'),{role:'control'});
});
test('output exclusion construction membership work grows linearly with root count',()=>{
  const sizes=[32,64],counts=sizes.map(size=>{
    const roots=Array.from({length:size},(_,index)=>'/oracle-output/case-'+index);
    const prefixes=new OraclePathPrefixes(roots);
    assert.equal(prefixes.paths.length,size);
    const queries={memberships:0};
    for(const root of roots)assert.equal(prefixes.has(root+'/emit/source.js',queries),true);
    assert.equal(prefixes.has('/oracle-output/unrelated',queries),false);
    assert.ok(queries.memberships>size,'actual lookup membership work must be counted');
    return {construction:prefixes.constructionMemberships,queries:queries.memberships};
  });
  console.log('output exclusion construction memberships',JSON.stringify({sizes,counts}));
  for(const phase of ['construction','queries'] as const){
    assert.ok(counts[0]![phase]>0,'the membership counter must remain live');
    assert.ok(counts[1]![phase]>=1.8*counts[0]![phase]&&counts[1]![phase]<=2.1*counts[0]![phase],JSON.stringify({sizes,counts}));
  }
});
test('output prefixes preserve component boundaries, minimal roots and immutable caller inputs',()=>{
  const input=['/app/sub/output','/app-other','/app','/app'],prefixes=new OraclePathPrefixes(input);
  assert.deepEqual([...prefixes.paths].sort(),['/app','/app-other']);
  input.push('/later');assert.equal(prefixes.has('/later/file'),false);
  assert.equal(prefixes.has('/application/file'),false);assert.equal(prefixes.has('/app/file'),true);
  assert.deepEqual(prefixes.overlapping(['/app/sub','/unrelated']),['/app']);
  assert.deepEqual(prefixes.overlapping(['/']).sort(),['/app','/app-other']);
  assert.equal(new OraclePathPrefixes(['/']).has('/every/path'),true);
  assert.deepEqual(new OraclePathPrefixes(['/app/sub','/app/sub-other']).overlapping(['/app/sub']),['/app/sub']);
});
function fixture(t:TestContext){const root=mkdtempSync(join(tmpdir(),'nts-oracle-fs-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
test('all five operations retain their exact positive and failed answers',t=>{
  const root=fixture(t),file=join(root,'source.ts'),missing=join(root,'absent.ts'),host=new OracleFilesystem();writeFileSync(file,'export {};');
  assert.equal(host.readFile(file),'export {};');assert.equal(host.readFile(missing),null);
  assert.equal(host.fileExists(file),true);assert.equal(host.fileExists(missing),false);
  assert.equal(host.directoryExists(root),true);assert.equal(host.directoryExists(missing),false);
  assert.deepEqual(host.getAccessibleEntries(root),{files:['source.ts'],directories:[]});assert.deepEqual(host.getAccessibleEntries(missing),{files:[],directories:[]});
  assert.equal(host.realpath(file),file);assert.equal(host.realpath(missing),missing);
  const observations=host.captured(),validation=validateHostObservations(observations);
  assert.equal(validation.count,10);assert.ok(validation.wallMs>=0);
  const reused=new OracleFilesystem();reused.merge(observations);assert.deepEqual(reused.captured(),observations);
});
test('failed file and directory lookups invalidate reuse when the path appears',t=>{
  const root=fixture(t);
  for(const kind of ['fileExists','directoryExists'] as const){
    const host=new OracleFilesystem(),file=join(root,kind);assert.equal(host[kind](file),false);const before=host.captured();
    if(kind==='fileExists')writeFileSync(file,'new');else mkdirSync(file);
    assert.throws(()=>validateHostObservations(before),new RegExp(kind+' changed'));
    assert.throws(()=>host[kind](file),/changed during preparation/);
  }
});
test('contents, consulted listings and realpath aliases are validated through the same operations',t=>{
  const root=fixture(t),first=join(root,'first'),second=join(root,'second'),link=join(root,'alias');writeFileSync(first,'first');writeFileSync(second,'second');symlinkSync(first,link);
  const contents=new OracleFilesystem();contents.readFile(first);writeFileSync(first,'changed');assert.throws(()=>validateHostObservations(contents.captured()),/file changed/);
  const listing=new OracleFilesystem();listing.getAccessibleEntries(root);writeFileSync(join(root,'added'),'new');assert.throws(()=>validateHostObservations(listing.captured()),/entries changed/);
  const alias=new OracleFilesystem();alias.realpath(link);rmSync(link);symlinkSync(second,link);assert.throws(()=>validateHostObservations(alias.captured()),/realpath changed/);
});
test('literal link text and failed link reads are validated independently of realpath',t=>{
  const root=fixture(t),file=join(root,'source'),link=join(root,'alias'),host=new OracleFilesystem();writeFileSync(file,'same');
  assert.equal(host.readlink(file),null);assert.equal(host.readlink(join(root,'absent')),null);
  symlinkSync('source',link);assert.equal(host.readlink(link),'source');
  const physical=realpathSync(link);validateHostObservations(host.captured());
  rmSync(link);symlinkSync('./source',link);assert.equal(realpathSync(link),physical);
  assert.throws(()=>validateHostObservations(host.captured()),/readlink changed/);
});
test('runtime listings and kinds preserve dangling links without changing SDK entries',t=>{
  const root=fixture(t),link=join(root,'dangling'),missing=join(root,'missing'),host=new OracleFilesystem();
  writeFileSync(join(root,'source'),'same');symlinkSync('missing',link);
  assert.deepEqual(host.getAccessibleEntries(root),{files:['source'],directories:[]});
  assert.deepEqual(host.runtimeEntries(root),['dangling','source']);
  assert.equal(host.runtimeKind(link),'symlink');assert.equal(host.runtimeKind(missing),null);
  assert.equal(host.runtimeKind(root),'directory');assert.equal(host.runtimeKind(join(root,'source')),'file');
  validateHostObservations(host.captured());
  rmSync(link);assert.throws(()=>validateHostObservations(host.captured()),/runtimeEntries changed/);
  const negative=new OracleFilesystem();negative.runtimeKind(missing);writeFileSync(missing,'appeared');
  assert.throws(()=>validateHostObservations(negative.captured()),/runtimeKind changed/);
  for(const observation of [{kind:'runtimeEntries',path:root,value:['../escape']},{kind:'runtimeKind',path:root,value:'device'}])
    assert.throws(()=>validateHostObservations([observation as any]),/invalid oracle/);
});
test('project discovery records the selected config and every unsuccessful nearer lookup',t=>{
  const root=fixture(t),src=join(root,'src'),entry=join(src,'main.ts');mkdirSync(src);writeFileSync(entry,'export {};');writeFileSync(join(root,'tsconfig.json'),'{}');
  const host=new OracleFilesystem();assert.equal(host.projectFor(entry),join(root,'tsconfig.json'));
  assert.ok(host.captured().some(row=>row.kind==='fileExists'&&row.path===join(src,'tsconfig.json')&&row.value===false));
  writeFileSync(join(src,'tsconfig.json'),'{}');assert.throws(()=>validateHostObservations(host.captured()),/fileExists changed/);
});
test('unknown, malformed and missing observation records hold by name',t=>{
  const root=fixture(t);
  for(const observations of [undefined,[{kind:'unknown',path:root,value:false}],[{kind:'fileExists',path:root,value:'yes'}],[{kind:'entries',path:root,value:{files:[],directories:[],extra:1}}],[{kind:'file',path:'relative',value:null}]] as any[])
    assert.throws(()=>validateHostObservations(observations),/oracle filesystem/);
});

test('one pure Node lookup authority preserves logical main domains and refuses unknown inputs',()=>{
  const record=():ResolutionDomainRecord=>({recipe:ORACLE_NODE_RESOLUTION_RECIPE,roots:['/capture/app'],excluded:[],aliases:[{path:'/capture/app/alias',target:'/capture/app/nested/pkg'}],
    files:['/capture/package.json','/capture/app/main.mjs','/capture/app/nested/pkg/package.json','/capture/app/nested/pkg/index.js','/capture/app/outside/value.cjs'],
    directories:['/capture','/capture/app','/capture/app/nested','/capture/app/nested/pkg','/capture/app/outside'],absent:['/capture/app/missing.mjs'],scopeAbsent:[],moduleAbsent:[],
    packages:[{directory:'/capture',valid:true,main:null,name:null,exports:null},{directory:'/capture/app/nested/pkg',valid:true,main:'../../outside/value.cjs',name:null,exports:null}]});
  for(const nodeMajor of [26]){
    const input=record(),domain=new OracleResolutionDomain(input),request={nodeMajor,mode:'cjs' as const,specifier:'/capture/app/nested/pkg',direct:'/capture/app/nested/pkg',parent:'/capture/app/main.mjs',extensions:['.js','.json','.node']};
    assert.equal(domain.prove(request).complete,true);
    const shallow=domain.prove({...request,specifier:'/capture/app/alias',direct:'/capture/app/alias'});
    assert.equal(shallow.complete,false);assert.ok(shallow.queries.some(query=>query.path==='/capture/outside/value.cjs'));
    const covered=record();covered.roots.push('/capture/outside');covered.files.push('/capture/outside/value.cjs');covered.directories.push('/capture/outside');
    assert.equal(new OracleResolutionDomain(covered).prove({...request,specifier:'/capture/app/alias',direct:'/capture/app/alias'}).complete,true);
    assert.equal(domain.prove({...request,nodeMajor:27}).complete,false);
    assert.equal(domain.prove({...request,extensions:['.js','.json','.node','/../../outside.cjs']}).complete,false);
    assert.equal(domain.prove({...request,direct:undefined,specifier:'./pkg'}).complete,false);
    assert.equal(domain.prove({...request,mode:'esm',direct:'/capture/app/missing.mjs'}).complete,true);
    assert.equal(domain.prove({...request,mode:'esm',direct:'/capture/app/unprepared.js'}).complete,false);
    input.packages[1]!.main='./index.js';input.roots.push('/capture/outside');
    assert.equal(domain.prove({...request,specifier:'/capture/app/alias',direct:'/capture/app/alias'}).complete,false,'caller mutation cannot change captured facts');
    const excluded=record();excluded.excluded.push('/capture/app/outside');assert.equal(new OracleResolutionDomain(excluded).prove(request).complete,false);
  }
});


test('ESM self-package proof stops at the node_modules package-scope boundary',async t=>{
  for(const nodeMajor of [26])for(const selfExport of [false,true])await t.test(JSON.stringify({nodeMajor,selfExport}),()=>{
    const app='/capture/app',dependency=app+'/node_modules/same';
    const record:ResolutionDomainRecord={recipe:ORACLE_NODE_RESOLUTION_RECIPE,roots:[app],excluded:[],aliases:[],
      files:[app+'/package.json',app+'/outer.mjs',app+'/node_modules/middle/main.mjs',dependency+'/package.json',dependency+'/value.cjs'],
      directories:[app,app+'/node_modules',app+'/node_modules/middle',dependency],absent:[],scopeAbsent:[],moduleAbsent:[],
      packages:[{directory:app,valid:true,main:null,name:'same',exports:selfExport?'./outer.mjs':null},
        {directory:dependency,valid:true,main:'./value.cjs',name:null,exports:null}]};
    const proof=new OracleResolutionDomain(record).prove({nodeMajor,mode:'esm',specifier:'same',parent:app+'/node_modules/middle/main.mjs'});
    assert.equal(proof.complete,true);
    assert.ok(proof.queries.some(query=>query.kind==='package'&&query.path===dependency+'/package.json'),
      'an outer self-export cannot remove the real dependency package query below node_modules');
  });
});


test('ESM package queries include node_modules ancestors rather than the CommonJS skip rule',async t=>{
  for(const nodeMajor of [26])for(const nearerPackage of [false,true])await t.test(JSON.stringify({nodeMajor,nearerPackage}),()=>{
    const app='/capture/app',normal=app+'/node_modules/same',nearer=app+'/node_modules/node_modules/same';
    const files=[app+'/package.json',app+'/node_modules/middle/main.mjs',normal+'/package.json',normal+'/value.cjs'];
    const directories=[app,app+'/node_modules',app+'/node_modules/middle',normal];
    const packages:ResolutionDomainRecord['packages']=[{directory:app,valid:true,main:null,name:null,exports:null},
      {directory:normal,valid:true,main:'./value.cjs',name:null,exports:null}];
    if(nearerPackage){files.push(nearer+'/package.json',nearer+'/value.cjs');directories.push(app+'/node_modules/node_modules',nearer);packages.push({directory:nearer,valid:true,main:'./value.cjs',name:null,exports:null});}
    const proof=new OracleResolutionDomain({recipe:ORACLE_NODE_RESOLUTION_RECIPE,roots:[app],excluded:[],aliases:[],files,directories,absent:[],scopeAbsent:[],moduleAbsent:[],packages})
      .prove({nodeMajor,mode:'esm',specifier:'same',parent:app+'/node_modules/middle/main.mjs'});
    assert.equal(proof.complete,true);
    assert.ok(proof.queries.some(query=>query.kind==='package'&&query.path===(nearerPackage?nearer:normal)+'/package.json'),
      'the actual ESM dependency package query cannot be skipped at a node_modules ancestor');
  });
});

test('generated Node sensitivity covers every admitted lookup domain',t=>{
  const nodeMajor=Number(process.versions.node.split('.')[0]);assert.ok([26].includes(nodeMajor));
  const gaps:unknown[]=[],reports:unknown[]=[];
  for(const layout of ['relative','bare','self','exports','imports','nested','symlink','fallback','absolute-cjs','relative-cjs','file-url-cjs']){
    const root=fixture(t),app=join(root,'app'),files=new Map<string,string>(),links=new Map<string,string>();
    const put=(name:string,text:string)=>files.set(join(root,name),text);
    put('package.json','{"type":"module"}');put('app/package.json','{"type":"module"}');
    let parent=join(app,layout==='nested'?'node_modules/middle/main.mjs':'src/main.mjs'),specifier='same',mode:'esm'|'cjs'='esm',direct:string|undefined;
    let pkg=join(app,'node_modules/same');
    if(layout==='relative'){specifier='./value.mjs';direct=join(app,'src/value.mjs');put('app/src/value.mjs','export default 19;\n');}
    else if(layout==='self'||layout==='imports'){
      put('app/package.json',JSON.stringify({type:'module',name:'same',exports:'./primary.mjs',imports:{'#value':'./primary.mjs'}}));
      put('app/primary.mjs','export default 19;\n');if(layout==='imports')specifier='#value';pkg=app;
    }else if(layout==='exports'){
      put('app/node_modules/same/package.json',JSON.stringify({type:'module',exports:{'.':'./primary.mjs','./value':'./primary.mjs'}}));
      put('app/node_modules/same/primary.mjs','export default 19;\n');specifier='same/value';
    }else{
      if(layout==='symlink'){pkg=join(root,'packages/same');links.set(join(app,'node_modules/same'),'../../packages/same');}
      if(layout==='absolute-cjs'||layout==='relative-cjs'||layout==='file-url-cjs'){
        parent=join(app,'main.cjs');mode='cjs';pkg=join(app,'pkg');specifier=layout==='absolute-cjs'?pkg:'./pkg';if(layout==='absolute-cjs')direct=pkg;if(layout==='file-url-cjs'){specifier=pathToFileURL(pkg).href;direct=pkg;}
      }
      files.set(join(pkg,'package.json'),JSON.stringify({type:'commonjs',main:layout==='fallback'?'./missing':'./primary'}));
      files.set(join(pkg,layout==='fallback'?'index.js':'primary.js'),'module.exports=19;\n');
    }
    files.set(parent,mode==='esm'?"try{console.log(JSON.stringify({value:(await import("+JSON.stringify(specifier)+")).default}));}catch(error){console.log(JSON.stringify({code:error.code,message:error.message}));}\n":"try{console.log(JSON.stringify({value:require("+JSON.stringify(specifier)+")}));}catch(error){console.log(JSON.stringify({code:error.code,message:error.message}));}\n");
    const restore=()=>{
      rmSync(root,{recursive:true,force:true});mkdirSync(root);
      for(const [path,text] of files){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);}
      for(const [path,target] of links){mkdirSync(dirname(path),{recursive:true});symlinkSync(target,path);}
    };
    restore();
    const inventory=():ResolutionDomainRecord=>{
      const capturedFiles:string[]=[],directories:string[]=[],aliases:{path:string;target:string}[]=[],packages:ResolutionDomainRecord['packages']=[];
      const visit=(path:string)=>{
        const info=lstatSync(path);
        if(info.isSymbolicLink()){aliases.push({path,target:resolve(dirname(path),readlinkSync(path))});return;}
        if(info.isDirectory()){directories.push(path);for(const name of readdirSync(path))visit(join(path,name));}
        else if(info.isFile()){
          capturedFiles.push(path);
          if(basename(path)==='package.json'){
            const data=JSON.parse(readFileSync(path,'utf8'));packages.push({directory:dirname(path),valid:true,main:typeof data.main==='string'?data.main:null,name:typeof data.name==='string'?data.name:null,exports:data.exports??null});
          }
        }
      };visit(root);
      return {recipe:ORACLE_NODE_RESOLUTION_RECIPE,roots:[root],excluded:[],aliases,files:capturedFiles,directories,packages,absent:[],scopeAbsent:[],moduleAbsent:[]};
    };
    const record=inventory(),proof=new OracleResolutionDomain(record).prove({nodeMajor,mode,specifier,parent,...(direct?{direct}:{}),extensions:['.js','.json','.node']});
    const run=()=>{const result=spawnSync(process.execPath,['--no-warnings',parent],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);return result.stdout;};
    const before=run();if(layout==='file-url-cjs')assert.equal(JSON.parse(before).code,'MODULE_NOT_FOUND');else assert.equal(before,'{"value":19}\n',layout+' needs a real clean Node control');
    // This superset is intentionally independent of the helper's recipe:
    // all bounded ancestors, one/two node_modules levels, package metadata,
    // and every file/index extension form. Node decides sensitivity.
    const candidates=new Map<string,{path:string;package?:boolean}>();
    const add=(path:string,packageDirectory=false)=>candidates.set(path,{path,...(packageDirectory?{package:true}:{})});
    for(let ancestor=dirname(parent);ancestor===root||ancestor.startsWith(root+sep);ancestor=dirname(ancestor)){
      add(join(ancestor,'package.json'));
      for(const depth of [1,2])add(join(ancestor,...Array(depth).fill('node_modules'),'same'),true);
      if(ancestor===root)break;
    }
    for(const name of ['primary','primary.js','primary.json','primary.node','primary/index.js','primary/index.json','primary/index.node','missing','missing.js','missing.json','missing.node','missing/index.js','missing/index.json','missing/index.node','index.js','index.json','index.node','primary.mjs'])add(join(pkg,name));
    if(direct){add(direct);if(mode==='cjs')for(const suffix of ['.js','.json','.node'])add(direct+suffix);}
    assert.ok(candidates.size<=40,'the generated matrix must stay bounded');
    let sensitive=0;
    const canonical=(path:string)=>{
      for(const [alias,target] of links){if(path===alias||path.startsWith(alias+sep))return resolve(dirname(alias),target)+path.slice(alias.length);}
      return path;
    };
    const queries=new Set(proof.queries.map(query=>canonical(query.path)));
    for(const candidate of candidates.values()){
      restore();
      // A file-shaped decoy beneath a file cannot be observed as a descendant.
      let blocked=false;for(let at=dirname(candidate.path);at!==root;at=dirname(at))if(files.has(at)){blocked=true;break;}
      if(blocked)continue;
      const causal=candidate.package&&record.directories.includes(canonical(candidate.path))?join(candidate.path,'package.json'):candidate.path;
      if(candidate.package){
        mkdirSync(candidate.path,{recursive:true});
        writeFileSync(join(candidate.path,'package.json'),'{"type":"commonjs","main":"./decoy.cjs"}');writeFileSync(join(candidate.path,'decoy.cjs'),'module.exports=23;\n');
      }else{
        mkdirSync(dirname(candidate.path),{recursive:true});
        if(basename(candidate.path)==='package.json'){
          const directory=dirname(candidate.path);writeFileSync(candidate.path,JSON.stringify({type:'module',name:'same',exports:'./decoy.mjs',imports:{'#value':'./decoy.mjs'},main:'./decoy.mjs'}));writeFileSync(join(directory,'decoy.mjs'),'export default 23;\n');
        }else {if(record.directories.includes(canonical(candidate.path)))rmSync(candidate.path,{recursive:true});writeFileSync(candidate.path,candidate.path.endsWith('.json')?'23':candidate.path.endsWith('.mjs')?'export default 23;\n':'module.exports=23;\n');}
      }
      const after=run();if(after===before)continue;sensitive++;
      if(proof.complete&&!queries.has(canonical(causal)))gaps.push({layout,path:candidate.path,causal,kind:candidate.package?'directory':'file',before,after,queries:proof.queries});
    }
    reports.push({layout,nodeMajor,candidates:candidates.size,sensitive,complete:proof.complete,...(!proof.complete?{why:proof.reason}:{})});
    t.diagnostic(JSON.stringify(reports.at(-1)));
    if(['imports','relative-cjs','file-url-cjs'].includes(layout))assert.equal(proof.complete,false,'unsupported forms must keep their named hold');
    else assert.equal(proof.complete,true,layout+': '+proof.reason);
  }
  t.diagnostic(JSON.stringify({sensitivity:reports,gaps}));assert.deepEqual(gaps,[],'every Node-sensitive decoy must be covered by an admitted query set');
});


test('exact captured module files grant no directory or sibling lookup domain',()=>{
  const file='/capture/shims/bindings.mjs';
  const record:ResolutionDomainRecord={recipe:ORACLE_NODE_RESOLUTION_RECIPE,roots:['/capture/app'],excluded:[],aliases:[],
    files:['/capture/package.json','/capture/app/main.mjs',file],directories:['/capture','/capture/app','/capture/shims'],absent:[],scopeAbsent:['/capture/shims/package.json'],moduleAbsent:[],
    packages:[{directory:'/capture',valid:true,main:null,name:null,exports:null}]};
  for(const nodeMajor of [26]){
    const domain=new OracleResolutionDomain(record),request={nodeMajor,mode:'esm' as const,specifier:file,direct:file,parent:'/capture/app/main.mjs'};
    assert.equal(domain.prove({...request,direct:'/capture/shims/unobserved.mjs'}).complete,false);
    assert.equal(domain.prove({...request,direct:'/capture/shims'}).complete,false);
    const proof=domain.prove(request);assert.equal(proof.complete,true,proof.reason);
    assert.ok(proof.queries.some(query=>query.path===file));assert.ok(proof.queries.some(query=>query.path==='/capture/shims/package.json'));
    const missingScope=new OracleResolutionDomain({...record,scopeAbsent:[]});
    assert.equal(missingScope.prove(request).complete,false,'exact bytes cannot replace unknown package scope');
    const excluded=new OracleResolutionDomain({...record,excluded:[file]});assert.equal(excluded.prove(request).complete,false);
  }
});
