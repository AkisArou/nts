// Pure protocol: fixture cache lookup must never invoke a production resolver.
export const FIXTURE_ENVIRONMENT: 'NTS_TEST_ENVIRONMENT' = 'NTS_TEST_ENVIRONMENT';
export const CONTENT_CACHE_ENVIRONMENT = ['NODE_COMPILE_CACHE','NTS_NODE_DEPS_CACHE','NTS_NODE_INPUTS_CACHE','NTS_PINNED_INPUTS_CACHE','NTS_CENSUS_OBJECT_CACHE','NTS_CENSUS_CASE_ROOTS','NTS_JVM_CDS_DIR'] as const;
export function cacheLocation(name:string,env:NodeJS.ProcessEnv,production:()=>string):string{
  const declared=env[name];
  if(typeof declared==='string'&&declared.length)return declared;
  if(env[FIXTURE_ENVIRONMENT]!==undefined)throw Object.assign(new Error('fixture cache capability missing: '+name),{code:'NTS_FIXTURE_CACHE_MISSING'});
  return production();
}
