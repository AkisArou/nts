// Syntax adapters produce these same rows for module code and other readers.
// A data directory is an explicit input, separate from module-owned bytes.
export type InputKind='module'|'data'|'accepted-revision'|'inspection'|'conservative'|'file'|'optional-file'|'optional-module'|'membership'|'directory-candidates'|'project-config'|'project-choice'|'project-catalogue'|'project-members'|'generated-project'|'fixture'|'members'|'installation-inputs'|'cargo-inputs'|'dependency-source-inputs'|'installation-status-inputs';
/** Source suffixes the module visitor parses as executable code. Imported
 * JSON remains immutable input data, with no executable producer role. */
export const executableModuleSource=(path:string)=>/\.[cm]?[jt]sx?$/.test(path);
export const READER_PROTOCOLS=['project','node26','filesystem'] as const;
export type ReaderProtocol=typeof READER_PROTOCOLS[number];
export type DirectoryCandidate={name:string;kind:'optional-file'|'path-exists'|'file-exists'|'directory-exists'};
export type GeneratedInclude='directory'|'typescript-tree';
export type DataNamespaces=Readonly<Record<string,string>>;
export type ReaderInput={path:string;kind:InputKind;dataNamespaces?:DataNamespaces;member?:string;data?:true;directory?:string;prefix?:string;alternatives?:readonly string[];optional?:true;include?:GeneratedInclude;candidates?:readonly DirectoryCandidate[]};
export type ModuleDeclarations={imports:string[];assets:ReaderInput[]};
export type DirectoryDeclaration={reader:string;directory:string;files:readonly string[];kind:'module'|'data'|'inspection'|'conservative';context?:ReaderContext;
  member?:string;
  /** Private fixture reach records the declaration without claiming its production members. */
  fixture?:{entry:string;owner:string}};
export type ReaderContext={entry:string;dataNamespaces:DataNamespaces};
export type OptionalFileDeclaration={reader:string;path:string;present:boolean;context:ReaderContext;inspectionOnly?:true;observationOnly?:true};
/** A superset race guard accounts for runtime reads without making unrelated
 * candidates dependencies of a committed, clean tree's result. */
export const selectionInput=(row:{observationOnly?:true})=>row.observationOnly!==true;
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

declare const CONSERVATIVE_DIRECTORY:unique symbol;
export type ConservativeDirectory=URL&{readonly [CONSERVATIVE_DIRECTORY]:true};
/** An explicitly wide dependency for a reader not yet modelled precisely.
 * Every current byte is immutable; the namespace grants no execution role or
 * private substitution, and remains visible as conservative in the census. */
export function conservativeDirectory(url:URL):ConservativeDirectory{return url as ConservativeDirectory;}

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

export type ProjectConfig={readonly kind:'project-config';readonly url:URL};
export type ProjectChoice={readonly kind:'project-choice';readonly url:URL;readonly alternatives:readonly string[]};
export type ProjectCatalogue={readonly kind:'project-catalogue';readonly url:URL;readonly directory:string};
export type ProjectMembers={readonly kind:'project-members';readonly url:URL;readonly prefix:string;readonly optional?:true};
export type GeneratedProject={readonly kind:'generated-project';readonly url:URL;readonly directory:string;readonly include:GeneratedInclude};
export type DirectoryCandidates={readonly kind:'directory-candidates';readonly url:URL;readonly candidates:readonly DirectoryCandidate[]};
export type OptionalModule={readonly kind:'optional-module';readonly url:URL};
export type FixtureInput={readonly kind:'fixture';readonly url:URL;readonly dataNamespaces:DataNamespaces};
export type ModuleMembers={readonly kind:'members';readonly url:URL;readonly member:string;readonly data?:true};
export type FileEntry={readonly kind:'file';readonly url:FileInput};
export type InstallationInputs={readonly kind:'installation-inputs';readonly url:URL};
export type CargoInputs={readonly kind:'cargo-inputs';readonly url:URL};
export type DependencySourceInputs={readonly kind:'dependency-source-inputs';readonly url:URL};
export type InstallationStatusInputs={readonly kind:'installation-status-inputs';readonly url:URL};
export type InputEntry=string|ProjectConfig|ProjectChoice|ProjectCatalogue|ProjectMembers|GeneratedProject|DirectoryCandidates|OptionalModule|FixtureInput|ModuleMembers|FileEntry|InstallationInputs|CargoInputs|DependencySourceInputs|InstallationStatusInputs;
/** These populations come from their existing installation and Cargo owners.
 * The URL names the repository, never an installation discovery route. */
