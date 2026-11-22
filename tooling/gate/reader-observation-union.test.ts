import assert from 'node:assert/strict';
import {test} from 'node:test';
import {projectObservationCapture,type CapturedReaderObservation} from './reader-observations.ts';

test('reader cause union bounds comparisons while preserving every cause and ordinary authority',()=>{
  for(const size of [128,256]){
    const root='/controlled-source',capture=projectObservationCapture(root);
    const causes=Array.from({length:size*3/2},(_,index)=>({kind:'fileExists' as const,path:root+'/input-'+index}));
    const observation={kind:'runtimeKind' as const,path:root,value:'directory'};
    let comparisons=0,rows:CapturedReaderObservation[];
    const descriptor=Object.getOwnPropertyDescriptor(Array.prototype,'some')!,some=Array.prototype.some;
    Object.defineProperty(Array.prototype,'some',{...descriptor,value:function(this:unknown[],...args:Parameters<typeof some>){
      return some.call(this,(value,index,array)=>{comparisons++;return args[0].call(args[1],value,index,array);});
    }});
    try{
      capture.merge([{observation,causes:causes.slice(0,size),observationOnly:true}]);
      capture.merge([{observation,causes:causes.slice(size/2)}]);
      rows=capture.finish();
    }finally{Object.defineProperty(Array.prototype,'some',descriptor);}
    assert.ok(comparisons<=size*8,'cause union performs at most linear comparison work: '+comparisons+' for '+size);
    assert.equal(rows.length,1);assert.equal(rows[0]!.observationOnly,undefined);
    assert.deepEqual(rows[0]!.causes.map(cause=>JSON.stringify(cause)).sort(),causes.map(cause=>JSON.stringify(cause)).sort());
  }
});
