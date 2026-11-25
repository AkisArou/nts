// Validate a summary without constructing its case population or one large string.
import {closeSync,constants,fstatSync,lstatSync,openSync,readSync} from 'node:fs';
import {createHash} from 'node:crypto';

type Selection={readonly [key:string]:Selection|true};
const selection:Selection={schema:true,started:true,wall_s:true,verdict:true,interrupted:true,
  scope_cleanup:{state:true},environment:{canonical:true},
  case_costs:{version:true,status:true,error_count:true,errors:true,steps:true}};
export type SummaryFact={kind:'object'|'array';empty:boolean}|{kind:'scalar';value:unknown};
export type SummaryFacts={facts:ReadonlyMap<string,SummaryFact>;digest:string;bytes:number};
const tokenLimit=4096,depthLimit=256;

class JsonInput {
  private text='';
  private at=0;
  private ended=false;
  private decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  private chunks:Iterator<Uint8Array>;
  constructor(chunks:Iterator<Uint8Array>){this.chunks=chunks;}
  close():void{this.chunks.return?.();}
  peek():string{
    while(this.at===this.text.length&&!this.ended){
      const next=this.chunks.next();this.at=0;
      if(next.done){this.ended=true;this.text=this.decoder.decode();}
      else this.text=this.decoder.decode(next.value,{stream:true});
    }
    return this.text[this.at]??'';
  }
  take():string{const value=this.peek();if(!value)throw Error('truncated summary JSON');this.at++;return value;}
  space():void{while(/[\x20\t\r\n]/.test(this.peek())&&this.peek())this.at++;}
  expect(value:string):void{if(this.take()!==value)throw Error('malformed summary JSON: expected '+value);}
  string(capture:false|'key'|'value'):string|undefined{
    this.expect('"');let raw=capture?'"':'';
    const append=(text:string)=>{
      if(!capture)return;
      if(raw.length+text.length>tokenLimit){
        if(capture==='value')throw Error('summary decision string exceeds its bound');
        capture=false;raw='';return; // An oversized unknown key cannot name a decision field.
      }
      raw+=text;
    };
    for(;;){
      if(!this.peek())throw Error('truncated summary JSON string');
      const special=/["\\\x00-\x1f]/g;special.lastIndex=this.at;
      const found=special.exec(this.text),end=found?.index??this.text.length;
      if(capture)append(this.text.slice(this.at,end));this.at=end;
      if(!found)continue;
      const char=this.take();append(char);
      if(char==='"')return capture?JSON.parse(raw) as string:undefined;
      if(char!=='\\')throw Error('unescaped control in summary JSON string');
      const escaped=this.take();append(escaped);
      if(escaped==='u')for(let i=0;i<4;i++){
        const hex=this.take();if(!/^[0-9a-fA-F]$/.test(hex))throw Error('invalid summary JSON Unicode escape');append(hex);
      }
      else if(!'"\\/bfnrt'.includes(escaped))throw Error('invalid summary JSON escape');
    }
  }
  scalar():unknown{
    let raw='';
    while(this.peek()){
      const delimiter=/[\x20\t\r\n,\]}]/g;delimiter.lastIndex=this.at;
      const end=delimiter.exec(this.text)?.index??this.text.length;
      if(raw.length+end-this.at>tokenLimit)throw Error('summary JSON scalar exceeds its bound');
      raw+=this.text.slice(this.at,end);this.at=end;
      if(this.at<this.text.length)break;
    }
    // JSON.parse handles number syntax, true, false and null, on this bounded token only.
    const value:unknown=JSON.parse(raw);
    if(value!==null&&typeof value==='object')throw Error('invalid summary JSON scalar');
    return value;
  }
}

/** Every byte is validated and hashed. Only fixed decision paths are retained;
 * ignored strings may exceed V8's whole-string limit without being allocated. */
export function projectSummary(chunks:Iterable<Uint8Array>):SummaryFacts{
  const hash=createHash('sha256');let bytes=0;
  function* observed(){for(const chunk of chunks){hash.update(chunk);bytes+=chunk.byteLength;yield chunk;}}
  const input=new JsonInput(observed()),facts=new Map<string,SummaryFact>();
  const value=(select:Selection|true|undefined,path:string,depth:number):void=>{
    if(depth>depthLimit)throw Error('summary JSON nesting exceeds its bound');
    input.space();const first=input.peek();
    if(first==='{'){
      input.take();input.space();let empty=true;
      const selected=select&&select!==true?new Set<string>():undefined;
      if(input.peek()!=='}')for(;;){
        const key=input.string(select&&select!==true?'key':false);input.space();input.expect(':');
        const child=key!==undefined&&select&&select!==true&&Object.hasOwn(select,key)?select[key]:undefined;
        if(child){if(selected!.has(key!))throw Error('duplicate summary decision field: '+path+key);selected!.add(key!);}
        value(child,child?(path?path+'.':'')+key:'',depth+1);empty=false;input.space();
        const end=input.take();if(end==='}')break;if(end!==',')throw Error('malformed summary JSON object');input.space();
      }
      else input.take();
      if(select)facts.set(path,{kind:'object',empty});
    }else if(first==='['){
      input.take();input.space();let empty=true;
      if(input.peek()!==']')for(;;){
        value(undefined,'',depth+1);empty=false;input.space();const end=input.take();
        if(end===']')break;if(end!==',')throw Error('malformed summary JSON array');
      }
      else input.take();
      if(select)facts.set(path,{kind:'array',empty});
    }else{
      const result=first==='"'?input.string(select?'value':false):input.scalar();
      if(select)facts.set(path,{kind:'scalar',value:result});
    }
  };
  try{
    value(selection,'',0);input.space();if(input.peek())throw Error('trailing bytes in summary JSON');
    if(facts.get('')?.kind!=='object')throw Error('summary JSON is not an object');
    return {facts,digest:hash.digest('hex'),bytes};
  }finally{input.close();}
}

function* fileChunks(path:string):Generator<Uint8Array>{
  const before=lstatSync(path);
  if(!before.isFile()||before.isSymbolicLink()||before.uid!==process.getuid?.())throw Error('not an owned regular record: '+path);
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const opened=fstatSync(fd);
    if(before.dev!==opened.dev||before.ino!==opened.ino||before.uid!==opened.uid)throw Error('summary identity changed before read');
    const buffer=Buffer.allocUnsafe(64*1024);
    for(;;){const size=readSync(fd,buffer,0,buffer.length,null);if(!size)break;yield buffer.subarray(0,size);}
    const after=fstatSync(fd);
    if(opened.size!==after.size||opened.mtimeMs!==after.mtimeMs||opened.ctimeMs!==after.ctimeMs)throw Error('summary changed during read');
  }finally{closeSync(fd);}
}

export function readSummaryFacts(path:string):SummaryFacts{return projectSummary(fileChunks(path));}

/** The final guard compares bytes to the already validated projection. */
export function summaryDigest(path:string):string{
  const hash=createHash('sha256');for(const chunk of fileChunks(path))hash.update(chunk);return hash.digest('hex');
}
