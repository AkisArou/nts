// The JDK a tree declares (runtime/jvm/jdk.txt), found among the installed
// ones by the identity its own `release` file states. The canonical
// environment gives every gate, inner run and landing that JDK whatever
// JAVA_HOME the launcher exports, so runtime/jvm/build.sh, which refuses any
// other JDK by name, rebuilds the committed jar byte for byte in any shell.
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {userInfo} from 'node:os';
import {join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fileInput} from './reader-inputs/main.ts';
import {ToolingInstrumentError} from './step-result.ts';

const ROOT=resolve(import.meta.dirname,'../..');
const DECLARATION=fileInput(new URL('../../runtime/jvm/jdk.txt',import.meta.url));
const FIELDS=['IMPLEMENTOR','JAVA_RUNTIME_VERSION'] as const;

/** The declared identity: exactly these two `release` lines, verbatim. */
export type JdkIdentity={readonly lines:readonly string[];readonly name:string};
/** What a canonical environment chose, for its report. `home` is the JDK it
 * runs; `declared` says whether that is the tree's declared JDK. */
export type JdkChoice={readonly identity:string;readonly home:string|null;readonly declared:boolean};

/** The tree's declaration, or undefined for a tree that declares none. */
export function declaredJdk(root=ROOT):JdkIdentity|undefined {
  const path=join(root,relative(ROOT,fileURLToPath(DECLARATION)));
  if(!existsSync(path))return undefined;
  const lines=readFileSync(path,'utf8').split('\n').filter(line=>line.trim()!==''&&!line.startsWith('#'));
  const values=new Map<string,string>();
  for(const line of lines){
    const match=/^([A-Z_]+)="([^"]+)"$/.exec(line);
    if(!match||!(FIELDS as readonly string[]).includes(match[1]!)||values.has(match[1]!))
      throw new ToolingInstrumentError('tooling-setup',`${path}: expected one line each of ${FIELDS.join(' and ')} as a JDK release file writes them, found ${JSON.stringify(line)}`);
    values.set(match[1]!,match[2]!);
  }
  if(values.size!==FIELDS.length)throw new ToolingInstrumentError('tooling-setup',`${path}: declares ${[...values.keys()].join(', ')||'nothing'}; it must name ${FIELDS.join(' and ')}`);
  return {lines,name:FIELDS.map(field=>values.get(field)).join(' ')};
}

/** Where JDKs are installed on this machine: asdf's, then the system's. */
export function jdkInstallations():string[] {
  return [join(userInfo().homedir,'.asdf/installs/java'),'/usr/lib/jvm'];
}

/** A home is the declared JDK when its release file has every declared line
 * exactly and it carries the tools the jar is built with. */
export function isDeclaredJdk(home:string,identity:JdkIdentity):boolean {
  const release=join(home,'release');
  if(!existsSync(release)||!['javac','jar'].every(tool=>existsSync(join(home,'bin',tool))))return false;
  const have=new Set(readFileSync(release,'utf8').split('\n'));
  return identity.lines.every(line=>have.has(line));
}

/** The launcher's own JDK when it is the declared one (so a launcher that
 * already exports it keeps its exact path), else the first match among the
 * installations in name order, else none. */
export function resolveJdk(identity:JdkIdentity,launcher:NodeJS.ProcessEnv,installations=jdkInstallations()):string|undefined {
  const children=(directory:string)=>{
    try{return readdirSync(directory).sort().map(name=>join(directory,name)).filter(path=>statSync(path).isDirectory());}
    catch{return [];}
  };
  const candidates=[launcher.JAVA_HOME,launcher.JDK_HOME].filter((home):home is string=>Boolean(home));
  for(const directory of installations)candidates.push(...children(directory));
  return candidates.find(home=>isDeclaredJdk(home,identity));
}

/** Points JAVA_HOME and JDK_HOME in `host` at the declared JDK. With none
 * installed, the launcher's values stay, and build.sh names the mismatch. */
export function chooseJdk(host:NodeJS.ProcessEnv,launcher:NodeJS.ProcessEnv,root:string,installations?:string[]):JdkChoice|undefined {
  const identity=declaredJdk(root);
  if(!identity)return undefined;
  const home=resolveJdk(identity,launcher,installations);
  if(home){host.JAVA_HOME=home;host.JDK_HOME=home;}
  return {identity:identity.name,home:home??host.JAVA_HOME??null,declared:home!==undefined};
}
