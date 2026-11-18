// The fixture copier owns these private declarations at scope creation and
// process entry. Acquisition in the product still supplies provenance only.
export function fixedMembersSource(name:string,source:string):string{
  if(name==='tooling/gate/scopes/step-scope.ts'){
    if(source.includes('declareFixedMembers(env,this.group,[])'))return source;
    const seam='this.group = startBoundSlice(this.slice, owner, { rank });';
    if(!source.includes(seam))throw Error('fixed gate membership fixture lost its scope-creation seam');
    return "import {declareFixedMembers,declareOwnMembers} from '../test-cgroup-members.ts';\n"+
      source.replace(seam,seam+'\n    declareFixedMembers(env,this.group,[]);\n    declareOwnMembers(env,[process.pid]);');
  }
  if(name==='tooling/gate/test-host-bootstrap.ts'){
    if(source.includes('declareOwnMembers(environment,[process.pid])'))return source;
    const seam='const environment=poisonedTestEnvironment();';
    if(!source.includes(seam))throw Error('fixed membership fixture lost its scope-entry seam');
    return "import {declareOwnMembers} from './test-cgroup-members.ts';\n"+
      source.replace(seam,seam+'\n  declareOwnMembers(environment,[process.pid]);');
  }
  return source;
}