export function installationInputs(url:URL):InstallationInputs{return {kind:'installation-inputs',url};}
export function cargoInputs(url:URL):CargoInputs{return {kind:'cargo-inputs',url};}
/** The pre-install candidate superset is a race-guard observation. Actual
 * recipe members acquire selection through their module/data roles. Neither
 * fence descriptor supplies executable placement. */
export function dependencySourceInputs(url:URL):DependencySourceInputs{return {kind:'dependency-source-inputs',url};}
export function installationStatusInputs(url:URL):InstallationStatusInputs{return {kind:'installation-status-inputs',url};}
/** A chooser may execute this exact optional entry. Absence stays structural;
 * presence enters its real closure under the enclosing host/context role. */
export function optionalModule(url:URL):OptionalModule{return {kind:'optional-module',url};}
/** Shallow enumeration selects followed directories. Each literal child
 * candidate retains its own byte or metadata role, never module placement. */
export function directoryCandidates(url:URL,candidates:readonly DirectoryCandidate[]):DirectoryCandidates{
  if(!Array.isArray(candidates))throw Error('directoryCandidates needs literal candidates');
  const seen=new Set<string>();
  const rows=candidates.map(row=>{
    if(!row||Object.keys(row).length!==2||!Object.hasOwn(row,'name')||!Object.hasOwn(row,'kind')
      ||typeof row.name!=='string'||!canonicalNamespace(row.name)||row.name.includes('/')||/[*?\[\]]/.test(row.name)
      ||!['optional-file','path-exists','file-exists','directory-exists'].includes(row.kind))throw Error('invalid directory candidate');
    const key=JSON.stringify([row.name,row.kind]);if(seen.has(key))throw Error('duplicate directory candidate: '+row.name);seen.add(key);
    return {name:row.name,kind:row.kind};
  });
  return {kind:'directory-candidates',url,candidates:rows};
}
/** A compiler command that names its config selects that file directly. */
export function projectConfig(url:URL):ProjectConfig{return {kind:'project-config',url};}
/** A chooser first honors case/tsconfig.json; otherwise this exact extends
 * and include recipe is parsed at an owned private ConfigDir. */
export function generatedProject(url:URL,directory:string,include:GeneratedInclude):GeneratedProject{
  if(include!=='directory'&&include!=='typescript-tree')throw Error('unsupported generated project include recipe');
  return {kind:'generated-project',url,directory:relativeProjectInput(directory),include};
}
/** Five-column TSV catalogues name a project directory in their first field.
 * The directory is relative to the catalogue URL; selected configs keep the
 * ordinary compiled-project contract rather than host-module ownership. */
export function relativeProjectInput(value:unknown):string{
  if(typeof value!=='string'||!value||/^(?:\/|[a-z][a-z0-9+.-]*:)/i.test(value)||/[\\\x00-\x1f?#]/.test(value))
    throw Error('project selection must be a literal relative input');
  return value;
}
export function projectCatalogue(url:URL,directory:string):ProjectCatalogue{
  return {kind:'project-catalogue',url,directory:relativeProjectInput(directory)};
}
/** Candidates are ordered. Only checked absence facts and the first present
 * project's actual closure are inputs; later candidates are not inspected. */
export function projectChoice(url:URL,alternatives:readonly string[]):ProjectChoice{
  if(!Array.isArray(alternatives))throw Error('project alternatives must be a literal array');
  return {kind:'project-choice',url,alternatives:alternatives.map(relativeProjectInput)};
}
/** An actual shallow enumerator selects names by one literal prefix. The
 * directory membership remains distinct from each selected compiler project. */
export function projectMemberPrefix(value:unknown):string{
  return value===''?'':moduleMemberName(value);
}
export function projectMembers(url:URL,prefix:string,options?:{optional:true}):ProjectMembers{
  if(options&&options.optional!==true)throw Error('project member optional mode must be explicit');
  return {kind:'project-members',url,prefix:projectMemberPrefix(prefix),...(options?{optional:true}:{})};
}

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
