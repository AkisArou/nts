// Test-only assembly for unchanged Compression Streams WPT. The local HTTP peer
// serves verified original media; the client's Fetch and stream classes are nts's.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHostNodeWebPlatform } from "../../../host/node-runtime.ts";
import {
  Blob, CompressionStream, DecompressionStream, DOMException,
  ReadableStream, TextDecoder, TextEncoder, TransformStream, WritableStream,
} from "../../../src/index.ts";
import type { CompressionContext, CompressionFailure, CompressionFormat } from "../../../src/provider.ts";
import { NodeCompressionProvider } from "../../node-compression-provider.ts";
import type { WptEnvironment } from "../runner.ts";
import { readWptVersions, verifiedWptSource } from "../versions.ts";

// The ESNext-only package config omits DOM's declaration for this actual Node
// ECMAScript global. The fixture, rather than this assembly, uses its Memory API.
declare const WebAssembly: unknown;

const root = new URL("../", import.meta.url);
const mediaTypes: Readonly<Record<string, string>> = {
  "media/foo.vtt": "text/vtt",
  "media/test-av-384k-44100Hz-1ch-320x240-30fps-10kfr.webm": "video/webm",
};

export interface CompressionResourceServer {
  readonly origin: string;
  readonly requested: ReadonlySet<string>;
  close(): Promise<void>;
}

/** A real HTTP peer for the corpus's two media requests; no fetch stand-in. */
export async function startCompressionResourceServer(): Promise<CompressionResourceServer> {
  const versions = readWptVersions(root);
  const resources = new Map<string, Buffer>();
  for (const path of Object.keys(mediaTypes)) resources.set(path, verifiedWptSource(root, path, versions));
  const requested = new Set<string>();
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1/").pathname.slice(1);
    const bytes = resources.get(path);
    if (request.method !== "GET" || bytes === undefined) {
      response.writeHead(404).end();
      return;
    }
    requested.add(path);
    response.writeHead(200, {
      "Content-Type": mediaTypes[path]!,
      "Content-Length": bytes.byteLength,
    }).end(bytes);
  });
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error): void => { server.off("listening", ready); reject(error); };
    const ready = (): void => { server.off("error", failed); resolve(); };
    server.once("error", failed);
    server.once("listening", ready);
    server.listen(0, "127.0.0.1");
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requested,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error !== undefined) reject(error); else resolve(); });
      server.closeAllConnections();
    }),
  };
}

/** WPT sometimes leaves a stream open after its first read; end its native lifetime. */
class FixtureCompressionProvider extends NodeCompressionProvider {
  private readonly contexts: CompressionContext[] = [];

  override createCompressor(format: CompressionFormat, bits: number): CompressionContext | CompressionFailure {
    return this.retain(super.createCompressor(format, bits));
  }

  override createDecompressor(format: CompressionFormat, bits: number): CompressionContext | CompressionFailure {
    return this.retain(super.createDecompressor(format, bits));
  }

  private retain(result: CompressionContext | CompressionFailure): CompressionContext | CompressionFailure {
    if (!("failure" in result)) this.contexts.push(result);
    return result;
  }

  close(): void {
    for (const context of this.contexts) context.close();
    this.contexts.length = 0;
  }
}

export function createCompressionEnvironment(
  server: CompressionResourceServer,
  reportError: (error: unknown) => void,
): WptEnvironment {
  const compression = new FixtureCompressionProvider();
  const runtime = createHostNodeWebPlatform({
    compression, baseURL: server.origin + "/", origin: server.origin,
  }, {}, reportError);
  return {
    exposeSelf: true,
    globals: {
      Blob, CompressionStream, DecompressionStream, DOMException,
      ReadableStream, TextDecoder, TextEncoder, TransformStream, WritableStream,
      fetch: runtime.fetch,
      // Genuine implementation-realm ECMAScript constructors preserve BufferSource
      // identities. WebAssembly.Memory is used only to create shared rejection inputs.
      Object, Function, Promise, ArrayBuffer, SharedArrayBuffer, DataView,
      Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
      Int32Array, Uint32Array, Float16Array, Float32Array, Float64Array,
      BigInt64Array, BigUint64Array, WebAssembly,
    },
    close(): void {
      compression.close();
      runtime.close();
    },
  };
}
