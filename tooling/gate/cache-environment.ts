// Cache locations are capabilities. Private HOME/XDG state must neither select
// them nor turn each child into a cold build of the same content-addressed input.
import {userInfo} from 'node:os';
import {join} from 'node:path';
import {CONTENT_CACHE_ENVIRONMENT,FIXTURE_ENVIRONMENT} from './cache-capabilities.mjs';
export {CONTENT_CACHE_ENVIRONMENT,FIXTURE_ENVIRONMENT,cacheLocation} from './cache-capabilities.mjs';

export function contentCacheEnvironment(env:NodeJS.ProcessEnv=process.env):Partial<Record<(typeof CONTENT_CACHE_ENVIRONMENT)[number],string>>{
  if(env[FIXTURE_ENVIRONMENT]!==undefined)return Object.fromEntries(CONTENT_CACHE_ENVIRONMENT.flatMap(name=>env[name]===undefined?[]:[[name,env[name]!] ]));
  const root=join(userInfo().homedir,'.cache/nts');
  return {NODE_COMPILE_CACHE:join(root,'node-compile-cache/v1'),NTS_NODE_DEPS_CACHE:join(root,'node-deps'),NTS_NODE_INPUTS_CACHE:join(userInfo().homedir,'.cache/nts-node-inputs'),NTS_CENSUS_OBJECT_CACHE:join(root,'c-objects'),
    NTS_CENSUS_CASE_ROOTS:join(root,'case-roots'),NTS_JVM_CDS_DIR:join(root,'jvm-cds')};
}
