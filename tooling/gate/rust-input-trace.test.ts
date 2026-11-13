import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {InputTraceParser,inputTraceArguments,readInputTrace,traceArguments,traceString} from './rust-input-trace.ts';
import {newTestScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {spawnTest} from './test-wait.ts';

const parse=(lines:string[],cwd='/source')=>{const parser=new InputTraceParser(cwd);for(const line of lines)parser.line(line);return parser.finish();};

test('trace paths retain failed lookups, directory membership and decoded dirfd identity',()=>{
  const result=parse([
    '10 openat(AT_FDCWD</source/crate>, "../../fixture/missing.ts", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)',
    '10 openat(3</source/data>, "a, b.ts", O_RDONLY) = 4</source/data/a, b.ts>',
    '10 getdents64(3</source/data>, [{d_ino=1, d_name="x,y"}], 32768) = 24',
    '10 newfstatat(4</source/data/a, b.ts>, "", {st_mode=S_IFREG|0644}, AT_EMPTY_PATH) = 0',
    '10 openat(AT_FDCWD</source>, "private-output", O_WRONLY|O_CREAT, 0600) = 5</source/private-output>',
  ]);
  assert.deepEqual(result.observations.map(row=>[row.operation,row.path,row.success]),[
    ['open','/fixture/missing.ts',false],['open','/source/data/a, b.ts',true],
    ['directory','/source/data',true],['lookup','/source/data/a, b.ts',true],['write','/source/private-output',true],
  ]);
});

test('unfinished clone output retains child cwd and executable ancestry before a resumed parent',()=>{
  const result=parse([
    '10 execve("/bin/cargo", ["cargo", "test"], 0x123 /* 2 vars */) = 0',
    '10 chdir("crate") = 0',
    '10 clone(child_stack=NULL, flags=SIGCHLD <unfinished ...>',
    '11 execve("/bin/rustdoc", ["rustdoc", "--test", "src/lib.rs"], 0x123 /* 2 vars */) = 0',
    '10 <... clone resumed>) = 11',
    '11 openat(AT_FDCWD</source/crate>, "data.json", O_RDONLY) = 3</source/crate/data.json>',
  ]);
  assert.deepEqual(result.executions.map(row=>[row.id,row.parent,row.cwd,row.args]),[
    [1,0,'/source',[]],[2,1,'/source/crate',['rustdoc','--test','src/lib.rs']],
  ]);
  assert.equal(result.observations.at(-1)?.image,2);
});

test('shared cwd and copied cwd follow clone ownership',()=>{
  for(const [flags,wanted]of [['CLONE_FS|SIGCHLD','/source/changed/read'],['SIGCHLD','/source/read']]){
    const result=parse([
      `10 clone(child_stack=NULL, flags=${flags}) = 11`,
      '11 chdir("changed") = 0',
      '10 access("read", R_OK) = -1 ENOENT (No such file or directory)',
    ]);
    assert.equal(result.observations[0]?.path,wanted);
  }
});

test('invalid-argument capability probes and non-file descriptors remain explicit',()=>{
  const trace=parse([
    '10 statx(0<socket:[1984676155]>, NULL, AT_STATX_SYNC_AS_STAT, STATX_ALL, NULL) = -1 EFAULT (Bad address)',
    '10 newfstatat(1<pipe:[123]>, "", {st_mode=S_IFIFO|0600}, AT_EMPTY_PATH) = 0',
    '10 getdents64(-1, 0x123, 32768) = -1 EBADF (Bad file descriptor)',
    '10 statx(3</source/data>, NULL, AT_EMPTY_PATH, STATX_ALL, {stx_mode=S_IFDIR|0755}) = 0',
  ]);
  assert.deepEqual(trace.descriptorProbes.map(row=>row.kind),['invalid-argument','non-file-descriptor','non-file-descriptor']);
  assert.deepEqual(trace.observations.map(row=>[row.operation,row.path]),[['lookup','/source/data']]);
});

test('path decoder preserves escaped bytes and does not invent truncated observations',()=>{
  assert.equal(traceString('"a\\040b\\n\\x2c"'),'a b\n,');
  assert.equal(traceString('"caf\\303\\251"'),'café');
  assert.deepEqual(traceArguments('AT_FDCWD</a,b>, "x,y", {flags=O_RDONLY, resolve=0}'),['AT_FDCWD</a,b>','"x,y"','{flags=O_RDONLY, resolve=0}']);
  assert.throws(()=>traceString('"short"...'),/incomplete path string/);
  assert.throws(()=>traceArguments('["bad"}'),/unbalanced syscall arguments/);
  assert.throws(()=>parse(['10 openat(AT_FDCWD, "missing"..., O_RDONLY) = -1 ENOENT']),/incomplete path string/);
  assert.throws(()=>parse(['10 openat(AT_FDCWD, "a", O_RDONLY <unfinished ...>']),/trace ended with unfinished syscalls/);
  assert.throws(()=>parse(['10 <... openat resumed>) = 0']),/unmatched resumed syscall/);
  assert.throws(()=>parse(['10 mystery("a") = 0']),/unrecognized traced file syscall/);
});

test('real descendant opens, missing probes and directory reads survive the tracer',async t=>{
  const root=newTestScratch('rust-input-trace');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const data=join(root,'data'),input=join(data,'café, input'),raw=join(root,'trace.raw');mkdirSync(data);writeFileSync(input,'input');
  const program=join(root,'reader.cjs');
  writeFileSync(program,`const fs=require('node:fs');const cp=require('node:child_process');
if(process.argv[2]==='child'){fs.readFileSync(process.argv[3]);try{fs.readFileSync(process.argv[3]+'.absent')}catch{};fs.readdirSync(require('node:path').dirname(process.argv[3]));}
else {const r=cp.spawnSync(process.execPath,[__filename,'child',process.argv[2]]);process.exitCode=r.status??1;}`);
  const marker='fixture-environment-value-must-stay-out-of-trace';
  const ran=spawnTest('strace',inputTraceArguments(raw,process.execPath,[program,input]),{cwd:root,env:{...fixtureEnvironment(t),TRACE_FIXTURE_SECRET:marker},encoding:'utf8'});
  assert.equal(ran.status,0,ran.stdout+ran.stderr);
  const parsed=await readInputTrace(raw,root);
  assert.ok(parsed.observations.some(row=>row.operation==='open'&&row.path===input&&row.success));
  assert.ok(parsed.observations.some(row=>row.path===input+'.absent'&&!row.success));
  assert.ok(parsed.observations.some(row=>row.operation==='directory'&&row.path===data&&row.success));
  assert.ok(parsed.executions.length>=2);
  assert.ok(readFileSync(raw,'utf8').includes('ENOENT'));
  assert.ok(!readFileSync(raw,'utf8').includes(marker));
});

test('trace invocation follows descendants, records reads and never dumps contents or environment',()=>{
  const args=inputTraceArguments('/trace/raw.log','/bin/test',['--exact','case']);
  assert.ok(args.includes('-f'));assert.ok(args.includes('--decode-fds=path'));
  assert.ok(args.some(arg=>arg.startsWith('--trace=')&&arg.includes('getdents64')&&arg.includes('faccessat')));
  assert.ok(!args.includes('-v'));assert.ok(!args.some(arg=>/^--(?:read|write)=/.test(arg)));
  assert.deepEqual(args.slice(-4),['--','/bin/test','--exact','case']);
  assert.throws(()=>inputTraceArguments('relative','test',[]),/absolute output/);
});
