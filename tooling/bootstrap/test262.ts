// Rust and bootstrap share one plain data pin for the complete ECMAScript suite.
import {fileURLToPath} from 'node:url';
import {fileInput} from '../gate/reader-inputs/main.ts';
import type {Corpus} from '../inputs/corpus.ts';
import {corpusCommand} from '../inputs/corpus-command.ts';
import {runAsCommand} from '../differential/command-entry/main.ts';
export const TEST262:Corpus={pinSource:fileInput(new URL('./test262.pin',import.meta.url)),
  upstream:'https://github.com/tc39/test262.git',sparse:[],slot:'test262'};
runAsCommand(import.meta.url,()=>corpusCommand(TEST262,process.argv.slice(2),process.env,fileURLToPath(new URL('../../',import.meta.url))));
