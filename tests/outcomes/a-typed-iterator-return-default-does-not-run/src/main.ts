// run: check
// Exhaustion is the one-change control: it never calls return.
class Source {
  count=0;closed=0;
  return:()=>any=(value:number=3)=>{this.closed=value===3?1:9;return {value:0,done:true};};
  [Symbol.iterator]():Source{return this;}
  next():{value:number;done:boolean}{return {value:++this.count,done:this.count>2};}
}
export function subject(n:number):number{const s=new Source();for(const value of s){break;}return s.closed;}
export function control(n:number):number{const s=new Source();for(const value of s){}return s.closed;}
