import assert from 'node:assert/strict';
import {test} from 'node:test';
import {requireSealedOracleTestEnvironment} from './oracle-test-fixture.ts';
import {ENVIRONMENT_CONTEXT} from '../gate/canonical-environment.ts';
import {ToolingInstrumentError} from '../gate/step-result.ts';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {spawnTest} from '../gate/test-wait.ts';

const message='supplied gate environment is not sealed for oracle runs; seal it with sealOracleRun';
test('an unsealed supplied context refuses by name instead of changing holder ownership',t=>{
 const raw=JSON.stringify({version:1,directory:'/unused',admission:{kind:'standalone'}});
 const env={...fixtureEnvironment(t),NTS_ORACLE_DEPENDENCIES:raw,[ENVIRONMENT_CONTEXT]:JSON.stringify({report:{version:1,host:{NTS_ORACLE_DEPENDENCIES:raw}},owned:{NTS_ORACLE_DEPENDENCIES:raw}})};
 assert.throws(()=>requireSealedOracleTestEnvironment(env),error=>error instanceof ToolingInstrumentError&&error.message===message);
 const code=`import {setupOracleTestEnvironment} from ${JSON.stringify(new URL('./oracle-test-fixture.ts',import.meta.url).href)};setupOracleTestEnvironment().then(()=>console.log('ready'),error=>{console.error(error.message);process.exitCode=2;});`;
 const result=spawnTest(process.execPath,['--input-type=module','-e',code],{env,encoding:'utf8'});
 assert.equal(result.status,2,result.stderr);assert.equal(result.stderr.trim(),message);assert.doesNotMatch(result.stdout,/ready/);
});

test('the supplied sealed tooling context retains the same oracle services',()=>{
 assert.doesNotThrow(()=>requireSealedOracleTestEnvironment(process.env));
});
