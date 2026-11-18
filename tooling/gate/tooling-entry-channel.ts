// One file's private inherited descriptor, never its test stdout/stderr.
import {ToolingInstrumentError} from './step-result.ts';

export type ToolingEntryFrame={version:1;nonce:string;file:string;pid:number;sequence:number;
  event:'ready'|'start'|'complete'|'instrument';id?:number;name?:string;failed?:boolean;
  instrument?:{kind:ToolingInstrumentError['kind']|'memory-pressure';reason:string}};
export class ToolingEntryEvidence {
  private sequence=0;
  private sealed=false;
  ready=false;
  completedTests=0;
  completedFailures=0;
  instrument:ToolingEntryFrame['instrument'];
  readonly open=new Map<number,string>();
  readonly file:string;
  readonly nonce:string;
  readonly pid:number;
  constructor(file:string,nonce:string,pid:number){this.file=file;this.nonce=nonce;this.pid=pid;}
  accept(value:unknown):void {
    const row=value as ToolingEntryFrame;
    const invalid=(reason:string):never=>{throw new ToolingInstrumentError('tooling-setup','invalid tooling entry channel: '+reason);};
    if(this.sealed)invalid('report after termination');
    if(!row||typeof row!=='object'||row.version!==1||row.nonce!==this.nonce||row.file!==this.file||row.pid!==this.pid
        ||row.sequence!==this.sequence+1)invalid('foreign identity or sequence');
    if(row.event==='ready'){
      if(this.ready||this.sequence!==0||row.id!==undefined||row.name!==undefined||row.failed!==undefined)invalid('duplicate or malformed readiness');
      this.ready=true;
    }else if(row.event==='instrument'){
      const value=row.instrument;
      if(!this.ready||!value||!['tooling-setup','tooling-cleanup','disk-capacity','memory-pressure'].includes(value.kind)
          ||typeof value.reason!=='string'||!value.reason)invalid('malformed observation failure');
      this.instrument=value;this.sealed=true;
    }else{
      if(!this.ready||!Number.isSafeInteger(row.id)||row.id!<1||typeof row.name!=='string')invalid('missing entry or test identity');
      if(row.event==='start'){
        if(this.open.has(row.id!)||row.failed!==undefined)invalid('duplicate test start');
        this.open.set(row.id!,row.name!);
      }else if(row.event==='complete'){
        if(typeof row.failed!=='boolean')invalid('missing completed assertion verdict');
        this.open.delete(row.id!);this.completedTests++;if(row.failed)this.completedFailures++;
      }else invalid('unknown event');
    }
    this.sequence++;
  }
  seal():void{this.sealed=true;}
}
