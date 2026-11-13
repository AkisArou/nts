import { homedir } from 'node:os';
import { join } from 'node:path';
import { removeOracleSnapshot } from '../differential/oracle-emit.ts';
import {registerCommandCloser} from '../differential/command-entry/main.ts';

/** A census owns its scratch through worker drain and all process exits. */
export function ownCensusScratch(beforeCleanup:()=>void|Promise<void>,env:NodeJS.ProcessEnv=process.env){
  // Spelled whole: the hourly count finds this folder's writer by its path.
  const root=env.TMPDIR===undefined?join(homedir(),'.cache/nts/conformance262'):join(env.TMPDIR,'conformance262');
  const path=env.NTS_CENSUS_DIR??join(root,String(process.pid));
  let completion:Promise<void>|undefined;
  const cleanup=()=>{
    if(!completion){
      completion=(async()=>{await beforeCleanup();removeOracleSnapshot(path);})();
      void completion.then(unregister,()=>{});
    }
    return completion;
  };
  const unregister=registerCommandCloser('census scratch '+path,{close:cleanup});
  return {path,cleanup};
}
