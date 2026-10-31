/* Acorn-walk 8.3.4, MIT. See ../LICENSE-jetstream.
 * Exact source: WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b
 * web-tooling-benchmark/dist/acorn.bundle.js, acorn-walk/dist/walk.mjs.
 */
import { Node, nodeValue, nodeArray } from './parser.ts';
type Walk = (node: Node, state: unknown, override?: string) => void;
type Visitor = (node: Node, state: unknown, walk: Walk) => void;
type BaseVisitor = Record<string, Visitor>;
type Visitors = Record<string, (node: Node, state: unknown, ancestors?: Node[]) => void>;
type NodeTest = (type: string, node: Node) => boolean;
// AST walker module for ESTree compatible trees

// A simple walk is one where you simply specify callbacks to be
// called on specific nodes. The last two arguments are optional. A
// simple use would be
//
//     walk.simple(myTree, {
//         Expression: function(node) { ... }
//     });
//
// to do something with all expressions. All ESTree node types
// can be used to identify node types, as well as Expression and
// Statement, which denote categories of nodes.
//
// The base argument can be used to pass a custom (recursive)
// walker, and state can be used to give this walked an initial
// state.

function simple(node: Node, visitors: Visitors, baseVisitor?: BaseVisitor, state?: unknown, override?: string) {
  if (!baseVisitor) { baseVisitor = base
  ; }(function c(node: Node, st: unknown, override?: string) {
    var type = override || node.type;
    baseVisitor![type](node, st, c);
    if (visitors[type]) { visitors[type](node, st); }
  })(node, state, override);
}

// An ancestor walk keeps an array of ancestor nodes (including the
// current node) and passes them to the callback as third parameter
// (and also as state parameter when no other state is present).
function ancestor(node: Node, visitors: Visitors, baseVisitor?: BaseVisitor, state?: unknown, override?: string) {
  var ancestors: Node[] = [];
  if (!baseVisitor) { baseVisitor = base
  ; }(function c(node: Node, st: unknown, override?: string) {
    var type = override || node.type;
    var isNew = node !== ancestors[ancestors.length - 1];
    if (isNew) { ancestors.push(node); }
    baseVisitor![type](node, st, c);
    if (visitors[type]) { visitors[type](node, st || ancestors, ancestors); }
    if (isNew) { ancestors.pop(); }
  })(node, state, override);
}

// A recursive walk is one where your functions override the default
// walkers. They can modify and replace the state parameter that's
// threaded through the walk, and can opt how and whether to walk
// their child nodes (by calling their third argument on these
// nodes).
function recursive(node: Node, state: unknown, funcs: BaseVisitor | null, baseVisitor?: BaseVisitor, override?: string) {
  var visitor = funcs ? make(funcs, baseVisitor || undefined) : baseVisitor
  ;(function c(node: Node, st: unknown, override?: string) {
    visitor![override || node.type](node, st, c);
  })(node, state, override);
}

function makeTest(test?: string | NodeTest | null) {
  if (typeof test === "string")
    { return function (type: string) { return type === test; } }
  else if (!test)
    { return function () { return true; } }
  else
    { return test }
}

class Found {
 declare node: Node;
 declare state: unknown;
 constructor(node: Node, state: unknown) { this.node = node; this.state = state; }
}

// A full walk triggers the callback on each node
function full(node: Node, callback: (node: Node, state: unknown, type: string) => void, baseVisitor?: BaseVisitor, state?: unknown, override?: string) {
  if (!baseVisitor) { baseVisitor = base; }
  var last: Node | undefined
  ;(function c(node: Node, st: unknown, override?: string) {
    var type = override || node.type;
    baseVisitor![type](node, st, c);
    if (last !== node) {
      callback(node, st, type);
      last = node;
    }
  })(node, state, override);
}

// An fullAncestor walk is like an ancestor walk, but triggers
// the callback on each node
function fullAncestor(node: Node, callback: (node: Node, state: unknown, ancestors: Node[], type: string) => void, baseVisitor?: BaseVisitor, state?: unknown) {
  if (!baseVisitor) { baseVisitor = base; }
  var ancestors: Node[] = [], last: Node | undefined
  ;(function c(node: Node, st: unknown, override?: string) {
    var type = override || node.type;
    var isNew = node !== ancestors[ancestors.length - 1];
    if (isNew) { ancestors.push(node); }
    baseVisitor![type](node, st, c);
    if (last !== node) {
      callback(node, st || ancestors, ancestors, type);
      last = node;
    }
    if (isNew) { ancestors.pop(); }
  })(node, state);
}

