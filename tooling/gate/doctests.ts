// The shared owner also validates rustdoc's input artifacts and profile.
import {runTestProfile} from './test-profile.ts';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  runTestProfile('doctests').then(status=>{if(status!==0)console.error('doctests: cargo exited '+status);process.exitCode=status===0?0:1;},error=>{console.error('NOT MEASURED: '+String(error));process.exitCode=2;});
