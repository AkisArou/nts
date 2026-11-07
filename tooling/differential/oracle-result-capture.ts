// Original observations behind a completed answer, independent of its corpus.
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {readFileSync} from 'node:fs';
import {OracleFilesystem,readOracleSnapshotIndex,type HostObservation} from './oracle-filesystem.ts';
import type {OraclePrepared,OracleRuntimeDescriptor} from './oracle-emit.ts';
import type {NodeResolutionSession,OracleManifest} from './oracle-runtime.ts';
import {resultHash} from './oracle-results.ts';
import {ToolingInstrumentError} from '../gate/step-result.ts';
export type ProgramCapture={observations:HostObservation[];dependencyObservations?:HostObservation[];session:NodeResolutionSession};
/** A cached result must also notice live package changes. Reuse the finite,
 * hash-bound installed-image catalog, rather than inventing a package walker.
 * Most TypeScript cases use no live packages and need no such observations. */
export function captureOracleDependencies(dependency:NonNullable<OracleRuntimeDescriptor['dependencies']>):HostObservation[]{
  const fs=new OracleFilesystem(),file=join(dirname(dependency.root),'semantic.json'),bytes=fs.readBytes(file);
  if(!bytes||resultHash(bytes)!==dependency.semanticSha256)throw new ToolingInstrumentError('tooling-setup','TypeScript oracle dependency catalog changed');
  const semantic=JSON.parse(bytes.toString('utf8')) as {packages:{path:string;kind:'file'|'link'|'directory';sha256?:string;target?:string}[]};
  if(!Array.isArray(semantic.packages))throw new ToolingInstrumentError('tooling-setup','TypeScript oracle dependency catalog is invalid');
  const directories=new Set<string>([dependency.root]);
  for(const item of semantic.packages){
    const path=resolve(dependency.root,item.path),part=relative(dependency.root,path);
    if(isAbsolute(item.path)||part==='..'||part.startsWith('..'+sep))throw new ToolingInstrumentError('tooling-setup','TypeScript oracle dependency escapes its catalog');
    if(part!==''){
      directories.add(dirname(path));
    }
    const kind=item.kind==='link'?'symlink':item.kind;
    if(fs.runtimeKind(path)!==kind)throw new ToolingInstrumentError('tooling-setup','TypeScript oracle dependency kind changed: '+path);
    if(item.kind==='file'){
      const value=fs.readBytes(path);if(!value||resultHash(value)!==item.sha256)throw new ToolingInstrumentError('tooling-setup','TypeScript oracle dependency bytes changed: '+path);
    }else if(item.kind==='link'){
      if(fs.readlink(path)!==item.target)throw new ToolingInstrumentError('tooling-setup','TypeScript oracle dependency link changed: '+path);
    }else directories.add(path);
  }
  // The catalog deliberately omits installer artifacts. Capture actual
  // listings too, without granting those extra names a runtime domain: the
  // completed execution already used the producer's finite query authority.
  // A later addition/removal still invalidates reuse through this adapter.
  for(const path of directories)fs.runtimeEntries(path);
  return fs.captured();
}

/** Called after the execution and parent finalizer, before snapshot cleanup. */
export function captureProgramOracle(prepared:OraclePrepared):ProgramCapture{
  const stored=JSON.parse(readFileSync(prepared.manifest,'utf8')) as OracleManifest;
  if(!stored.runtimeIndex||!Array.isArray(stored.observations))throw new ToolingInstrumentError('tooling-setup','TypeScript oracle has no captured input proof');
  const descriptor=readOracleSnapshotIndex(dirname(prepared.manifest),stored.runtimeIndex).get('descriptor') as OracleRuntimeDescriptor;
  if(!descriptor.resolution)throw new ToolingInstrumentError('tooling-setup','TypeScript oracle has no Node identity');
  return {observations:stored.observations,session:descriptor.resolution,
    ...(descriptor.dependencies?{dependencyObservations:captureOracleDependencies(descriptor.dependencies)}:{})};
}
