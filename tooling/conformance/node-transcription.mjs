// Compare complete erased programs. Only named, validated scaffolding is folded.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';

const ast = text => parse(text,{ecmaVersion:'latest',sourceType:'module'});
const statements = text => ast(`function proof() { ${text} }`).body[0].body.body;
const hash = text => createHash('sha256').update(text).digest('hex');
// The pre-existing port scaffolding: named imports/exports and primordials.
// Rendering preserves every other source span, including complete bodies.
function scaffolding(source,rule) {
  if(!rule)return source;
  const program=parse(source,{ecmaVersion:'latest',sourceType:'script'});
  function render(node) {
    if(node.type==='Identifier'&&Object.hasOwn(rule.globals,node.name))return rule.globals[node.name];
    if(node.type==='Property'&&node.shorthand)return render(node.value);
    if(node.type==='CallExpression'&&node.callee.type==='Identifier'&&Object.hasOwn(rule.methods,node.callee.name))
      return `(${render(node.arguments[0])}).${rule.methods[node.callee.name]}(${node.arguments.slice(1).map(render).join(', ')})`;
    const children=[];
    for(const value of Object.values(node)) {
      if(Array.isArray(value))children.push(...value.filter(child=>child&&typeof child==='object'&&'type'in child));
      else if(value&&typeof value==='object'&&'type'in value)children.push(value);
    }
    const unique=[...new Map(children.map(child=>[`${child.start}:${child.end}`,child])).values()].sort((a,b)=>a.start-b.start);
    let result='',at=node.start;
    for(const child of unique){assert.ok(child.start>=at);result+=source.slice(at,child.start)+render(child);at=child.end;}
    return result+source.slice(at,node.end);
  }
  let result=rule.preamble,at=0,imports=0,exports=0,primordials=0;
  for(const statement of program.body) {
    result+=source.slice(at,statement.start);at=statement.end;
    if(statement.type==='ExpressionStatement'&&statement.directive==='use strict')continue;
    if(statement.type==='VariableDeclaration'&&statement.declarations.length===1) {
      const init=statement.declarations[0].init;
      if(init?.type==='Identifier'&&init.name==='primordials'){primordials++;continue;}
      if(init&&source.slice(init.start,init.end)===rule.requireExpression){imports++;continue;}
    }
    if(statement.type==='ExpressionStatement'&&statement.expression.type==='AssignmentExpression'&&
        source.slice(statement.expression.left.start,statement.expression.left.end)==='module.exports') {
      result+=`export { ${rule.exports.join(', ')} };`;exports++;continue;
    }
    result+=render(statement);
  }
  assert.equal(primordials,1);assert.equal(imports,1);assert.equal(exports,1);
  return result+source.slice(at);
}
function clean(value) {
  if(Array.isArray(value))return value.map(clean);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value)
    .filter(([key])=>!['start','end','loc','raw'].includes(key)).map(([key,item])=>[key,clean(item)]));
  return value;
}
const equal = (a,b) => JSON.stringify(clean(a))===JSON.stringify(clean(b));
function visit(node,callback,parent,key) {
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const item of node)visit(item,callback,parent,key);return;}
  callback(node,parent,key);
  for(const [name,value] of Object.entries(node))if(!['start','end','loc','raw'].includes(name))visit(value,callback,node,name);
}
function reference(node,parent,key) {
  if(node.type!=='Identifier')return false;
  if(parent&&['MemberExpression','Property','MethodDefinition','PropertyDefinition'].includes(parent.type)&&
      ['property','key'].includes(key)&&!parent.computed)return false;
  return true;
}
function names(node,name) {
  let count=0;visit(node,(item,parent,key)=>{if(reference(item,parent,key)&&item.name===name)count++;});return count;
}
function one(items,predicate,label) {
  const found=items.filter(predicate);assert.equal(found.length,1,`expected one ${label}`);return found[0];
}
function identifier(name) {assert.match(name,/^[A-Za-z_$][\w$]*$/);return {type:'Identifier',name};}
function classOf(program,name) {return one(program.body,node=>node.type==='ClassDeclaration'&&node.id.name===name,`class ${name}`);}
function methodOf(program,rule) {
  return one(classOf(program,rule.className).body.body,node=>node.type==='MethodDefinition'&&
    node.kind===(rule.kind??'method')&&(node.key.name===rule.name||rule.kind==='constructor'),`method ${rule.className}.${rule.name}`);
}
function conversions(program,rules) {
  for(const rule of rules??[]) {
    const fn=methodOf(program,rule).value;
    for(const [raw,local] of Object.entries(rule.bindings)) {
      one(fn.params,node=>node.type==='Identifier'&&node.name===raw,`raw parameter ${raw}`);
      const statement=one(fn.body.body,node=>node.type==='VariableDeclaration'&&node.declarations.length===1&&
        node.declarations[0].id.type==='Identifier'&&node.declarations[0].id.name===local,`conversion binding ${local}`);
      assert.equal(statement.kind,'let','conversion local must retain the reviewed binding form');
      const declaration=statement.declarations[0];assert.ok(declaration.init,'conversion must have an initializer');
      visit(fn.body,(node,parent,key)=>{
        if(['FunctionExpression','ArrowFunctionExpression','FunctionDeclaration'].includes(node.type))
          assert.equal(names(node,raw),0,`raw parameter ${raw} captured by a nested function`);
        if(!reference(node,parent,key))return;
        assert.ok(!(node.name===raw&&node.start>=statement.end),`raw parameter ${raw} used after conversion`);
        assert.ok(!(node.name===local&&node.start<statement.start),`conversion local ${local} used before initialization`);
      });
      const at=fn.body.body.indexOf(statement);
      fn.body.body[at]={type:'ExpressionStatement',expression:{type:'AssignmentExpression',operator:'=',
        left:identifier(local),right:declaration.init}};
      visit(fn,(node,parent,key)=>{if(reference(node,parent,key)&&node.name===raw)node.name=local;});
    }
  }
}
function descriptors(program,rules) {
  for(const name of rules??[]) {
    const declaration=one(program.body,node=>node.type==='VariableDeclaration'&&node.kind==='const'&&
      node.declarations.length===1&&node.declarations[0].id.name===name,`descriptor ${name}`);
    const value=declaration.declarations[0].init;
    assert.equal(value?.type,'ObjectExpression','descriptor must remain a literal');
    one(value.properties,property=>property.type==='Property'&&property.key.name==='__proto__'&&
      property.value.type==='Literal'&&property.value.value===null,'literal null prototype');
    assert.equal(names(program,name),2,'descriptor must have exactly one use');
    const at=program.body.indexOf(declaration),next=program.body[at+1];
    assert.equal(next?.type,'ExpressionStatement','descriptor must immediately precede registration');
    const call=next.expression;
    assert.ok(call.type==='CallExpression'&&equal(call.callee,ast('Object.defineProperty').body[0].expression));
    assert.equal(call.arguments.length,3);assert.equal(call.arguments[2].type,'Identifier');
    assert.equal(call.arguments[2].name,name);
    // Hoisting may not execute any expression or access an arbitrary object.
    for(const property of value.properties) {
      assert.equal(property.type,'Property');assert.equal(property.kind,'init');assert.equal(property.computed,false);
      assert.ok(['Literal','Identifier','MemberExpression'].includes(property.value.type),'effectful descriptor value');
      visit(property.value,node=>assert.ok(['Literal','Identifier','MemberExpression'].includes(node.type)&&
        (node.type!=='MemberExpression'||!node.computed),'effectful descriptor value'));
    }
    call.arguments[2]=value;program.body.splice(at,1);
  }
}
function factory(program,rule) {
  if(!rule)return;
  const {name,className,beforeClass}=rule;
  const declaration=one(program.body,node=>node.type==='VariableDeclaration'&&node.kind==='let'&&
    node.declarations.length===1&&node.declarations[0].id.name===name,`lexical factory ${name}`);
  assert.equal(declaration.declarations[0].init,null);
  const owner=classOf(program,className);
  assert.equal(program.body.indexOf(declaration)+1,program.body.indexOf(owner),'factory declaration must immediately precede class');
  const block=one(owner.body.body,node=>node.type==='StaticBlock','factory static block');
  assert.equal(block.body.length,1);
  const assignment=block.body[0].expression;
  assert.ok(block.body[0].type==='ExpressionStatement'&&assignment.type==='AssignmentExpression'&&assignment.operator==='=');
  assert.equal(assignment.left.type,'Identifier');assert.equal(assignment.left.name,name);
  const fn=assignment.right;assert.equal(fn.type,'FunctionExpression');assert.equal(fn.id?.name,name);
  assert.equal(fn.async,false);assert.equal(fn.generator,false);
  visit(fn.body,node=>assert.ok(!['ThisExpression','Super','MetaProperty'].includes(node.type),'factory relies on method receiver/constructibility'));
  // A method and a function differ in constructibility and reflective shape.
  // That difference is private only if the factory is used solely by calls.
  visit(program,(node,parent,key)=>{
    if(!reference(node,parent,key)||node.name!==name)return;
    assert.ok((parent===declaration.declarations[0]&&key==='id')||
      (parent===assignment&&key==='left')||(parent===fn&&key==='id')||
      (parent.type==='CallExpression'&&key==='callee'), 'hidden factory must not escape or be constructed');
  });
  owner.body.body[owner.body.body.indexOf(block)]={type:'MethodDefinition',static:true,computed:false,kind:'method',
    key:identifier(name),value:{...fn,id:null}};
  program.body.splice(program.body.indexOf(declaration),1);
  const follower=classOf(program,beforeClass),at=program.body.indexOf(follower);
  const capture=ast(`const { ${name} } = ${className}; delete ${className}.${name};`).body;
  program.body.splice(at,0,...capture);
}
function invariant(program,rule) {
  if(!rule)return;
  const {helper,parameter='value',message,className,flag,marker,input}=rule;
  const expected=ast(`function ${helper}(${parameter}) { if (typeof ${parameter} !== "string") { throw new Error(${JSON.stringify(message)}); } }`).body[0];
  const declaration=one(program.body,node=>node.type==='FunctionDeclaration'&&node.id.name===helper,'checked string invariant');
  assert.ok(equal(declaration,expected),'invariant helper must perform exactly the reviewed check');
  assert.equal(names(program,helper),2,'invariant must have exactly one call');
  const ctor=methodOf(program,{className,kind:'constructor'}).value;
  const branch=ctor.body.body[0];
  assert.ok(branch.type==='IfStatement'&&equal(branch.test,ast(`${flag} === ${marker}`).body[0].expression));
  assert.equal(branch.consequent.type,'BlockStatement');
  const call=branch.consequent.body[0];
  assert.ok(equal(call,ast(`${helper}(${input});`).body[0]),'invariant must guard the private fast branch first');
  branch.consequent.body.shift();program.body.splice(program.body.indexOf(declaration),1);
}

