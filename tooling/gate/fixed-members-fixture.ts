// Fixed runner observations opt in to the exact receipt written by GateScopes.
// Product modules are copied unchanged; private payloads declare their actors.
import {join} from 'node:path';
import {ownMemory} from './test-memory.ts';
import {fixedMembersEntryArguments} from './test-cgroup-members.ts';
import {existsSync,lstatSync,writeFileSync} from 'node:fs';

export function gateFixtureMemory(directory:string,tree:string,reading:NonNullable<Parameters<typeof ownMemory>[1]>={}){
  return ownMemory(directory,{...reading,memberScopes:[join(tree,'target/gate-scope-owner.json')]});
}

/** A fixture's shell payload is the known logical actor, before it launches. */
export function fixtureStepMembers():string{
  const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
  return fixedMembersEntryArguments().map(quote).join(' ');
}

/** Write the fixture's own payload, never transform a copied product module. */
export function writeGateFixtureScript(path:string,source:string):void{
  if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('fixture payload cannot replace a source link');
  if(!source.startsWith('#!/bin/sh\n'))throw Error('fixture payload requires its shell entry');
  writeFileSync(path,'#!/bin/sh\nif [ "$1" != --list ]; then\n  '+fixtureStepMembers()+' || exit $?\nfi\n'+source.slice('#!/bin/sh\n'.length));
}
