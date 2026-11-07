// Placement authority belongs to the run owner, separately from result reads.
import {join} from 'node:path';
import {ownerRunScope} from './oracle-emit.ts';
export function programOracleDirectory(env:NodeJS.ProcessEnv=process.env):string{
  const raw=env.NTS_ORACLE_DEPENDENCIES,cap=raw?JSON.parse(raw):null,scope=cap&&ownerRunScope(cap,env);
  if(!scope)throw Error('program oracle references require an owned capture');
  return join(scope.directory,'program-oracles');
}
