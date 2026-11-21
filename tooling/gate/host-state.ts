// An instrument fault whose evidence is the machine's own state: an
// unreachable user manager, a manager call ended by a signal, a cgroup the
// kernel did not realize. ToolingInstrumentError is also tooling's protocol
// and validation result; only this marker says the code under test is not
// what failed, so only it may hold a landing from inside a test.
import {ToolingInstrumentError} from './step-result.ts';

export class HostStateError extends ToolingInstrumentError{
  declare readonly kind:'tooling-setup'|'tooling-cleanup';
  constructor(kind:'tooling-setup'|'tooling-cleanup',reason:string,options?:ErrorOptions){super(kind,reason,options);this.name='HostStateError';}
}
