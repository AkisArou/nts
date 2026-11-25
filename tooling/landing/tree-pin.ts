// A pool operation owns one directory descriptor through Git work and lease
// publication. Older pool code observes it through its existing process rule.
import {closeSync,constants,fstatSync,lstatSync,mkdirSync,openSync,readdirSync,rmdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve,sep} from 'node:path';
import {processIdentity} from './lock.ts';
import type {TreeUser} from './tree-users.ts';

const absent=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
const overlaps=(a:string,b:string)=>a===b||a.startsWith(b+sep)||b.startsWith(a+sep);
type Directory={dev:number;ino:number;uid:number};
export class TreePin {
  private static readonly active=new Map<string,TreePin>();
  readonly id=randomUUID();readonly root:string;readonly pid:number;readonly identity:string;readonly created:boolean;
  private readonly fd:number;private readonly directory:Directory;private closed=false;
  private constructor(root:string,fd:number,created:boolean){
    this.root=root;this.fd=fd;this.created=created;this.pid=process.pid;
    this.identity=processIdentity(this.pid)??'';if(!this.identity)throw Error('pool tree pin has no birth identity');
    const info=fstatSync(fd);this.directory={dev:info.dev,ino:info.ino,uid:info.uid};
    if(!info.isDirectory()||info.uid!==process.getuid?.())throw Error('pool pin is not an owned directory: '+root);
    TreePin.active.set(this.id,this);
  }
  /** Caller holds the pool lock. This is mkdir/open/stat only, never a walk. */
  static open(path:string,create=false):TreePin{
    path=resolve(path);let created=false,fd:number|undefined,identity:Directory|undefined,owned:TreePin|undefined;
    try{
      let info;
      try{info=lstatSync(path);}catch(error){if(!absent(error)||!create)throw error;mkdirSync(path);created=true;info=lstatSync(path);}
      identity={dev:info.dev,ino:info.ino,uid:info.uid};
      if(!info.isDirectory()||info.isSymbolicLink())throw Error('pool pin root is not a physical directory: '+path);
      fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
      const pin=owned=new TreePin(path,fd,created);
      if(!pin.sameDirectory())throw Error('pool pin directory changed: '+path);
      return pin;
    }catch(error){
      if(owned)owned.close();else if(fd!==undefined)closeSync(fd);
      if(created&&identity){try{const current=lstatSync(path);if(current.dev===identity.dev&&current.ino===identity.ino&&current.uid===identity.uid)rmdirSync(path);}catch(cleanup){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes((cleanup as NodeJS.ErrnoException).code??''))throw cleanup;}}
      throw error;
    }
  }
  private live():boolean{
    if(this.closed||TreePin.active.get(this.id)!==this||this.pid!==process.pid||processIdentity(this.pid)!==this.identity)return false;
    const info=fstatSync(this.fd);return info.dev===this.directory.dev&&info.ino===this.directory.ino&&info.uid===this.directory.uid;
  }
  /** An observation may ignore this exact FD only after owner/birth validation.
   * The scanner continues to every other descriptor of this same process. */
  owns(pid:number,link:string,birth:string):boolean{
    return pid===this.pid&&link==='fd/'+this.fd&&birth===this.identity.split(' ')[2]&&this.live();
  }
  static users(path:string,own?:TreePin):TreeUser[]{
    path=resolve(path);return [...this.active.values()].filter(pin=>pin.live()&&overlaps(pin.root,path)&&!(pin===own&&own.live()))
      .map(pin=>({pid:pin.pid,command:'pool operation',where:'an open tree pin '+pin.id+'; birth '+pin.identity}));
  }
  private sameDirectory():boolean{
    try{const info=lstatSync(this.root);return info.isDirectory()&&!info.isSymbolicLink()&&info.dev===this.directory.dev&&info.ino===this.directory.ino&&info.uid===this.directory.uid;}
    catch(error){if(absent(error))return false;throw error;}
  }
  /** The potentially large emptiness observation runs outside the pool lock. */
  emptyPlaceholder():boolean{return this.live()&&this.created&&this.sameDirectory()&&readdirSync(this.root).length===0;}
  /** Caller holds the pool lock; rmdir itself rechecks emptiness atomically. */
  removePlaceholder():void{
    if(!this.live()||!this.created||!this.sameDirectory())return;
    try{rmdirSync(this.root);}catch(error){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes((error as NodeJS.ErrnoException).code??''))throw error;}
  }
  close():void{if(this.closed)return;this.closed=true;TreePin.active.delete(this.id);closeSync(this.fd);}
}
