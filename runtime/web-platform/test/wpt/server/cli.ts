import { startWptServer } from "./server.ts";

const server = await startWptServer();
console.log(JSON.stringify({
  http: server.httpOrigin,
  https: server.httpsOrigin,
  ws: server.wsOrigin,
  wss: server.wssOrigin,
  ports: server.ports,
}));
const close = (): void => {
  server.close().then(() => {
    if (server.errors.length !== 0) {
      for (const error of server.errors) console.error(error);
      process.exitCode = 1;
    }
  }).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
