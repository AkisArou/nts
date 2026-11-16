import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFeed} from './admission.ts';
import {waitFor} from './test-wait.ts';
import type {TokenRelease} from './case-context.ts';

test('outranking cancels a token wait and joins idle close before resuming its one returned path',async()=>{
 let outranked=false,requests=0,closed=false,resumed=false;
 const seen:string[]=[],closing=Promise.withResolvers<void>(),requestStarted=Promise.withResolvers<void>();
 const feed=createFeed(['one'],{everyMs:1,outranked:()=>outranked,
  token:async(_path,signal)=>{requests++;if(requests===1){requestStarted.resolve();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));return null;}return()=>{seen.push('release');};},
  pause:async()=>{assert.equal(closed,true,'job promise returned before idle worker close');seen.push('pause');},resume:async()=>{resumed=true;seen.push('resume');},
 });
 const pending=feed.feed({exited:()=>false,end:()=>assert.fail('one path disappeared'),
  yield:async()=>{seen.push('close');await closing.promise;closed=true;},
  write:(_path,release)=>{assert.equal(resumed,true);seen.push('one');release();},
 });
 await requestStarted.promise;outranked=true;
 await waitFor('idle close after the real token cancellation',()=>seen.includes('close'));
 assert.equal(requests,1);assert.equal(feed.dispatched,0);assert.equal(seen.includes('pause'),false);
 closing.resolve();await waitFor('owned pause after idle close',()=>seen.includes('pause'));
 outranked=false;await pending;
 assert.equal(requests,2);assert.equal(feed.dispatched,1);assert.deepEqual(seen.slice(-3),['resume','one','release']);
});
test('a raced grant is returned before owned yield and an already aborted worker never reserves a path',async()=>{
 const stop=new AbortController(),started=Promise.withResolvers<void>(),grant=Promise.withResolvers<()=>void>(),events:string[]=[];let outranked=false;
 const feed=createFeed(['one'],{everyMs:1,outranked:()=>outranked,token:()=>{started.resolve();return grant.promise;},pause:async()=>{events.push('pause');},resume:async()=>{events.push('resume');}});
 const pending=feed.feed({signal:stop.signal,exited:()=>stop.signal.aborted,end:()=>{},yield:async()=>{events.push('close');},write:()=>assert.fail('outranked grant dispatched')});
 await started.promise;outranked=true;grant.resolve(()=>{events.push('release');});
 await waitFor('raced grant returned and owned idle close',()=>events.includes('close'));assert.ok(events.indexOf('release')<events.indexOf('close'));
 stop.abort();await pending;assert.equal(feed.dispatched,0);
 assert.equal(feed.returnedOffers,1,'the raced grant returned inside reserve, before any offer escaped');
 let asked=0;const aborted=createFeed(['one'],{token:async()=>{asked++;return()=>{};}});
 await aborted.feed({signal:stop.signal,exited:()=>false,end:()=>{},write:()=>assert.fail('aborted worker dispatched')});assert.equal(asked,0);
});

