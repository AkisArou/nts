// The landing service's persistent tree and target, shared with disk upkeep.
import {homedir} from 'node:os';
import {join} from 'node:path';
export const LANDING_HOME=join(homedir(),'.cache/nts-landing');
export function landingLayout(home=LANDING_HOME):{home:string;tree:string;target:string}{
  return {home,tree:join(home,'tree'),target:join(home,'target')};
}