// Find a node with a given start, end, and type (all are optional,
// null can be used as wildcard). Returns a {node, state} object, or
// undefined when it doesn't find a matching node.
function findNodeAt(node: Node, start?: number | null, end?: number | null, test?: string | NodeTest | null, baseVisitor?: BaseVisitor, state?: unknown) {
  if (!baseVisitor) { baseVisitor = base; }
  const matcher = makeTest(test);
  try {
    (function c(node: Node, st: unknown, override?: string) {
      var type = override || node.type;
      if ((start == null || node.start <= start) &&
          (end == null || node.end >= end))
        { baseVisitor![type](node, st, c); }
      if ((start == null || node.start === start) &&
          (end == null || node.end === end) &&
          matcher(type, node))
        { throw new Found(node, st) }
    })(node, state);
  } catch (e) {
    if (e instanceof Found) { return e }
    throw e
  }
}

// Find the innermost node of a given type that contains the given
// position. Interface similar to findNodeAt.
function findNodeAround(node: Node, pos: number, test?: string | NodeTest | null, baseVisitor?: BaseVisitor, state?: unknown) {
  const matcher = makeTest(test);
  if (!baseVisitor) { baseVisitor = base; }
  try {
    (function c(node: Node, st: unknown, override?: string) {
      var type = override || node.type;
      if (node.start > pos || node.end < pos) { return }
      baseVisitor![type](node, st, c);
      if (matcher(type, node)) { throw new Found(node, st) }
    })(node, state);
  } catch (e) {
    if (e instanceof Found) { return e }
    throw e
  }
}

// Find the outermost matching node after a given position.
function findNodeAfter(node: Node, pos: number, test?: string | NodeTest | null, baseVisitor?: BaseVisitor, state?: unknown) {
  const matcher = makeTest(test);
  if (!baseVisitor) { baseVisitor = base; }
  try {
    (function c(node: Node, st: unknown, override?: string) {
      if (node.end < pos) { return }
      var type = override || node.type;
      if (node.start >= pos && matcher(type, node)) { throw new Found(node, st) }
      baseVisitor![type](node, st, c);
    })(node, state);
  } catch (e) {
    if (e instanceof Found) { return e }
    throw e
  }
}

// Find the outermost matching node before a given position.
function findNodeBefore(node: Node, pos: number, test?: string | NodeTest | null, baseVisitor?: BaseVisitor, state?: unknown) {
  const matcher = makeTest(test);
  if (!baseVisitor) { baseVisitor = base; }
  var max: Found | undefined
  ;(function c(node: Node, st: unknown, override?: string) {
    if (node.start > pos) { return }
    var type = override || node.type;
    if (node.end <= pos && (!max || max.node.end < node.end) && matcher(type, node))
      { max = new Found(node, st); }
    baseVisitor![type](node, st, c);
  })(node, state);
  return max
}

// Used to create a custom walker. Will fill in all missing node
// type properties with the defaults.
function make(funcs: BaseVisitor, baseVisitor?: BaseVisitor) {
  var visitor: BaseVisitor = Object.create(baseVisitor || base);
  for (var type in funcs) { visitor[type] = funcs[type]; }
  return visitor
}

function skipThrough(node: Node, st: unknown, c: Walk) { c(node, st); }
function ignore(_node: Node, _st: unknown, _c: Walk) {}

// Node walkers.

var base: BaseVisitor = {};

base.Program = base.BlockStatement = base.StaticBlock = function (node: Node, st: unknown, c: Walk) {
  for (var i = 0, list = nodeArray(node.body); i < list.length; i += 1)
    {
    var stmt = list[i];

    c(stmt, st, "Statement");
  }
};
base.Statement = skipThrough;
base.EmptyStatement = ignore;
base.ExpressionStatement = base.ParenthesizedExpression = base.ChainExpression =
  function (node: Node, st: unknown, c: Walk) { return c(nodeValue(node.expression), st, "Expression"); };
