// The shared build prepares Cargo's exact doctest graph. The execution step
// accepts only successful preparation for its working directory, profile,
// target and selection. Cargo's freshness check validates current inputs.
import {readFileSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {testInvocation} from './test-profile.ts';
import {ToolingInstrumentError} from './step-result.ts';

export function assertDoctestPreparation(env:NodeJS.ProcessEnv=process.env,cwd=process.cwd()):void {
  const expected=testInvocation('doctests-build',[],env,cwd),path=env.NTS_DOCTEST_PREPARATION;
  try{
    if(!path||resolve(path)!==path)throw Error('missing preparation receipt');
    const row=JSON.parse(readFileSync(path,'utf8'));
    if(row.version!==2||row.status!==0||row.buildFinished!==true||!Array.isArray(row.artifacts)||!row.artifacts.length
      ||row.buildNamespace!==realpathSync(expected.targetDirectory)
      ||JSON.stringify(row.invocation)!==JSON.stringify({cwd:expected.cwd,profileDirectory:expected.profileDirectory,args:expected.args}))
      throw Error('preparation does not match working directory, selected crates, profile and target');
  }catch(error){throw new ToolingInstrumentError('tooling-setup','doctests needs successful shared build preparation: '+String(error),{cause:error});}
}
