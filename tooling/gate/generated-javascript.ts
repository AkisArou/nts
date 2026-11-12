// Explicit source boundary for exported factories. The audit parses this
// input as JavaScript; ordinary returned strings remain data.
declare const generatedSource:unique symbol;
export type GeneratedJavaScript=string & {readonly [generatedSource]:true};
export function generatedJavaScript(source:string):GeneratedJavaScript{return source as GeneratedJavaScript;}