base.IfStatement = function (node: Node, st: unknown, c: Walk) {
  c(node.test!, st, "Expression");
  c(nodeValue(node.consequent), st, "Statement");
  if (node.alternate) { c(node.alternate!, st, "Statement"); }
};
base.LabeledStatement = function (node: Node, st: unknown, c: Walk) { return c(nodeValue(node.body), st, "Statement"); };
base.BreakStatement = base.ContinueStatement = ignore;
base.WithStatement = function (node: Node, st: unknown, c: Walk) {
  c(node.object, st, "Expression");
  c(nodeValue(node.body), st, "Statement");
};
base.SwitchStatement = function (node: Node, st: unknown, c: Walk) {
  c(node.discriminant, st, "Expression");
  for (var i = 0, list = node.cases; i < list.length; i += 1) {
    var cs = list[i];

    c(cs, st);
  }
};
base.SwitchCase = function (node: Node, st: unknown, c: Walk) {
  if (node.test) { c(node.test!, st, "Expression"); }
  for (var i = 0, list = nodeArray(node.consequent); i < list.length; i += 1)
    {
    var cons = list[i];

    c(cons, st, "Statement");
  }
};
base.ReturnStatement = base.YieldExpression = base.AwaitExpression = function (node: Node, st: unknown, c: Walk) {
  if (node.argument) { c(node.argument!, st, "Expression"); }
};
base.ThrowStatement = base.SpreadElement =
  function (node: Node, st: unknown, c: Walk) { return c(node.argument!, st, "Expression"); };
base.TryStatement = function (node: Node, st: unknown, c: Walk) {
  c(node.block, st, "Statement");
  if (node.handler) { c(node.handler, st); }
  if (node.finalizer) { c(node.finalizer, st, "Statement"); }
};
base.CatchClause = function (node: Node, st: unknown, c: Walk) {
  if (node.param) { c(node.param, st, "Pattern"); }
  c(nodeValue(node.body), st, "Statement");
};
base.WhileStatement = base.DoWhileStatement = function (node: Node, st: unknown, c: Walk) {
  c(node.test!, st, "Expression");
  c(nodeValue(node.body), st, "Statement");
};
base.ForStatement = function (node: Node, st: unknown, c: Walk) {
  if (node.init) { c(node.init, st, "ForInit"); }
  if (node.test) { c(node.test!, st, "Expression"); }
  if (node.update) { c(node.update, st, "Expression"); }
  c(nodeValue(node.body), st, "Statement");
};
base.ForInStatement = base.ForOfStatement = function (node: Node, st: unknown, c: Walk) {
  c(node.left, st, "ForInit");
  c(node.right, st, "Expression");
  c(nodeValue(node.body), st, "Statement");
};
base.ForInit = function (node: Node, st: unknown, c: Walk) {
  if (node.type === "VariableDeclaration") { c(node, st); }
  else { c(node, st, "Expression"); }
};
base.DebuggerStatement = ignore;

base.FunctionDeclaration = function (node: Node, st: unknown, c: Walk) { return c(node, st, "Function"); };
base.VariableDeclaration = function (node: Node, st: unknown, c: Walk) {
  for (var i = 0, list = node.declarations; i < list.length; i += 1)
    {
    var decl = list[i];

    c(decl, st);
  }
};
base.VariableDeclarator = function (node: Node, st: unknown, c: Walk) {
  c(node.id!, st, "Pattern");
  if (node.init) { c(node.init, st, "Expression"); }
};

base.Function = function (node: Node, st: unknown, c: Walk) {
  if (node.id) { c(node.id!, st, "Pattern"); }
  for (var i = 0, list = node.params; i < list.length; i += 1)
    {
    var param = list[i];

    c(param!, st, "Pattern");
  }
  c(nodeValue(node.body), st, node.expression ? "Expression" : "Statement");
};

base.Pattern = function (node: Node, st: unknown, c: Walk) {
  if (node.type === "Identifier")
    { c(node, st, "VariablePattern"); }
  else if (node.type === "MemberExpression")
    { c(node, st, "MemberPattern"); }
  else
    { c(node, st); }
};
base.VariablePattern = ignore;
base.MemberPattern = skipThrough;
base.RestElement = function (node: Node, st: unknown, c: Walk) { return c(node.argument!, st, "Pattern"); };
base.ArrayPattern = function (node: Node, st: unknown, c: Walk) {
  for (var i = 0, list = node.elements; i < list.length; i += 1) {
    var elt = list[i];

    if (elt) { c(elt, st, "Pattern"); }
  }
};
base.ObjectPattern = function (node: Node, st: unknown, c: Walk) {
  for (var i = 0, list = node.properties; i < list.length; i += 1) {
    var prop = list[i];

    if (prop.type === "Property") {
      if (prop.computed) { c(prop.key, st, "Expression"); }
      c(nodeValue(prop.value), st, "Pattern");
    } else if (prop.type === "RestElement") {
      c(prop.argument!, st, "Pattern");
    }
  }
};

