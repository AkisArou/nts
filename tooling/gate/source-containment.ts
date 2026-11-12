// Compare physical locations before creating a destination that may not exist.
import {lstatSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';

export function canonicalLocation(path:string):string {
  const requested=resolve(path);let ancestor=requested;
  for(;;){
    try{lstatSync(ancestor);break;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;ancestor=dirname(ancestor);}
  }
  return resolve(realpathSync(ancestor),relative(ancestor,requested));
}

export function outsideSource(source:string,destination:string,description:string):string {
  const root=canonicalLocation(source),actual=canonicalLocation(destination),part=relative(root,actual);
  if(part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part))
    throw new Error(`${description} resolves inside source tree: ${destination}`);
  return actual;
}
