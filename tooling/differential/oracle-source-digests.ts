// Apply and landing replay hold oracle shards to this same source identity.
import {digestSources,type SourceRevision} from '../records/recorder-core.ts';
import {GENERATOR} from './oracle-record-paths.ts';

export function oracleSourceDigests(root:string,names:readonly string[],revision?:SourceRevision):Map<string,string|null>{
 return digestSources(root,names.map(name=>({name,paths:[name,GENERATOR],except:null})),revision);
}
