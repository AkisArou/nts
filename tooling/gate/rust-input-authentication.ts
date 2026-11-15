// Post-run only. Ordinary Cargo execution imports neither this validator nor
// the canonical graph. The run's authoritative handoff selects every artifact.
import {createHash} from 'node:crypto';
import {deriveInputTrace,readInputTraceIndex,type InputTraceDerivation,type InputIndexRow} from './rust-test-inputs.ts';
import type {FileObserverReceipt} from './file-input-observer.ts';

export type RustInputCapture=Omit<InputTraceDerivation,'observer'>&{index:string;observer:FileObserverReceipt|null};

/** Checking a footer's raw hash alone does not bind its interpreted subjects
 * or phases. Re-derive the same bounded stream from the separately selected
 * raw artifact, Cargo target, doctest-call inventory and pre-capture observer
 * receipt. This checks all fields without materializing another index. Legacy
 * null receipts remain null and confer no ABI interpretation authority. */
export async function authenticateRustInputTrace(capture:RustInputCapture,provisional?:(row:InputIndexRow)=>void|Promise<void>){
  const indexed=createHash('sha256'),derived=createHash('sha256');
  const update=(hash:typeof indexed,row:InputIndexRow)=>{hash.update(JSON.stringify(row));hash.update('\n');};
  const result=await readInputTraceIndex(capture.index,async row=>{update(indexed,row);await provisional?.(row);});
  const {index:unused,observer,...options}=capture;void unused;
  await deriveInputTrace({...options,...(observer?{observer}:{})},row=>{update(derived,row);});
  const indexRowsSha256=indexed.digest('hex'),derivedRowsSha256=derived.digest('hex');
  if(indexRowsSha256!==derivedRowsSha256)throw Error('Rust input authentication: index differs from authoritative raw derivation');
  return {...result,indexRowsSha256};
}
