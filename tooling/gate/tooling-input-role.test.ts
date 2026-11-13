import assert from 'node:assert/strict';
import {test} from 'node:test';
import {toolingInputRole} from './tooling-input-role.ts';

test('shebang observations distinguish host commands from Rust inner attributes and arbitrary data',()=>{
  const role=(prefix:string,executable=false)=>toolingInputRole('tooling/unnamed',()=>({prefix,executable}));
  assert.equal(role('#!/bin/sh\n'),'program');
  assert.equal(role('#! /usr/bin/env python3\n'),'program');
  assert.equal(role('#![allow(dead_code)]\n'),'data');
  assert.equal(role('#! [allow(dead_code)]\n'),'data');
  assert.equal(role('# names and reasons\n'),'data');
  assert.equal(role('binary entry',true),'program');
  for(const path of ['types.d.ts','types.d.mts','types.d.cts'])
    assert.equal(toolingInputRole(path,()=>{throw Error('a declaration does not need executable probing');}),'declaration');
});
