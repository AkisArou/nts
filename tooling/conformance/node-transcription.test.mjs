import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {verifyTranscription} from './node-transcription.mjs';

const reference = `
const kNoThrow = Symbol('kNoThrow');
function parseTypeAndSubtype(string) { return string.length > 0; }
class MIMEParams {
  #string = null;
  static instantiateMimeParams(str) {
    const instance = new MIMEParams();
    instance.#string = str;
    return instance;
  }
  set(name) { name = \`\${name}\`; return name.length; }
  entries() { return this.#string; }
}
Object.defineProperty(MIMEParams.prototype, 'toJSON', {
  __proto__: null, configurable: true, value: MIMEParams.prototype.entries, writable: true,
});
const { instantiateMimeParams } = MIMEParams;
delete MIMEParams.instantiateMimeParams;
class MIMEType {
  constructor(string, noThrowSymbol = null) {
    if (noThrowSymbol === kNoThrow) { this.#init(string); return; }
    string = \`\${string}\`;
    if (!parseTypeAndSubtype(string)) throw new Error('invalid');
    this.#init(string);
  }
  #init(string) { instantiateMimeParams(string); }
  static parse(string) {
    string = \`\${string}\`;
    if (!parseTypeAndSubtype(string)) return null;
    return new MIMEType(string, kNoThrow);
  }
}
export { MIMEParams, MIMEType };
`;
const port = `
const kNoThrow = Symbol('kNoThrow');
function parseTypeAndSubtype(string: string): boolean { return string.length > 0; }
let instantiateMimeParams: (str: string) => MIMEParams;
class MIMEParams {
  #string: string | null = null;
  static {
    instantiateMimeParams = function instantiateMimeParams(str: string): MIMEParams {
      const instance = new MIMEParams();
      instance.#string = str;
      return instance;
    };
  }
  set(rawName: unknown): number { let name = \`\${rawName}\`; return name.length; }
  entries() { return this.#string; }
}
interface Descriptor extends PropertyDescriptor { __proto__?: null; }
const descriptor: Descriptor = {
  __proto__: null, configurable: true, value: MIMEParams.prototype.entries, writable: true,
};
Object.defineProperty(MIMEParams.prototype, 'toJSON', descriptor);
function assertString(value: unknown): asserts value is string {
  if (typeof value !== "string") { throw new Error("nts internal invariant: expected string"); }
}
class MIMEType {
  constructor(rawString: unknown, noThrowSymbol: unknown = null) {
    if (noThrowSymbol === kNoThrow) { assertString(rawString); this.#init(rawString); return; }
    let string = \`\${rawString}\`;
    if (!parseTypeAndSubtype(string)) throw new Error('invalid');
    this.#init(string);
  }
  #init(string: string) { instantiateMimeParams(string); }
  static parse(rawString: unknown) {
    let string = \`\${rawString}\`;
    if (!parseTypeAndSubtype(string)) return null;
    return new MIMEType(string, kNoThrow);
  }
}
export { MIMEParams, MIMEType };
`;
const policy = {
  referenceSha256: createHash('sha256').update(reference).digest('hex'),
  conversions: [
    {className:'MIMEParams',name:'set',bindings:{rawName:'name'}},
    {className:'MIMEType',kind:'constructor',bindings:{rawString:'string'}},
    {className:'MIMEType',name:'parse',bindings:{rawString:'string'}},
  ],
  descriptors:['descriptor'],
  factory:{name:'instantiateMimeParams',className:'MIMEParams',beforeClass:'MIMEType'},
  invariant:{helper:'assertString',message:'nts internal invariant: expected string',className:'MIMEType',flag:'noThrowSymbol',marker:'kNoThrow',input:'string'},
};

test('complete typed program folds only the declared scaffolding', () => {
  const result=verifyTranscription(reference,port,policy);
  assert.deepEqual(result.normalizations,{conversions:3,descriptors:1,factory:true,checkedInvariant:true});
  assert.equal(result.referenceSha256,policy.referenceSha256);
});

test('ordinary type erasure permits no executable change', () => {
  verifyTranscription('export function f(x) { return x + 1; }','export function f(x: number): number { return x + 1; }');
  assert.throws(()=>verifyTranscription('export function f(x) { return x + 1; }','export function f(x: number): number { return x + 2; }'));
});

test('a raw-input closure cannot be folded into a converted local capture',()=>{
  const reference='class C { set(value) { const f = () => value; value = `${value}`; return f(); } }';
  const port='class C { set(raw: unknown) { const f = () => raw; let value = `${raw}`; return f(); } }';
  assert.throws(()=>verifyTranscription(reference,port,{conversions:[{className:'C',name:'set',bindings:{raw:'value'}}]}),/captured by a nested function/);
});

