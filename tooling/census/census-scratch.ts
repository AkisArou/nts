import { homedir } from 'node:os';
import { join } from 'node:path';
import { removeOracleSnapshot } from '../differential/oracle-emit.ts';

/** A census owns its scratch through worker drain and all process exits. */
export function ownCensusScratch(beforeCleanup:()=>void,env:NodeJS.ProcessEnv=process.env){
  // Spelled whole: the hourly count finds this folder's writer by its path.
  const root=env.TMPDIR===undefined?join(homedir(),'.cache/nts/conformance262'):join(env.TMPDIR,'conformance262');
  const path=env.NTS_CENSUS_DIR??join(root,String(process.pid));
  const cleanup=()=>{beforeCleanup();removeOracleSnapshot(path);};
  process.once('exit',cleanup);
  process.once('SIGTERM',()=>process.exit(143));
  return {path,cleanup};
}
