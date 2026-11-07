import {join} from 'node:path';
import {ownerRunScope} from '../differential/oracle-emit.ts';
import {ToolingInstrumentError} from '../gate/step-result.ts';
export {captureProgramOracle as captureTypeScriptOracle,captureOracleDependencies} from '../differential/oracle-result-capture.ts';
export type {ProgramCapture as TypeScriptOracleCapture} from '../differential/oracle-result-capture.ts';

export function typeScriptOracleDirectory(env:NodeJS.ProcessEnv=process.env):string{
  const raw=env.NTS_ORACLE_DEPENDENCIES,cap=raw?JSON.parse(raw):null,scope=cap&&ownerRunScope(cap,env);
  if(!scope)throw new ToolingInstrumentError('tooling-setup','TypeScript oracle references require an owned capture');
  return join(scope.directory,'typescript-oracles');
}
