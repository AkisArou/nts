// Loaded before a test entry. The process owns a complete synthetic resource
// view and private state; a raw environment copy carries a deliberately invalid
// Node option. Declared tool/cache capabilities survive through the owner only.
import {testEnvironment} from './test-environment.ts';
export function installTestHost():void {
  const environment=testEnvironment();
  for(const name of ['NODE_TEST_CONTEXT','NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE']){
    if(process.env[name]!==undefined)environment[name]=process.env[name];
  }
  process.env=environment;
  process.env.NTS_UNDECLARED_TEST_ENVIRONMENT='poison: ambient environment copied';
  process.env.NODE_OPTIONS='--nts-undeclared-test-environment';
}
// node --test loads --import in its parent too. Poison only the entry workers,
// after Node has created their protocol, never the process that forks them.
if(process.env.NODE_TEST_CONTEXT)installTestHost();
