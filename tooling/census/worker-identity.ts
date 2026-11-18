// The resident owner declares its execution role once, for both grants and
// test-entry revocation. Budgets such as MEMORY_CAP_KB are not worker roles.
const WORKER_ROLES={
  workerGroup:'NTS_CENSUS_WORKER_GROUP',workerMax:'NTS_CENSUS_WORKER_MAX_BYTES',
  runGroup:'NTS_CENSUS_RUN_GROUP',runMax:'NTS_CENSUS_RUN_MAX_BYTES',
  concurrency:'NTS_CENSUS_CASE_CONCURRENCY',pool:'NTS_CENSUS_POOL_WORKER',activeCase:'NTS_CENSUS_ACTIVE_CASE',
} as const;
export const WORKER_ROLE_VARIABLES:readonly string[]=Object.freeze(Object.values(WORKER_ROLES));
export function workerRoleValues(values:Partial<Record<keyof typeof WORKER_ROLES,string|undefined>>):NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(values).map(([key,value])=>[WORKER_ROLES[key as keyof typeof WORKER_ROLES],value]));
}

/** The same grammar validates tooling ancestry and creates resident workers. */
export const RESIDENT_WORKER_COMPONENT='w(?:0|[1-9a-z][a-z0-9]*)';
const validWorkerComponent=new RegExp('^'+RESIDENT_WORKER_COMPONENT+'$');
export function residentWorkerComponent(index:number):string {
  if(!Number.isSafeInteger(index)||index<0)throw Error('invalid resident worker ordinal');
  const component='w'+index.toString(36);
  if(!validWorkerComponent.test(component))throw Error('invalid resident worker component');
  return component;
}

export function isResidentWorkerComponent(value:string):boolean {
  if(!validWorkerComponent.test(value))return false;
  const index=Number.parseInt(value.slice(1),36);
  return Number.isSafeInteger(index)&&residentWorkerComponent(index)===value;
}
