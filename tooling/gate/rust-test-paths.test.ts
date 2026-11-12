import assert from'node:assert/strict';
import{test}from'node:test';
import{inspectRustPidPaths}from'./rust-test-paths.ts';

test('merged test modules reject process keyed paths and names',()=>{
  const source='#[cfg(test)] mod tests { fn fixture(){ let path = std::env::temp_dir().join(format!("fixture-{}",std::process::id())); } }';
  const found=inspectRustPidPaths('sample/src/lib.rs',source);
  assert.equal(found.paths.filter(site=>site.test).length,1);assert.equal(found.reads[0]!.test,true);
});

test('PID aliases, captured names and ports retain their resource provenance',()=>{
  for(const use of ['format!("unit-{id}")','root.join(id.to_string())','listener.bind(format!("127.0.0.1:{}",10000+id))']){
    const found=inspectRustPidPaths('sample/tests/case.rs','fn test(){let id=std::process::id();let name='+use+';}');
    assert.equal(found.paths.filter(site=>site.test).length,1,use);
  }
});

test('production identity, locks and safety are outside the test rule',()=>{
  const source='fn production(){let name=format!("lock-{}",std::process::id());} #[cfg(not(test))] fn other(){let path=format!("file-{}",std::process::id());}';
  assert.equal(inspectRustPidPaths('sample/src/lib.rs',source).paths.filter(site=>site.test).length,0);
});

test('comments and raw product-source literals cannot become resource constructors',()=>{
  const source='/* nested /* std::process::id() */ */ fn test(){let source=r###"format!(\"fixture-{}\", std::process::id())"###;}';
  assert.deepEqual(inspectRustPidPaths('sample/tests/case.rs',source),{paths:[],reads:[]});
  assert.throws(()=>inspectRustPidPaths('sample/tests/case.rs','fn test(){let x=r#"unfinished;'),/unterminated/);
});

test('kernel observations and diagnostic text are not private resource names',()=>{
  const source='fn control(){let pid=std::process::id();let stat=format!("/proc/{pid}/stat");Err(format!("pid={pid} diagnostic"));}';
  assert.equal(inspectRustPidPaths('sample/tests/case.rs',source).paths.length,0);
});
