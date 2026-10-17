// run: check
// The control changes only early completion to exhaustion, so return is not called.
class Source {
  count=0; closed=0;
  [Symbol.iterator]():Source {return this;}
  next():{value:number;done:boolean} {return {value:++this.count,done:this.count>2};}
  return(value:number):{value:number;done:boolean} {this.closed=typeof value==='undefined'?1:9;return {value:0,done:true};}
}
export function subject(n:number):number {const s=new Source();for(const v of s){break;}return s.closed+n;}
export function control(n:number):number {const s=new Source();for(const v of s){}return s.closed+n;}
