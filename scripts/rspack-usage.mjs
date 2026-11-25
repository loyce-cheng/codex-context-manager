// Static checks on the installed bundle. Only module-local identifiers may vary.
import {parse,parseExpressionAt} from '../third_party/acorn/acorn.mjs';

const options={ecmaVersion:'latest',sourceType:'module'};
const ignored=new Set(['start','end','raw']);
const templates=new Map();
export function validPageExport(name){
  return typeof name==='string' && /^[A-Za-z_$][A-Za-z0-9_$]{0,30}$/.test(name) &&
    !['__proto__','constructor','prototype'].includes(name);
}
function shape(pattern,node,names){
  if(pattern===null||typeof pattern!=='object')return pattern===node;
  if(!node || typeof node!=='object')return false;
  if(Array.isArray(pattern))return Array.isArray(node)&&pattern.length===node.length&&pattern.every((v,i)=>shape(v,node[i],names));
  if(pattern.type==='Identifier' && pattern.name.startsWith('$')){
    if(node.type!=='Identifier')return false;
    const key=pattern.name.slice(1);
    if(names.has(key))return names.get(key)===node.name;
    names.set(key,node.name);return true;
  }
  return Object.keys(pattern).every(k=>ignored.has(k)||shape(pattern[k],node[k],names));
}
function match(text,node,seed={}){
  if(!templates.has(text))templates.set(text,parseExpressionAt(text,0,options));
  const names=new Map(Object.entries(seed));
  return shape(templates.get(text),node,names)?Object.fromEntries(names):null;
}
function factoryTable(text){
  const ast=parse(text,options);
  const tables=ast.body.flatMap(s=>s.type==='ExportNamedDeclaration'?s.declaration?.declarations??[]:[])
    .filter(d=>d.id?.name==='__webpack_modules__' && d.init?.type==='ObjectExpression');
  if(tables.length!==1)throw Error('未识别唯一的 Rspack 模块表');
  const table=new Map();
  for(const p of tables[0].init.properties){
    const key=p.key?.name??p.key?.value;
    if(!key||table.has(key))throw Error('模块表含有重复或未知的模块标识');
    table.set(key,p.value);
  }
  return table;
}
function bindings(factory){
  const vars=new Map(),funcs=new Map();
  for(const s of factory?.body?.body??[]){
    if(s.type==='VariableDeclaration')for(const d of s.declarations){if(d.id.type==='Identifier')vars.set(d.id.name,d.init);}
    if(s.type==='FunctionDeclaration')funcs.set(s.id.name,s);
  }
  return {vars,funcs};
}
function exportsOf(factory){
  if (factory?.params?.[2]?.type !== 'Identifier' || factory.params[1]?.type !== 'Identifier') return new Map();
  const defs=(factory?.body?.body??[]).map(s=>s.expression).filter(e=>e?.type==='CallExpression'&&
    e.callee.type==='MemberExpression'&&!e.callee.computed&&e.callee.object.name===factory.params[2]?.name&&
    e.callee.property.name==='d'&&e.arguments[0]?.name===factory.params[1]?.name);
  return new Map(defs.flatMap(d=>d.arguments.slice(1).flatMap(arg=>(arg.properties??[]).map(p=>{
    const v=p.value;
    return [p.key?.name??p.key?.value,v?.type==='ArrowFunctionExpression'&&!v.params.length?v.body:v];
  }))));
}
function nodes(root,visit){
  if(!root||typeof root!=='object')return;
  if(root.type && visit(root)===false)return;
  for(const key of Object.keys(root)){
    const v=root[key];
    if(Array.isArray(v))for(const child of v)nodes(child,visit);else if(v&&typeof v==='object')nodes(v,visit);
  }
}
const usageShape='(0,$atom.i1)($scope.u,($id,{get:$get})=>null==$id?null:$get($field,{hostId:$get($host.qX,$id),threadId:$id}))';
const modelShape='(0,$atom.i1)($scope.u,($id,{get:$get})=>$get($settings,$id)?.model??null)';
const settingsShape='(0,$atom.i1)($scope.u,($id,{get:$get})=>{if(null==$id)return null;let $info=$get($get($host.lG,$id));return $get($field,{hostId:$info?.managerHostId??$get($host.qX,$id),threadId:$id})})';
const pendingShape='(0,$atom.i1)($scope.u,($id,{get:$get})=>{let $kind=$get($pending,$id);if(null==$id||"mcpServerElicitation"!==$kind||$get($feature.w))return $kind;let $key={hostId:$get($host.qX,$id),threadId:$id};return null==$get($requests.J7,$key)?$kind:$get($detail,$id)?.type??null})';
const formulaShape='function $name($input){let $cap=$input?.modelContextWindow??null,$last=$input?.last.totalTokens??null;if(null==$cap||$cap<=0||null==$last||$last<0)return{percent:null,usedTokens:null,contextWindow:null,remainingTokens:null};let $used=Math.min($last,$cap),$pct=$used/$cap*100;return Number.isFinite($pct)?{percent:$pct,usedTokens:$used,contextWindow:$cap,remainingTokens:Math.max($cap-$used,0)}:{percent:null,usedTokens:null,contextWindow:null,remainingTokens:null}}';

