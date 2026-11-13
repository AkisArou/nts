// Syntax adapters produce these same rows for module code and other readers.
// A data directory is an explicit input, separate from module-owned bytes.
export type InputKind='module'|'data'|'inspection'|'file'|'optional-file'|'membership'|'project'|'project-config'|'fixture'|'members';
export type DataNamespaces=Readonly<Record<string,string>>;
export type ReaderInput={path:string;kind:InputKind;dataNamespaces?:DataNamespaces;member?:string;data?:true};
export type ModuleDeclarations={imports:string[];assets:ReaderInput[]};
export type DirectoryDeclaration={reader:string;directory:string;files:readonly string[];kind:'module'|'data'|'inspection';
  member?:string;
  /** Private fixture reach records the declaration without claiming its production members. */
  fixture?:{entry:string;owner:string}};
export type ReaderContext={entry:string;dataNamespaces:DataNamespaces};
export type OptionalFileDeclaration={reader:string;path:string;present:boolean;context:ReaderContext};
export type MemberType='file'|'directory'|'symlink';
export type DirectoryEntry={name:string;type:MemberType};
export type MembershipDeclaration={reader:string;directory:string;entries:DirectoryEntry[];context:ReaderContext};

declare const DATA_DIRECTORY:unique symbol;
export type DataDirectory=URL&{readonly [DATA_DIRECTORY]:true};
/** A pure identity brand. The graph recognizes calls to this owner through
 * lexical bindings; the caller uses the same URL to read its production data. */
export function dataDirectory(url:URL):DataDirectory{return url as DataDirectory;}

declare const INSPECTION_DIRECTORY:unique symbol;
export type InspectionDirectory=URL&{readonly [INSPECTION_DIRECTORY]:true};
/** Immutable bytes inspected by a guard. Reading a population does not place
 * its members under that guard's execution or validation authority. */
export function inspectionDirectory(url:URL):InspectionDirectory{return url as InspectionDirectory;}

declare const FILE_INPUT:unique symbol;
export type FileInput=URL&{readonly [FILE_INPUT]:true};
/** Immutable bytes read as text or data, without entering their imports or
 * launches. A file input never grants a substitutable data namespace. */
export function fileInput(url:URL):FileInput{return url as FileInput;}

declare const OPTIONAL_FILE:unique symbol;
export type OptionalFile=URL&{readonly [OPTIONAL_FILE]:true};
/** An exact candidate owns immutable bytes when present and absence otherwise.
 * It never supplies executable placement or a substitutable data namespace. */
export function optionalFile(url:URL):OptionalFile{return url as OptionalFile;}

declare const DIRECTORY_MEMBERSHIP:unique symbol;
export type DirectoryMembership=URL&{readonly [DIRECTORY_MEMBERSHIP]:true};
/** Only immediate child names and types, including untracked children. This
 * declares no child bytes, executable placement or private data grant. */
export function directoryMembership(url:URL):DirectoryMembership{return url as DirectoryMembership;}

export type ProjectInput={readonly kind:'project';readonly url:URL};
export type ProjectConfig={readonly kind:'project-config';readonly url:URL};
export type FixtureInput={readonly kind:'fixture';readonly url:URL;readonly dataNamespaces:DataNamespaces};
export type ModuleMembers={readonly kind:'members';readonly url:URL;readonly member:string;readonly data?:true};
export type InputEntry=string|ProjectInput|ProjectConfig|FixtureInput|ModuleMembers;
/** A compiled entry carries its owning-project request through runtime staging
 * as well as the parsed reader declaration. It never guesses a config path. */
export function projectInput(url:URL):ProjectInput{return {kind:'project',url};}
/** A compiler command that names its config selects that file directly. */
export function projectConfig(url:URL):ProjectConfig{return {kind:'project-config',url};}

export const canonicalNamespace=(name:string)=>name.length>0&&!name.startsWith('/')&&!/[\\\x00-\x1f]/.test(name)
  &&name.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');

/** Namespace keys are repository-relative identities, never replacement paths. */
export function fixtureNamespaces(value:DataNamespaces):DataNamespaces{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('fixture data namespaces must be an owner map');
  const result:Record<string,string>={};
  for(const [directory,owner]of Object.entries(value)){
    if(!canonicalNamespace(directory))throw Error('fixture data namespace is not canonical: '+directory);
    if(typeof owner!=='string'||!owner.trim())throw Error('fixture data namespace has no fixture owner: '+directory);
    for(const other of Object.keys(result))if(directory.startsWith(other+'/')||other.startsWith(directory+'/'))
      throw Error('overlapping fixture data namespaces: '+directory+' and '+other);
    Object.defineProperty(result,directory,{value:owner,enumerable:true});
  }
  return Object.freeze(result);
}

/** The selector and copier consume the same entry and the same private data
 * grants. Source modules remain immutable production inputs in either context. */
export function fixtureInput(url:URL,options:{dataNamespaces:DataNamespaces}):FixtureInput{
  return {kind:'fixture',url,dataNamespaces:fixtureNamespaces(options.dataNamespaces)};
}

export function moduleMemberName(value:unknown):string{
  if(typeof value!=='string'||!canonicalNamespace(value)||value.includes('/')||!moduleMemberDirectory(value)||/[*?\[\]]/.test(value))
    throw Error('module member must be a literal basename: '+String(value));
  return value;
}
/** Discovery excludes hidden paths and installed dependencies in both forms. */
export const moduleMemberDirectory=(name:string)=>name!==''&&name!=='node_modules'&&!name.startsWith('.');
export function matchesModuleMember(path:string,member:string):boolean{
  const parts=path.split('/');return parts.at(-1)===member&&parts.every(moduleMemberDirectory);
}
/** Recursively discovered modules have one literal basename, consumed by the
 * runtime walker as well as tracked snapshots and added/deleted path matching. */
export function moduleMembers(url:URL,member:string,options?:{data:true}):ModuleMembers{
  if(options&&options.data!==true)throw Error('module member data role must be explicit');
  return {kind:'members',url,member:moduleMemberName(member),...(options?{data:true}:{})};
}
