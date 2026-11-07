// Runtime and preparation use the same finite harness path authority.
import {join} from 'node:path';

export function nodeHarnessPaths(root:string,moduleName=''){
  const nodeTestRoot=join(root,'third_party/node/test');
  return {nodeTestRoot,fixtures:join(nodeTestRoot,'fixtures'),localTestRoot:join(root,'runtime/node',moduleName,'test')};
}
