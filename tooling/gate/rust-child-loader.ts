// One persistent capture helper serves one native observer. Only a proven
// request/image transition can borrow its stopped exec environment. This
// helper runs outside the observed tree and returns finite raw evidence.
import {imageReaderFrame,readImageReaderFrames} from './image-reader-protocol.ts';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {byteFactText,readObservationRow,type InputAttempt,type ByteFact} from './file-input-observer.ts';
import {RustInputPhases} from './rust-test-inputs.ts';
import {rustLoaderCapture,execEnvironment,type ChildLoaderFact} from './rust-loader.ts';

type Event={row:InputAttempt;changed:boolean;namespace:boolean;platform:string;platformMatches:boolean;environment?:ByteFact};
export function childLoaderReader(toolEnvironment:NodeJS.ProcessEnv){
  const phases=new RustInputPhases('/',{package:'capture',name:'images',kind:['capture'],source:'<capture>'}),cache=rustLoaderCapture(toolEnvironment);
  const requests=new Map<string,{id:string;environment:ByteFact|undefined}>();
  return {statistics:cache.statistics,observe(event:Event):ChildLoaderFact|null{
    if(typeof event.changed!=='boolean'||typeof event.namespace!=='boolean'||typeof event.platformMatches!=='boolean'
      ||typeof event.platform!=='string'||!/^[0-9a-f]+:[0-9a-f]+$/.test(event.platform))throw Error('malformed stopped image context');
    const row=readObservationRow(event.row);if(row.kind!=='attempt')throw Error('image capture needs a stopped attempt');
    const image=phases.observe(row),key=row.tgid+':'+row.birth;
    let result:ChildLoaderFact|null=null;
    if(event.changed){
      const base={version:1 as const,pid:row.tgid,birth:row.birth,path:image.path,cwd:image.cwd};
      const request=image.argvSource.kind==='request'?requests.get(key):undefined;
      if(!request||image.argvSource.kind!=='request'||request.id!==image.argvSource.attempt)
        result={...base,state:'unavailable',reason:'no bound exec request/environment'};
      else try{
        if(!event.namespace)throw Error('task mount/root namespace differs from observer');
        if(!event.platformMatches)throw Error('task auxv platform differs from capture helper or is secure');
        // The C producer proved namespace equality before entering this call.
        // /proc/<tid>/exe names the stopped image, including a replaced path.
        const active='/proc/'+row.tid+'/exe';
        const captured=cache.capture(image.path,image.cwd,execEnvironment(request.environment,byteFactText),event.platform,active);
        if(captured.executable.physical!==image.path)throw Error('stopped image pathname changed during capture');
        result={...base,state:'captured',request:request.id,...captured};
      }catch(error){result={...base,state:'unavailable',request:request.id,reason:String(error)};}
      requests.delete(key);
    }
    if(row.exec){phases.request(row,image);requests.set(key,{id:row.id,environment:event.environment});}
    return result;
  }};
}

runAsCommand(import.meta.url,async()=>{
  const reader=childLoaderReader(process.env);
  const reply=(value:unknown)=>new Promise<void>((done,reject)=>{process.stdout.write(imageReaderFrame(value),error=>error?reject(error):done());});
  for await(const frame of readImageReaderFrames(process.stdin)){
    const value=frame as Event|{kind:'close'};
    if('kind'in value&&value.kind==='close'){
      await reply({version:1,kind:'complete',statistics:reader.statistics()});process.stdin.destroy();return 0;
    }
    await reply(reader.observe(value as Event));
  }
  // EOF without the observer's final handshake cannot claim completion.
  throw Error('child loader capture closed without drain handshake');
});
