// The throwing control changes only the literal to the same class methods.
// The undefined-field control changes only early exit to exhaustion.
interface Closing {
 count:number; closed:number; phase:number;
 [Symbol.iterator]():Closing;
 next():{value:number;done:boolean};
 return():{value:number;done:boolean};
}
class Named implements Closing {
 count=0; closed=0;
 constructor(public phase:number){}
 [Symbol.iterator]():Closing{return this;}
 next():{value:number;done:boolean}{const value=++this.count;return {value,done:value>2};}
 return():{value:number;done:boolean}{if(this.phase<0)throw 71;this.closed=1;return {value:0,done:true};}
}
function literal(phase:number):Closing {
 return {count:0,closed:0,phase,
  [Symbol.iterator](){return this;},
  next(){const value=++this.count;return {value,done:value>2};},
  return(){if(this.phase<0)throw 71;this.closed=1;return {value:0,done:true};},
 };
}
function close(source:Closing):number {
 try {for(const value of source){break;}return source.closed*10+source.count;}
 catch(e){return e as number;}
}
export function throwingLiteral(n:number):number{return close(literal(n));}
export function throwingClassControl(n:number):number{return close(new Named(n));}
interface Optional {
 count:number;closed:number;
 return?: (this:Optional)=>{value:number;done:boolean};
 [Symbol.iterator]():Optional;
 next():{value:number;done:boolean};
}
function withoutField():Optional {
 return {count:0,closed:0,return:undefined,
  [Symbol.iterator](){return this;},
  next(){const value=++this.count;return {value,done:value>2};},
 };
}
function field(source:Optional,early:boolean):number{
 for(const value of source){if(early)break;}
 return source.closed*10+source.count;
}
export function undefinedField(n:number):number{return field(withoutField(),true);}
export function exhaustedFieldControl(n:number):number{return field(withoutField(),false);}
