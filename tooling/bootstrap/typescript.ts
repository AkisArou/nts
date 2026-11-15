// The corpus pin is data shared with the native checker's Rust contract.
import {readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {fileInput} from '../gate/reader-inputs/main.ts';
import {corpus,type Corpus} from '../inputs/corpus.ts';
import {corpusCommand} from '../inputs/corpus-command.ts';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {ToolingInstrumentError} from '../differential/command-entry/instrument.ts';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const PIN=fileInput(new URL('./typescript.pin',import.meta.url));
export const TYPESCRIPT_NATIVE=fileInput(new URL('../../third_party/tsrs/UPSTREAM.json',import.meta.url));
export function typescriptDefinition(root=ROOT):Corpus{
  const input=(url:URL)=>pathToFileURL(join(root,relative(ROOT,fileURLToPath(url))));
  return {pinSource:input(PIN),upstream:'https://github.com/microsoft/TypeScript',sparse:['/tsc/testdata/tests/'],sparseMode:'no-cone',slot:'typescript',
    verifyPin(pin,source){
      const nativePath=new URL(relative(fileURLToPath(new URL('./',PIN)),fileURLToPath(TYPESCRIPT_NATIVE)),source);
      const native=JSON.parse(readFileSync(nativePath,'utf8'));
      if(native.typescript_commit!==pin)throw new ToolingInstrumentError('tooling-setup',`TypeScript corpus ${pin} differs from the native checker ${native.typescript_commit}; re-pin with node compiler/frontend-tsrs/vendor.ts --source <tsrs-checkout> --rev <commit>, update tooling/bootstrap/typescript.pin, then run the tree's input linker`);
    }};
}
export const TYPESCRIPT=typescriptDefinition();
export const corpusPin=(root=ROOT):string=>corpus(typescriptDefinition(root)).pin;
runAsCommand(import.meta.url,()=>corpusCommand(TYPESCRIPT,process.argv.slice(2),process.env,ROOT));