function privateStringReachability(program,rule) {
  if(!rule)return;
  // The marker's complete use set is closed: declaration, equality test,
  // and one constructor argument in parse(). It can never escape to a caller.
  const marker=one(program.body,node=>node.type==='VariableDeclaration'&&node.kind==='const'&&
    node.declarations.length===1&&node.declarations[0].id.name===rule.marker,'private marker');
  assert.ok(equal(marker.declarations[0].init,ast(`Symbol('${rule.marker}')`).body[0].expression));
  assert.equal(names(program,rule.marker),3,'private marker escapes or has another caller');
  const method=methodOf(program,{className:rule.className,name:'parse'});
  assert.equal(method.static,true);
  const body=method.value.body.body;
  assert.equal(body.length,3,'parse must convert, validate, then construct');
  const value=rule.input;
  assert.ok(equal(body[0],statements(`${value} = \`\${${value}}\`;`)[0]),'parse must convert the input to string');
  assert.ok(equal(body[1],statements(`if (!parseTypeAndSubtype(${value})) return null;`)[0]));
  assert.ok(equal(body[2],statements(`return new ${rule.className}(${value}, ${rule.marker});`)[0]));
}

/** reference is the pinned, import/primordial-normalized upstream program. */
export function verifyTranscription(referenceText,portedText,policy={}) {
  assert.ok(Object.keys(policy).every(key=>['referenceSha256','scaffolding','conversions','descriptors','factory','invariant','source','reachability'].includes(key)), 'unknown normalization');
  if(policy.source?.sha256)assert.equal(hash(referenceText),policy.source.sha256,'upstream source identity differs');
  const sourceSha256=hash(referenceText);
  referenceText=scaffolding(referenceText,policy.scaffolding);
  if(policy.referenceSha256)assert.equal(hash(referenceText),policy.referenceSha256,'reference identity differs');
  const referenceProgram=ast(referenceText),portedProgram=ast(stripTypeScriptTypes(portedText,{mode:'strip'}));
  conversions(portedProgram,policy.conversions);
  descriptors(portedProgram,policy.descriptors);
  factory(portedProgram,policy.factory);
  invariant(portedProgram,policy.invariant);
  privateStringReachability(portedProgram,policy.invariant);
  assert.deepEqual(clean(portedProgram),clean(referenceProgram),'complete normalized program differs');
  return {source:policy.source,sourceSha256,referenceSha256:hash(referenceText),portedSha256:hash(portedText),astSha256:hash(JSON.stringify(clean(referenceProgram))),
    normalizations:{conversions:policy.conversions?.length??0,descriptors:policy.descriptors?.length??0,
      factory:Boolean(policy.factory),checkedInvariant:Boolean(policy.invariant)}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [reference,ported,policy,out]=process.argv.slice(2);
  assert.ok(reference&&ported&&policy&&out,'node-transcription.mjs <reference.js> <port.ts> <policy.json> <receipt.json>');
  const result=verifyTranscription(readFileSync(reference,'utf8'),readFileSync(ported,'utf8'),JSON.parse(readFileSync(policy,'utf8')));
  writeFileSync(out,JSON.stringify(result,null,2)+'\n');
}
