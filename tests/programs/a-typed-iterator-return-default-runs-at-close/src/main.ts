// A typed return callback runs its default at the uniform entry when close
// supplies undefined. On clean 6ead, C/LLVM/JVM answered 29/58 wrong;
// Wasm declined the 29 subjects and agreed on the 29 exhaustion controls.
// Clean ccebd9080df9 agrees on 58/58 on each of the four backends.
// Exhaustion is the one-change control: it never calls return.
class Source {
  count=0;closed=0;
  return:()=>any=(value:number=3)=>{this.closed=value===3?1:9;return {value:0,done:true};};
  [Symbol.iterator]():Source{return this;}
  next():{value:number;done:boolean}{return {value:++this.count,done:this.count>2};}
}
export function subject(n:number):number{const s=new Source();for(const value of s){break;}return s.closed;}
export function control(n:number):number{const s=new Source();for(const value of s){}return s.closed;}