test('method-to-private-function registration cannot authorize constructibility changes',()=>{
  const changed={...policy};delete changed.referenceSha256;
  for(const use of ['new instantiateMimeParams(string);','void instantiateMimeParams.prototype;','return instantiateMimeParams;']) {
    const mutate=text=>text.replace('instantiateMimeParams(string);',use);
    assert.notEqual(mutate(reference),reference);assert.notEqual(mutate(port),port);
    assert.throws(()=>verifyTranscription(mutate(reference),mutate(port),changed),/hidden factory must not escape or be constructed/);
  }
});

for(const [name,before,after] of [
  ['algorithm edit','return name.length;','return name.length + 1;'],
  ['conversion moved','let name = `${rawName}`; return name.length;','return name.length; let name = `${rawName}`;'],
  ['raw input reused','return name.length;','return `${rawName}`.length;'],
  ['changed conversion','let name = `${rawName}`;','let name = String(rawName);'],
  ['descriptor reused',"Object.defineProperty(MIMEParams.prototype, 'toJSON', descriptor);","Object.defineProperty(MIMEParams.prototype, 'toJSON', descriptor); void descriptor;"],
  ['descriptor moved',"Object.defineProperty(MIMEParams.prototype, 'toJSON', descriptor);","void 0; Object.defineProperty(MIMEParams.prototype, 'toJSON', descriptor);"],
  ['descriptor effect','value: MIMEParams.prototype.entries','value: MIMEParams.prototype.entries()'],
  ['descriptor getter','value: MIMEParams.prototype.entries','get value() { return MIMEParams.prototype.entries; }'],
  ['factory body changed','instance.#string = str;','instance.#string = str + "!";'],
  ['factory receiver','instance.#string = str;','instance.#string = this.value;'],
  ['extra static work','instantiateMimeParams = function','void 0; instantiateMimeParams = function'],
  ['unchecked assertion','typeof value !== "string"','false'],
  ['public error type','throw new Error("nts internal invariant: expected string")','throw new TypeError("nts internal invariant: expected string")'],
  ['late invariant','assertString(rawString); this.#init(rawString);','this.#init(rawString); assertString(rawString);'],
  ['private marker escaped','export { MIMEParams, MIMEType };','export { MIMEParams, MIMEType, kNoThrow };'],
  ['new private caller','export { MIMEParams, MIMEType };','new MIMEType(17, kNoThrow); export { MIMEParams, MIMEType };'],
  ['parse conversion bypassed','let string = `${rawString}`;\n    if (!parseTypeAndSubtype(string)) return null;','let string = rawString;\n    if (!parseTypeAndSubtype(string)) return null;'],
]) test(`rejects ${name}`,()=>{
  assert.ok(port.includes(before),`mutation must hit: ${name}`);
  assert.throws(()=>verifyTranscription(reference,port.replace(before,after),policy));
});

test('unknown normalization and changed reference identities fail closed',()=>{
  assert.throws(()=>verifyTranscription(reference,port,{...policy,ignoreAlgorithm:true}),/unknown normalization/);
  assert.throws(()=>verifyTranscription(reference+' ',port,policy),/reference identity/);
  assert.throws(()=>verifyTranscription(reference,port,{...policy,source:{sha256:'0'.repeat(64)}}),/upstream source identity/);
});

test('a private check cannot be authorized for an escaping marker in both programs',()=>{
  const extra='\nexport const leaked = kNoThrow;';
  const changed={...policy};delete changed.referenceSha256;
  assert.throws(()=>verifyTranscription(reference+extra,port+extra,changed),/private marker escapes/);
});

test('upstream import and primordial normalization preserves a whole body',()=>{
  const source=`'use strict'; const { SafeMap } = primordials; const errors = require('internal/errors').codes; function f() { return new SafeMap(); } module.exports = { f };`;
  const scaffold={preamble:"import errors from './errors.js';\n",requireExpression:"require('internal/errors').codes",globals:{SafeMap:'Map'},methods:{},exports:['f']};
  verifyTranscription(source,"import errors from './errors.js'; function f() { return new Map(); } export { f };",{scaffolding:scaffold});
  assert.throws(()=>verifyTranscription(source,"import errors from './errors.js'; function f() { return new Map([['wrong',1]]); } export { f };",{scaffolding:scaffold}));
});
