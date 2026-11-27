import {randomUUID} from 'node:crypto';
import {createConnection,createServer,type Socket} from 'node:net';
import {isCommandExit} from '../differential/command-entry/main.ts';
import {ToolingInstrumentError} from './step-result.ts';
import {assignOwnedValues} from './environment-values.ts';

export const STEP_PHASE_CHANNEL = 'NTS_GATE_STEP_PHASE';
const MAX_REQUEST = 256;

/** One gate-run listener. Each dispatch gets a capability which dies with it. */
export class StepPhaseChannel {
  private readonly address = '\0nts-gate-phase-' + randomUUID();
  private readonly peers = new Set<Socket>();
  private readonly requests = new Map<string, (phase: string) => Promise<void>>();
  private readonly server = createServer({allowHalfOpen:true}, socket => this.accept(socket));
  readonly ready = new Promise<void>((resolve, reject) => {
    this.server.on('error', reject);
    this.server.listen(this.address, () => { this.server.unref(); resolve(); });
  });

  dispatch(enter: (phase: string) => Promise<void>) {
    const key = randomUUID();
    this.requests.set(key, enter);
    return { handoff: JSON.stringify({address:this.address,key}), revoke: () => { this.requests.delete(key); } };
  }

  private accept(socket: Socket) {
    this.peers.add(socket);
    socket.once('close', () => this.peers.delete(socket));
    socket.on('error', () => socket.destroy());
    let request = '';
    socket.setEncoding('utf8').on('data', (part: string) => {
      request += part;
      if (request.length > MAX_REQUEST) socket.destroy();
    });
    socket.once('end', () => {
      const [key, phase, rest] = request.split(' ');
      const enter = rest === undefined && key ? this.requests.get(key) : undefined;
      if (!enter || !phase) { socket.end('invalid phase request'); return; }
      void enter(phase).then(() => socket.end('ok'), error => {
        if (isCommandExit(error)) throw error;
        socket.end('phase transition failed: ' + String(error));
      });
    });
  }

  async close() {
    this.requests.clear();
    for (const socket of this.peers) socket.destroy();
    if (this.server.listening) await new Promise<void>(resolve => this.server.close(() => resolve()));
  }
}

/** Consume the dispatch capability before starting any descendants. */
export function stepPhaseClient(env = process.env): (phase: string) => Promise<void> {
  const handoff = env[STEP_PHASE_CHANNEL];
  if (handoff) assignOwnedValues(env, {[STEP_PHASE_CHANNEL]:undefined});
  return async phase => { if (handoff) await enterStepPhase(phase, handoff); };
}

/** A phase may begin once its runner acknowledges the admission and bounds. */
async function enterStepPhase(phase: string, handoff: string): Promise<void> {
  try {
    const {address,key} = JSON.parse(handoff) as {address:string;key:string};
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection(address, () => socket.end(key + ' ' + phase));
      let reply = '';
      socket.setEncoding('utf8').on('data', (part: string) => { reply += part; });
      socket.once('error', reject);
      socket.once('close', () => reply === 'ok' ? resolve() : reject(Error(reply || 'runner closed the phase channel')));
    });
  } catch (error) {
    if (isCommandExit(error)) throw error;
    throw new ToolingInstrumentError('tooling-setup', `enter memory phase ${phase}: ${String(error)}`, {cause:error});
  }
}
