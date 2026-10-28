import { MessageChannel, receiveMessageOnPort, Worker } from "node:worker_threads";
import type { KeyObject } from "node:crypto";
import type { CryptoCshakeParameters, CryptoFailure, CryptoKmacParameters } from "../src/provider/crypto.ts";

export interface NativeModernCryptoRequest {
  readonly parameters: CryptoCshakeParameters | CryptoKmacParameters;
  readonly data: Uint8Array;
  readonly key?: KeyObject;
  readonly signature?: Uint8Array;
}

type NativeModernCryptoResult = ArrayBuffer | boolean | CryptoFailure;

class NativeModernCryptoWorker {
  readonly worker: Worker;
  readonly port: MessageChannel["port1"];
  readonly signal: Int32Array;
  failed = false;

  constructor() {
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.signal = new Int32Array(new SharedArrayBuffer(4));
    // Node exposes these native jobs only to its internal test modules. Expose
    // them in this one test worker, not to the package or the WPT VM globals.
    this.worker = new Worker(new URL("./node-crypto-modern-worker.ts", import.meta.url), {
      execArgv: ["--expose-internals"],
      workerData: { port: channel.port2, signal: this.signal },
      transferList: [channel.port2],
    });
    this.worker.on("error", () => { this.failed = true; });
    this.worker.on("exit", () => { this.failed = true; });
    this.worker.unref();
    this.port.unref();
  }

  run(request: NativeModernCryptoRequest): NativeModernCryptoResult {
    if (this.failed) return { failure: "operation" };
    Atomics.store(this.signal, 0, 0);
    this.port.postMessage(request);
    // A watchdog only: completion is the native worker's notification, never a
    // correctness assertion about machine speed. A failed worker cannot hang a
    // standalone census indefinitely while its event-loop callbacks are blocked.
    if (Atomics.wait(this.signal, 0, 0, 60_000) === "timed-out") {
      this.failed = true;
      void this.worker.terminate();
      this.port.close();
      return { failure: "operation" };
    }
    const response: unknown = receiveMessageOnPort(this.port)?.message;
    if (response instanceof ArrayBuffer || typeof response === "boolean") return response;
    return { failure: "operation" };
  }
}

let nativeWorker: NativeModernCryptoWorker | undefined;

/** Whole-input synchronous bridge to Node 24.20 native jobs, without WebCrypto. */
export function runNativeModernCrypto(request: NativeModernCryptoRequest): NativeModernCryptoResult {
  try {
    nativeWorker ??= new NativeModernCryptoWorker();
    return nativeWorker.run(request);
  } catch {
    return { failure: "operation" };
  }
}
