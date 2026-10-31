// run: build
// sanitizer: function
function run(n:number):number {
  const reads:Array<()=>number>=[()=>n,()=>n+1,()=>n+2];
  const read=reads[(((n|0)%3)+3)%3];
  return read();
}
observe("answer",String(run(7)));
done();