base.Expression = skipThrough;
base.ThisExpression = base.Super = base.MetaProperty = ignore;
base.ArrayExpression = function (node: Node, st: unknown, c: Walk) {
  for (var i = 0, list = node.elements; i < list.length; i += 1) {
    var elt = list[i];

    if (elt) { c(elt, st, "Expression"); }
  }
};
base.ObjectExpression = function (node: Node, st: unknown, c: Walk) {
  for (var i = 0, list = node.properties; i < list.length; i += 1)
    {
    var prop = list[i];

    c(prop, st);
  }
};
base.FunctionExpression = base.ArrowFunctionExpression = base.FunctionDeclaration;
base.SequenceExpression = function (node: Node, st: unknown, c: Walk) {
  for (var i = 0, list = node.expressions; i < list.length; i += 1)
    {
    var expr = list[i];

    c(expr, st, "Expression");
  }
};
base.TemplateLiteral = function (node: Node, st: unknown, c: Walk) {
  for (var i = 0, list = node.quasis; i < list.length; i += 1)
    {
    var quasi = list[i];

    c(quasi, st);
  }

  for (var i$1 = 0, list$1 = node.expressions; i$1 < list$1.length; i$1 += 1)
    {
    var expr = list$1[i$1];

    c(expr, st, "Expression");
  }
};
base.TemplateElement = ignore;
base.UnaryExpression = base.UpdateExpression = function (node: Node, st: unknown, c: Walk) {
  c(node.argument!, st, "Expression");
};
base.BinaryExpression = base.LogicalExpression = function (node: Node, st: unknown, c: Walk) {
  c(node.left, st, "Expression");
  c(node.right, st, "Expression");
};
base.AssignmentExpression = base.AssignmentPattern = function (node: Node, st: unknown, c: Walk) {
  c(node.left, st, "Pattern");
  c(node.right, st, "Expression");
};
base.ConditionalExpression = function (node: Node, st: unknown, c: Walk) {
  c(node.test!, st, "Expression");
  c(nodeValue(node.consequent), st, "Expression");
  c(node.alternate!, st, "Expression");
};
base.NewExpression = base.CallExpression = function (node: Node, st: unknown, c: Walk) {
  c(node.callee, st, "Expression");
  if (node.arguments)
    { for (var i = 0, list = node.arguments; i < list.length; i += 1)
      {
        var arg = list[i];

        c(arg!, st, "Expression");
      } }
};
base.MemberExpression = function (node: Node, st: unknown, c: Walk) {
  c(node.object, st, "Expression");
  if (node.computed) { c(node.property, st, "Expression"); }
};
base.ExportNamedDeclaration = base.ExportDefaultDeclaration = function (node: Node, st: unknown, c: Walk) {
  if (node.declaration)
    { c(node.declaration, st, node.type === "ExportNamedDeclaration" || node.declaration.id ? "Statement" : "Expression"); }
  if (node.source) { c(node.source!, st, "Expression"); }
};
base.ExportAllDeclaration = function (node: Node, st: unknown, c: Walk) {
  if (node.exported)
    { c(node.exported, st); }
  c(node.source!, st, "Expression");
};
base.ImportDeclaration = function (node: Node, st: unknown, c: Walk) {
  for (var i = 0, list = node.specifiers; i < list.length; i += 1)
    {
    var spec = list[i];

    c(spec, st);
  }
  c(node.source!, st, "Expression");
};
base.ImportExpression = function (node: Node, st: unknown, c: Walk) {
  c(node.source!, st, "Expression");
};
base.ImportSpecifier = base.ImportDefaultSpecifier = base.ImportNamespaceSpecifier = base.Identifier = base.PrivateIdentifier = base.Literal = ignore;

base.TaggedTemplateExpression = function (node: Node, st: unknown, c: Walk) {
  c(node.tag, st, "Expression");
  c(node.quasi, st, "Expression");
};
base.ClassDeclaration = base.ClassExpression = function (node: Node, st: unknown, c: Walk) { return c(node, st, "Class"); };
base.Class = function (node: Node, st: unknown, c: Walk) {
  if (node.id) { c(node.id!, st, "Pattern"); }
  if (node.superClass) { c(node.superClass, st, "Expression"); }
  c(nodeValue(node.body), st);
};
base.ClassBody = function (node: Node, st: unknown, c: Walk) {
  for (var i = 0, list = nodeArray(node.body); i < list.length; i += 1)
    {
    var elt = list[i];

    c(elt, st);
  }
};
base.MethodDefinition = base.PropertyDefinition = base.Property = function (node: Node, st: unknown, c: Walk) {
  if (node.computed) { c(node.key, st, "Expression"); }
  if (node.value) { c(nodeValue(node.value), st, "Expression"); }
};





export {simple,ancestor,recursive,full,fullAncestor,findNodeAt,findNodeAround,findNodeAfter,findNodeBefore,make,base};
