// A measured tree owns its toolchain pin. The controller's executable and
// PATH cannot select it; provisioning a missing installation is an operator action.
import {spawnSync} from "node:child_process";
import {delimiter,dirname,join,resolve} from "node:path";
import {userInfo} from "node:os";
import {ToolingInstrumentError} from "./step-result.ts";

/** `installations` is supplied by code (private fixtures), never a shell override. */
export function nodeToolchain(pin:string,launcher:NodeJS.ProcessEnv,installations=join(userInfo().homedir,".asdf/installs/nodejs")):{node:string;env:NodeJS.ProcessEnv}{
  if(!/^\d+\.\d+\.\d+$/.test(pin))throw new ToolingInstrumentError("tooling-setup","invalid Node toolchain pin: "+pin);
  const node=resolve(installations,pin,"bin/node");
  const env={...launcher,PATH:dirname(node)+(launcher.PATH?delimiter+launcher.PATH:"")};
  const found=spawnSync(node,["--version"],{env,encoding:"utf8"});
  if(found.status!==0||(found.stdout??"").trim()!=="v"+pin){
    const why=found.error?.message??`reported ${JSON.stringify((found.stdout??"").trim())} (exit ${found.status})`;
    throw new ToolingInstrumentError("tooling-setup",`pinned Node ${pin} is not available at ${node}: ${why}; install it with: asdf install nodejs ${pin}`);
  }
  return {node,env};
}
