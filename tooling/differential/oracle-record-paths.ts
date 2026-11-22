// Pure record names: transport and identity readers need no corpus inventory.
import {posix} from 'node:path';

export const RECORDS = 'results/oracle-counts';
export const GENERATOR = `${RECORDS}/_generator.json`;

export function recordPath(fixture:string):string {
  if (!/^(?:tests\/programs|benchmarks\/cases)\/[^/]+$/.test(fixture)
    || /[\x00-\x1f\x7f\\]/.test(fixture) || posix.normalize(fixture) !== fixture) {
    throw new Error(`oracle records: invalid fixture ${JSON.stringify(fixture)}`);
  }
  return `${RECORDS}/${fixture}.json`;
}
