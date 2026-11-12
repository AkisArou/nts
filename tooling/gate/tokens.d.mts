import type {TokenRelease} from './case-context.ts';
export {runWithToken,releaseToken} from './case-context.ts';
export type TokenContext=Record<string,unknown>;
export function tokenClient(where:string,step:string):{acquire(context?:TokenContext,signal?:AbortSignal,bytes?:number):Promise<TokenRelease|null>};
export function acquireToken(context?:TokenContext,signal?:AbortSignal,bytes?:number):Promise<TokenRelease|null>;
export function withToken<T>(fn:()=>T|Promise<T>,context?:TokenContext):Promise<T>;
export const tokensEnabled:boolean;