function composerChecks(text,profile){
  let nativeFormula=false,nativeUsageConsumer=false;
  for(const factory of factoryTable(text).values()){
    const {vars,funcs}=bindings(factory);
    const imports=[...vars].filter(([,expr])=>match(`$req("${profile.moduleId}")`,expr,{req:factory.params?.[2]?.name}));
    if(imports.length!==1)continue;
    const source=imports[0][0];
    const formulas=[...funcs].filter(([,fn])=>match(formulaShape,{...fn,type:'FunctionExpression'}));
    if(formulas.length!==1)continue;
    nativeFormula=true;
    for(const fn of funcs.values()){
      const reads=new Set(),used=new Set();let shadowed=false;
      nodes(fn.body,n=>{
        if(['ArrowFunctionExpression','FunctionExpression','FunctionDeclaration'].includes(n.type))return false;
        if(n.type==='VariableDeclarator' && n.id.type==='Identifier'){
          if(n.id.name===source||n.id.name===formulas[0][0])shadowed=true;
          if(match('(0,$hook._U)($import.$export,$thread)',n.init,{import:source,export:profile.usageExport}))reads.add(n.id.name);
        }
        const call=n.type==='CallExpression' && match('$formula($reading)',n,{formula:formulas[0][0]});
        if(call)used.add(call.reading);
      });
      if(!shadowed && !fn.params.some(p=>p.name===source||p.name===formulas[0][0]) &&
        [...reads].some(name=>used.has(name)))nativeUsageConsumer=true;
    }
  }
  return {nativeFormula,nativeUsageConsumer};
}

export function inspectGetterBindings(state,composer,profile){
  const table=factoryTable(state),factory=table.get(profile.moduleId),out=exportsOf(factory);
  const {vars,funcs}=bindings(factory);
  const local=key=>vars.get(out.get(key)?.name);
  const candidates=[];
  for(const [key] of out){
    const binding=match(usageShape,local(key));
    if(binding && match('(0,$fields.tv)("tokenUsageInfo")',vars.get(binding.field)))candidates.push([key,binding]);
  }
  const [usageExport,use]=candidates.length===1 && validPageExport(candidates[0][0])?candidates[0]:[];
  const field=use&&match('(0,$fields.tv)("tokenUsageInfo")',vars.get(use.field));
  const hosts=use?[...out].filter(([,value])=>match('$host.qX',value,{host:use.host})):[];
  const hostExport=hosts.length===1 && validPageExport(hosts[0][0])?hosts[0][0]:null;
  const hostFactory=table.get('Bl6U'),hostDefs=exportsOf(hostFactory);
  const hostMeaning=match('(0,$a.i1)($scope.u,($id,{get:$get})=>{let $set=null==$id?null:$get($state.sZ,$id);return(0,$select.Cg)($get,$id)??($set?.has("local")?"local":$set?.values().next().value)??$get($fallback,$id)??"local"})',
    bindings(hostFactory).vars.get(hostDefs.get('qX')?.name),{fallback:hostDefs.get('sb')?.name});
  const hostImport=hostExport&&match('$req("Bl6U")',vars.get(use.host),{req:factory.params[2].name});
  const mapping=profile.preflightExports??{};
  const checks={
    stateModule:!!factory,tokenUsageExport:!!use,tokenUsageAtom:!!field,
    hostExport:!!hostImport&&!!hostMeaning&&['lG','qX','sb'].every(k=>hostDefs.get(k)?.type==='Identifier'),
    ...composerChecks(composer,{...profile,usageExport}),
  };
  const keys=field?{atom:use.atom,scope:use.scope,host:use.host}:{};
  const model=match(modelShape,local(mapping.model),keys);
  const settings=model&&match(settingsShape,vars.get(model.settings),keys);
  checks.preflight_model=!!(field&&settings&&match('(0,$fields.tv)("modelSettings")',vars.get(settings.field),{fields:field.fields}));
  const selectors={responseInProgress:'isResponseInProgress',requestCount:'requests',resumeState:'resumeState',
    ephemeral:'ephemeral',runtimeStatus:'summary',latestTurnStatus:'latestTurnStatus'};
  const bodies={requestCount:'$v.length',ephemeral:'!0===$v',runtimeStatus:'$v.threadRuntimeStatus??null'};
  let selector;
  for(const [key,prop] of Object.entries(selectors)){
    const result=match(`$select(({${prop}:$v})=>${bodies[key]??'$v'})`,local(mapping[key]),selector?{select:selector}:{});
    checks['preflight_'+key]=!!result;
    if(result)selector=result.select;
  }
  const pending=match(pendingShape,local(mapping.pendingRequestKind),keys);
  checks.preflight_pendingRequestKind=!!(pending&&selector&&match('$select(({pendingRequest:$v})=>$v?.kind??null)',vars.get(pending.pending),{select:selector}));
  const wrapper=funcs.get(selector);
  const forward=wrapper?.body.body[0]?.type==='ReturnStatement' && match('$helper($state.ok,$select,$eq)',wrapper.body.body[0]?.argument,
    {select:wrapper.params[0]?.name,eq:wrapper.params[1]?.left?.name});
  const helper=forward && funcs.get(forward.helper);
  const selectorShape='(0,$atom.i1)($scope.u,($id,{get:$get})=>{if(null==$id)return null;let $info=$get($get($host.lG,$id)),$local=(0,$pick.Cg)($get,$id),$first=$get($state,null==$local?null:{hostId:$local,threadId:$id});if(null!=$first)return $fn($first);let $v=$get($state,{hostId:$info?.managerHostId??$get($host.qX,$id),threadId:$id});return null==$v?null:$fn($v)},{owner:$k=>$k,isEqual:$eq})';
  checks.preflightSelectorReturnsNullWithoutState=!!(helper?.body?.body?.[0]?.type==='ReturnStatement' && match(selectorShape,helper.body.body[0]?.argument,
    {...keys,state:helper.params[0]?.name,fn:helper.params[1]?.name,eq:helper.params[2]?.left?.name}));
  return {checks,usageExport,hostExport};
}
