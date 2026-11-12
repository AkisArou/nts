// A Cargo target root and a selected Clippy cache are distinct inputs.
// Callers select once; no route guesses the input's basis from its basename.
import {basename,join,resolve} from 'node:path';
import {TEST_PROFILE} from './test-profile.ts';

export const CLIPPY_CACHE_DIRECTORY='clippy';
export function clippyTarget(root:string):string {return join(resolve(root),CLIPPY_CACHE_DIRECTORY);}
export function innerBuildOutputs(root:string):{name:string;path:string}[]{
  return [{name:TEST_PROFILE,path:join(resolve(root),TEST_PROFILE)},{name:'clippy',path:clippyTarget(root)}];
}
export function assertClippyTarget(cache:string):string {
  const selected=resolve(cache);
  if(basename(selected)!==CLIPPY_CACHE_DIRECTORY)throw Error('Clippy selected cache must be a declared '+CLIPPY_CACHE_DIRECTORY+' directory: '+cache);
  return selected;
}
