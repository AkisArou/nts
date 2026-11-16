// Test infrastructure only: a synthetic source whose declared Program reaches
// one pnpm-linked package, with its finite installation catalog published
// beside the source rather than in the shared dependency cache.
import {mkdirSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import type {TestContext} from 'node:test';
import {testScratch} from './test-scratch.ts';
import {durableRecord} from './durable-record.ts';
import {installationCatalog,dependencyHash,type DependencyCatalogTrust} from '../inputs/dependency-catalog.ts';
import type {Identity} from '../inputs/dependency-identity.ts';

export const INSTALLED_PACKAGE_PATH='node_modules/.pnpm/fixture-package@1.0.0/node_modules/fixture-package';

/** `tsconfig.json` compiles `main.ts`, which imports `fixture-package@1.0.0`.
 * Files written through `put` after this returns are outside the catalog's
 * pins; only package.json, pnpm-lock.yaml and recipe.ts authenticate it. */
export function installedCatalogFixture(t:TestContext):{root:string;packagePath:string;trust:DependencyCatalogTrust;put:(path:string,text:string)=>void}{
  const scratch=testScratch(t,'project-installed-catalog'),root=join(scratch,'source');
  const put=(path:string,text:string)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);};
  put('package.json','{"name":"catalog-control","private":true}');put('pnpm-lock.yaml','supplied lock input\n');put('recipe.ts','// supplied producer input\n');
  put('tsconfig.json','{"compilerOptions":{"module":"preserve","moduleResolution":"bundler","types":[]},"files":["main.ts"]}');
  put('main.ts',"import type {Value} from 'fixture-package';export const value:Value=1;");
  put(INSTALLED_PACKAGE_PATH+'/package.json','{"name":"fixture-package","version":"1.0.0","types":"index.d.ts"}');
  put(INSTALLED_PACKAGE_PATH+'/index.d.ts','export type Value=number;');
  symlinkSync('.pnpm/fixture-package@1.0.0/node_modules/fixture-package',join(root,'node_modules/fixture-package'));
  const input={version:2 as const,pnpm:'10.15.0',manager:'supplied manager',node:process.versions.node,platform:process.platform,arch:process.arch,
    inputs:['package.json','pnpm-lock.yaml'].map(path=>({path,sha256:dependencyHash(readFileSync(join(root,path)))})),importers:['.']};
  const identity:Identity={...input,key:dependencyHash(JSON.stringify(input))};
  // The supplied install identity is separate from the actual finite inventory
  // algorithm under test; the verified install/publication has its own controls.
  const catalog=installationCatalog(root,identity,[{path:'recipe.ts',sha256:dependencyHash(readFileSync(join(root,'recipe.ts')))}]);
  const path=join(scratch,'catalog.json');durableRecord(path,catalog);
  return {root,packagePath:INSTALLED_PACKAGE_PATH,put,trust:{catalogPath:path,catalogSha256:dependencyHash(readFileSync(path))}};
}
