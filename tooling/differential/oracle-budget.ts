// A recorded oracle budget is data; decoding it acquires no execution service.
import {CaseBudgetError} from '../gate/step-result.ts';
import type {OracleBudget} from './oracle-runtime.ts';
export class OracleBudgetError extends CaseBudgetError{
  readonly budget:OracleBudget;
  constructor(budget:OracleBudget){super(budget.reason);this.name='OracleBudgetError';this.budget=budget;}
}
