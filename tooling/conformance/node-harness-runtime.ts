// Prepared runners use the authenticated generated runtime. The direct probe
// tools use the same source with the pinned Node's strip-only module loader.
import {pathToFileURL} from 'node:url';

const source=new URL('../differential/oracle-node-harness.ts',import.meta.url);
const manifest=process.env.NTS_ORACLE_EMIT_MANIFEST;
export const oracleLoader=manifest
  ? await import(new URL('./assets/oracle-loader.ts',pathToFileURL(manifest)))
  : null;
export const nodeHarnessRuntime=oracleLoader
  ? oracleLoader.oracleNodeHarness
  : await import(source.href);
if(!nodeHarnessRuntime)throw Error('oracle node harness runtime is unavailable from the sealed loader');
