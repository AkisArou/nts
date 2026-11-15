import test from 'node:test';
import assert from 'node:assert/strict';
import {shellCommands,shellNodeInvocations} from './shell-commands.ts';

test('a redirected substitution ends before inline comments and later Node commands',()=>{
  const source=`node resolve.ts "$(tr -d '\\n' < roots.json)" # first\nnode classify.ts # next\nnode vendor.ts\nnode verdict.ts\n`;
  const shell=shellCommands(source),nodes=shellNodeInvocations(shell,source);
  assert.deepEqual(nodes.map(row=>row.script?.value),['resolve.ts','classify.ts','vendor.ts','verdict.ts']);
  assert.deepEqual(shell.redirections.map(row=>row.target),['roots.json']);
  assert.equal(shell.commands.find(row=>row.name==='tr')?.args.length,2);
});

test('Node entry observation consumes prefixes and keeps inline programs distinct from paths',()=>{
  const source=`env NTS_CHECKERS=1 timeout -s TERM 30 nice -n 19 taskset -c 0-3,6-31 node --import ./hook.ts ./entry.ts x\nnode -e 'const {x}=await import(process.argv[1]);' ./owner.ts\nnode --input-type=module - <<'JS'\nimport {x} from './owner.ts';\nJS\necho 'node absent.ts'\n`;
  const nodes=shellNodeInvocations(shellCommands(source),source);
  assert.equal(nodes.length,3);
  assert.equal(nodes[0]?.script?.value,'./entry.ts');
  assert.deepEqual(nodes[0]?.arguments.map(row=>row.value),['x']);
  assert.match(nodes[1]?.code?.value??'',/await import/);
  assert.deepEqual(nodes[1]?.arguments.map(row=>row.value),['./owner.ts']);
  assert.equal(nodes[2]?.code?.value,"import {x} from './owner.ts';\n");
});
