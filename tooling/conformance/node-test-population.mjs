import {relative,resolve,sep} from 'node:path';

// Node test/known_issues/testcfg.py sets context.expect_fail = 1. Those
// diagnostic files assert behaviour Node does not provide; neither an nts
// pass nor a failure (which an empty module also produces) certifies a port.
// Node tools/test.py:1601-1624 also excludes internet from default suites:
// its outcomes require network conditions outside the implementation.
const diagnosticSuites=new Set(['known_issues','internet']);
export function positiveNodeTests(testRoot,tests) {
  const root=resolve(testRoot);
  return tests.filter(test=>!diagnosticSuites.has(relative(root,resolve(test.path)).split(sep)[0]));
}
