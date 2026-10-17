// The controls change only a literal iterator to the same methods in a class.
// Natural exhaustion isolates acquisition and next from IteratorClose.
// Clean a72 crashes on the literal calls; the two class controls agree58/58.
interface Source {
 count: number; closed: number; phase: number;
 [Symbol.iterator](): Source;
 next(): {value:number;done:boolean};
 return(): {value:number;done:boolean};
}
class Named implements Source {
 count=0; closed=0;
 constructor(public phase:number) {}
 [Symbol.iterator]():Source { if(this.phase===1)throw 71; return this; }
 next():{value:number;done:boolean} { if(this.phase===2)throw 72; const value=++this.count; return {value,done:value>2}; }
 return():{value:number;done:boolean} { if(this.phase===3)throw 73; this.closed=1; return {value:0,done:true}; }
}
function literal(phase:number):Source {
 return {count:0,closed:0,phase,
  [Symbol.iterator](){if(this.phase===1)throw 71;return this;},
  next(){if(this.phase===2)throw 72;const value=++this.count;return {value,done:value>2};},
  return(){if(this.phase===3)throw 73;this.closed=1;return {value:0,done:true};},
 };
}
function walk(source:Source):number {
 try {for(const value of source){} return source.closed*10+source.count;}
 catch(e){return e as number;}
}
export function literalAcquire(n:number):number{return walk(literal(n<0?1:0));}
export function namedAcquire(n:number):number{return walk(new Named(n<0?1:0));}
export function literalNext(n:number):number{return walk(literal(n<0?2:0));}
export function namedNext(n:number):number{return walk(new Named(n<0?2:0));}
