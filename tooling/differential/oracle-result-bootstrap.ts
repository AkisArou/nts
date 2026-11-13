// This source is also valid JavaScript: the native consumer pins these bytes
// in its data URL, without asking Node to strip TypeScript in every process.
import {registerHooks} from 'node:module';
import {openSync,closeSync,fstatSync,readFileSync,realpathSync,constants} from 'node:fs';
import {hash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';

const files=new Map(Object.entries(JSON.parse(decodeURIComponent(new URL(import.meta.url).hash.slice(1))))
  .map(([path,digest])=>[pathToFileURL(path).href,digest]));
const io={open:openSync,close:closeSync,stat:fstatSync,read:readFileSync,real:realpathSync},digest=hash;
registerHooks({load(url,context,next){
  if(url.startsWith('node:'))return next(url,context);
  const expected=files.get(url);
  if(typeof expected!=='string')throw Error('program oracle reader module was not published: '+url);
  if(io.real(new URL(url))!==fileURLToPath(url))throw Error('program oracle reader path changed: '+url);
  const fd=io.open(new URL(url),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    if(!io.stat(fd).isFile())throw Error('program oracle reader is not a file: '+url);
    const bytes=io.read(fd);
    if(digest('sha256',bytes,'hex')!==expected)throw Error('program oracle reader bytes changed: '+url);
    return {format:'module',source:bytes,shortCircuit:true};
  }finally{io.close(fd);}
}});
