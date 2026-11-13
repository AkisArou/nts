import assert from 'node:assert/strict';
import {test} from 'node:test';
import {membershipIndex,type MetadataChange} from './reader-metadata.ts';

const row=(directory:string,dataNamespaces:Record<string,string>={})=>({directory,context:{entry:'<entry>',dataNamespaces}});

test('shallow membership ignores bytes and compares complete endpoint child sets',()=>{
  const before=['root/a/one.ts','root/a/two.ts','root/plain.txt'],index=membershipIndex(before);
  assert.equal(index.affected(row('root'),[{path:'root/a/one.ts',sameMode:true}]),false);
  assert.equal(index.affected(row('root'),[{path:'root/plain.txt',sameMode:true,before:'old'} as MetadataChange]),false);
  assert.equal(index.affected(row('root'),[{path:'root/a/new.md',added:true}]),false);
  assert.equal(index.affected(row('root'),[{path:'root/a/one.ts',deleted:true}]),false);
  assert.equal(index.affected(row('root'),[{path:'root/a/one.ts',deleted:true},{path:'root/a/two.ts',deleted:true}]),true);
  assert.equal(index.affected(row('root'),[{path:'root/new/first.md',added:true}]),true);
  assert.equal(index.affected(row('root'),[{path:'root/plain.txt',deleted:true}]),true);
  assert.equal(index.affected(row('root'),[{path:'root/plain.txt',sameMode:false}]),true);
  assert.equal(index.affected(row('root'),[{path:'root/a/one.ts',sameMode:false}]),false);
});

test('a batched rename has the same structural answer from either endpoint inventory',()=>{
  const changes=[{path:'root/a/old.md',deleted:true},{path:'root/a/new.md',added:true}];
  for(const files of [['root/a/old.md'],['root/a/new.md']]){
    const index=membershipIndex(files);
    assert.equal(index.affected(row('root'),changes),false);
    assert.equal(index.affected(row('root/a'),changes),true);
  }
  const moved=[{path:'root/a/old.md',deleted:true},{path:'root/b/new.md',added:true}];
  for(const files of [['root/a/old.md'],['root/b/new.md']])assert.equal(membershipIndex(files).affected(row('root'),moved),true);
});

test('root membership and private namespaces retain their independent structural reach',()=>{
  const index=membershipIndex(['data/only.ts','docs/a.md','entry.ts']);
  assert.equal(index.affected(row(''),[{path:'docs/a.md',sameMode:true}]),false);
  assert.equal(index.affected(row(''),[{path:'docs/new.md',added:true}]),false);
  assert.equal(index.affected(row(''),[{path:'new.md',added:true}]),true);
  assert.equal(index.affected(row(''),[{path:'docs/a.md',deleted:true}]),true);
  assert.equal(index.affected(row(''),[{path:'data/only.ts',deleted:true}]),true);
  assert.equal(index.affected(row('',{data:'private corpus'}),[{path:'data/only.ts',deleted:true}]),false);
  assert.equal(index.affected(row('data',{data:'private corpus'}),[{path:'data/added.md',added:true}]),false);
  assert.equal(index.affected(row('',{data:'private corpus'}),[{path:'docs/a.md',deleted:true}]),true);
});