test('an undispatched offer returns its exact path only after its token joins',async()=>{
 const closed=Promise.withResolvers<void>(),events:string[]=[];
 const token:TokenRelease=()=>{events.push('release');};token.closed=closed.promise;
 const feed=createFeed(['one'],{token:async()=>token});
 const endpoint={exited:()=>false,end:()=>{events.push('end');}};
 const first=await feed.reserve(endpoint);assert.ok(first);assert.equal(feed.dispatched,0);
 const returned=first.return();assert.equal(first.return(),returned);
 await waitFor('unused offer token release',()=>events.includes('release'));
 assert.equal(await feed.reserve(endpoint),undefined,'a path was re-offered before its old token drained');
 assert.equal(feed.dispatched,0);assert.equal(feed.returnedOffers,0,'an unjoined return is not counted');closed.resolve();await returned;
 assert.equal(feed.returnedOffers,1);await first.return();assert.equal(feed.returnedOffers,1,'repeated returns join the same counted event');
 const next=await feed.reserve(endpoint);assert.ok(next);assert.equal(next.path,'one');
 next.commit();assert.equal(feed.dispatched,1);assert.throws(()=>next.commit(),/no longer reserved/);
 assert.throws(()=>next.return(),/already dispatched/);next.release();
 assert.equal(feed.returnedOffers,1,'ordinary committed releases are not returned offers');
});
test('dispatch failure returns its offer without counting a case or losing the primary error',async()=>{
 let releases=0;const feed=createFeed(['one'],{token:async()=>()=>{releases++;}});
 const error=Error('private dispatch failure');
 await assert.rejects(feed.feed({exited:()=>false,end:()=>{},write:()=>{throw error;}}),value=>value===error);
 assert.equal(feed.dispatched,0);assert.equal(releases,1);
 const offer=await feed.reserve({exited:()=>false,end:()=>assert.fail('failed dispatch lost its case')});
 assert.equal(offer?.path,'one');await offer!.return();assert.equal(releases,2);
});
test('a worker whose idle close outlasts its flight joins that flight\'s one resume instead of pausing a cleared yield',async()=>{
 let outranked=false,pauses=0,resumes=0;
 const slowClose=Promise.withResolvers<void>(),closing=Promise.withResolvers<void>(),started=Promise.withResolvers<void>(),hold=Promise.withResolvers<void>();
 const written:string[]=[];
 const feed=createFeed(['one','two','three','four'],{everyMs:1,outranked:()=>outranked,
  pause:async()=>{pauses++;},resume:async()=>{resumes++;},
 });
 const worker=(close:()=>Promise<void>)=>{
  let ended=false;const endpoint={exited:()=>false,end:()=>{ended=true;},yield:close,
   write:async(path:string,release:()=>void)=>{written.push(path);if(path==='one'){started.resolve();await hold.promise;}release();}};
  return (async()=>{while(!ended)await feed.feed(endpoint);})();
 };
 const fast=worker(async()=>{});
 await started.promise;outranked=true;
 const slow=worker(async()=>{closing.resolve();await slowClose.promise;});
 await closing.promise;hold.resolve();
 await waitFor('slow worker closing inside the flight',()=>pauses>0);
 outranked=false;
 await waitFor('fast worker resumed and cleared the flight',()=>resumes===1&&written.length>1);
 slowClose.resolve();
 await Promise.all([fast,slow]);
 assert.deepEqual([...written].sort(),['four','one','three','two']);
 assert.equal(resumes,1,'one resume per flight');assert.equal(pauses,1,'a worker paused a flight already resumed');
});
test('a worker that enters while its flight is mid-resume joins that resume without closing again',async()=>{
 let outranked=true,pauses=0,resumes=0,lateCloses=0;
 const resuming=Promise.withResolvers<void>(),resumeStarted=Promise.withResolvers<void>();
 const written:string[]=[];
 const feed=createFeed(['one','two','three'],{everyMs:1,outranked:()=>outranked,
  pause:async()=>{pauses++;},resume:async()=>{resumes++;resumeStarted.resolve();await resuming.promise;},
 });
 const worker=(close:()=>Promise<void>)=>{
  let ended=false;const endpoint={exited:()=>false,end:()=>{ended=true;},yield:close,
   write:(path:string,release:()=>void)=>{assert.equal(resumes,1,'a case started before its flight resumed');written.push(path);release();}};
  return (async()=>{while(!ended)await feed.feed(endpoint);})();
 };
 const first=worker(async()=>{});
 await waitFor('first worker paused its flight',()=>pauses>0);
 outranked=false;await resumeStarted.promise;
 const late=worker(async()=>{lateCloses++;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(written.length,0,'a case started while its flight was resuming');
 resuming.resolve();await Promise.all([first,late]);
 assert.deepEqual([...written].sort(),['one','three','two']);
 assert.equal(lateCloses,0,'a worker entering a resuming flight closed again');
 assert.equal(pauses,1);assert.equal(resumes,1);
});
