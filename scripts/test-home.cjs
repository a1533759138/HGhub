// Synthetic offline regression; run with npm test or pnpm test.
process.chdir(require("node:path").resolve(__dirname, ".."));
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require(require.resolve('typescript',{paths:[process.cwd()]}));
const noop=()=>{};
function createHome(){
 const instances=new Map(),queue=[],effects=[],requests=[],categories=[],navigation=[],tabs=[],observers=[];
 let current=null,cursor=0,tree,props={active:false,bottomInset:74};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={
  useState(init){const inst=current,i=cursor++;if(!inst.hooks[i]){const h={v:typeof init==='function'?init():init};h.set=u=>queue.push(()=>{if(inst.mounted)h.v=typeof u==='function'?u(h.v):u});inst.hooks[i]=h}return [inst.hooks[i].v,inst.hooks[i].set]},
  useRef(init){return current.hooks[cursor++]||=({current:init})},
  useCallback(fn,deps){const inst=current,i=cursor++;if(!inst.hooks[i]||!same(inst.hooks[i].deps,deps))inst.hooks[i]={deps,fn};return inst.hooks[i].fn},
  useMemo(fn,deps){const inst=current,i=cursor++;if(!inst.hooks[i]||!same(inst.hooks[i].deps,deps))inst.hooks[i]={deps,v:fn()};return inst.hooks[i].v},
  useEffect(fn,deps){const inst=current,i=cursor++;if(!inst.hooks[i]||!same(inst.hooks[i].deps,deps)){const old=inst.hooks[i];inst.hooks[i]={deps};effects.push(()=>{old?.cleanup?.();if(inst.mounted)inst.hooks[i].cleanup=fn()})}},
 };react.default=react;
 const jsx=(type,props,key)=>({type,props:props||{},key});
 const api={rank:(kind)=>new Promise((resolve,reject)=>requests.push({kind,resolve,reject})),category:(...args)=>new Promise((resolve,reject)=>categories.push({args,resolve,reject}))};
 const store={push:p=>navigation.push(p),setTab:t=>tabs.push(t)};
 class IO{constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this)}observe(){}disconnect(){this.disconnected=true}}
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const mod={exports:{}};cache.set(file,mod);
  const imports=id=>{
   if(id==='react')return react;if(id==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'Fragment'};
   const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),id));
   if(target==='src/api')return {api,fmt:String,cover:x=>x||''};
   if(target==='src/store')return {useStore:()=>store};
   for(const ext of ['.tsx','.ts'])if(fs.existsSync(target+ext))return load(target+ext);
   throw Error('Unexpected import '+id+' from '+file);
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2021}}).outputText,{module:mod,exports:mod.exports,require:imports,window:{setTimeout:()=>0,clearTimeout:noop},IntersectionObserver:IO,console,Date,Set,Map,Promise,Math});
  return mod.exports;
 }
 const Home=load('src/pages/Home.tsx').default;
 function dispose(inst){inst.mounted=false;for(const h of inst.hooks)h?.cleanup?.()}
 function render(){
  const visited=new Set();
  function expand(value,p){
   if(Array.isArray(value))return value.map((x,i)=>expand(x,p+'/'+(x?.key??i)));
   if(!value||typeof value!=='object')return value;
   if(typeof value.type==='function'){
    const id=p+':'+value.type.name;let inst=instances.get(id);
    if(!inst||inst.type!==value.type){if(inst)dispose(inst);inst={type:value.type,hooks:[],mounted:true};instances.set(id,inst)}
    visited.add(id);const prev=current,oldCursor=cursor;current=inst;cursor=0;const result=value.type(value.props);current=prev;cursor=oldCursor;
    return {...value,rendered:expand(result,id)};
   }
   if(value.props?.ref&&typeof value.props.ref==='object')value.props.ref.current||={clientWidth:375,clientHeight:700};
   return {...value,props:{...value.props,children:expand(value.props?.children,p+'/children')}};
  }
  tree=expand(jsx(Home,props),'root');for(const [id,inst]of instances){if(!visited.has(id)){dispose(inst);instances.delete(id)}}while(effects.length)effects.shift()();return tree;
 }
 function flush(){let n=0;while(queue.length){assert(++n<40,'render loop');while(queue.length)queue.shift()();render()}return tree}
 return {requests,categories,navigation,tabs,observers,get tree(){return tree},mount(){render();flush()},update(p){props={...props,...p};render();flush()},flush,async settle(){for(let i=0;i<12;i++){await Promise.resolve();flush()}}};
}
function nodes(root){const out=[];function visit(x){if(Array.isArray(x))x.forEach(visit);else if(x&&typeof x==='object'){out.push(x);if(x.rendered)visit(x.rendered);else visit(x.props?.children)}}visit(root);return out}
function text(root){if(Array.isArray(root))return root.map(text).join('');if(root&&typeof root==='object')return text(root.rendered??root.props?.children);return root==null||typeof root==='boolean'?'':String(root)}
const component=(r,name)=>nodes(r.tree).find(n=>typeof n.type==='function'&&n.type.name===name);
const rows=r=>nodes(r.tree).filter(n=>typeof n.type==='function'&&n.type.name==='RankRow');
function button(r,label){const found=nodes(r.tree).find(n=>n.type==='button'&&text(n)===label);assert(found,'button '+label);return found}
function click(r,label){button(r,label).props.onClick();r.flush()}
const rank=(id,n=1)=>({rank:n,video_id:id,title:'Synthetic '+id,cover:'',tags:['都市'],score:8,metric_value:100+id,metric_label:'测试指数',metrics:{}});
const card=(id,tags=['都市'])=>({id,title:'Synthetic '+id,cover:'',tags,hot:id,like_count:1,episode_count:3,is_finished:false});
(async()=>{
 const r=createHome();r.mount();assert.equal(r.requests.length,0);assert.equal(r.categories.length,0);assert.equal(nodes(r.tree).filter(n=>n.props?.role==='tab').length,4);assert.equal(button(r,'热播榜').props['aria-selected'],true);
 r.update({active:true});assert.equal(r.requests.length,1);assert.equal(r.requests[0].kind,'hot');assert.equal(r.categories.length,0);
 r.requests[0].resolve({type:'hot',items:[rank(42,5),rank(11,1)]});await r.settle();assert.equal(rows(r).map(n=>n.props.item.video_id).join(','),'42,11');assert.equal(rows(r)[0].props.item.rank,5);assert(text(r.tree).includes('测试指数'));assert.equal(r.navigation.length,0,'tabs render on homepage without push');
 rows(r)[1].props.onOpen();assert.equal(r.navigation[0].kind,'feed');assert.equal(r.navigation[0].videoIds.join(','),'42,11');assert.equal(r.navigation[0].index,1);r.update({active:false});r.update({active:true});assert.equal(r.requests.length,1,'return from player keeps completed rank');
 click(r,'推荐榜');assert.equal(r.requests[1].kind,'recommend');click(r,'飙升榜');assert.equal(r.requests[2].kind,'potential');r.requests[2].resolve({items:[rank(90,7)]});await r.settle();r.requests[1].resolve({items:[rank(999)]});await r.settle();assert.equal(rows(r)[0].props.item.video_id,90);assert.equal(r.categories.length,0);
 click(r,'热播榜');assert.equal(r.requests[3].kind,'hot');r.requests[3].reject(Error('synthetic offline'));await r.settle();assert.equal(component(r,'Empty').props.title,'榜单加载失败');component(r,'Empty').props.onAction();r.flush();assert.equal(r.requests[4].kind,'hot');r.requests[4].resolve({items:[]});await r.settle();assert.equal(component(r,'Empty').props.title,'榜单暂时为空');
 click(r,'推荐榜');r.update({active:false});r.requests[5].resolve({items:[rank(777)]});await r.settle();assert.equal(rows(r).length,0,'inactive response ignored');const rankCount=r.requests.length;click(r,'飙升榜');assert.equal(r.requests.length,rankCount,'inactive tab does not fetch');click(r,'精选推荐');assert.equal(r.categories.length,0,'hidden random does not mount loader');
 r.update({active:true});assert.equal(r.requests.length,rankCount);assert.equal(r.categories.length,1);assert.deepEqual(r.categories[0].args,['ai-duanju',1,20,'random']);r.categories[0].resolve({items:[card(1),card(2,['古风'])],pagination:{page:1,pages:2,total:3}});await r.settle();assert.equal(component(r,'Masonry').props.videos.length,2);assert(r.observers.length>0);
 const oldObserver=r.observers.at(-1);r.update({active:false});assert(oldObserver.disconnected);oldObserver.callback([{isIntersecting:true}]);r.flush();assert.equal(r.categories.length,1,'inactive observer cannot fetch next page');r.update({active:true});assert.equal(r.categories.length,1,'random data retained while inactive');
 click(r,'校园');assert.equal(component(r,'Empty').props.title,'当前已加载内容暂无匹配');component(r,'Empty').props.onAction();r.flush();assert.deepEqual(r.categories[1].args,['ai-duanju',2,20,'random']);r.categories[1].resolve({items:[card(3,['校园'])],pagination:{page:2,pages:2,total:3}});await r.settle();assert.equal(component(r,'Masonry').props.videos.length,1);component(r,'Masonry').props.onOpen(card(3,['校园']));assert.equal(r.navigation.at(-1).kind,'feed');assert.equal(r.navigation.at(-1).videoIds.join(','),'3');
 click(r,'换一批');assert.deepEqual(r.categories[2].args,['ai-duanju',1,20,'random']);r.categories[2].reject(Error('random offline'));await r.settle();assert.equal(component(r,'Empty').props.title,'random offline');component(r,'Empty').props.onAction();r.flush();assert.deepEqual(r.categories[3].args,['ai-duanju',1,20,'random']);
 click(r,'热播榜');const categoryCount=r.categories.length;assert.equal(r.requests.at(-1).kind,'hot');r.categories[3].resolve({items:[card(888)],pagination:{page:1,pages:1,total:1}});r.requests.at(-1).resolve({items:[rank(123)]});await r.settle();assert.equal(rows(r)[0].props.item.video_id,123);assert.equal(r.categories.length,categoryCount);
 const before=r.navigation.length;nodes(r.tree).find(n=>n.type==='button'&&n.props['aria-label']==='专题').props.onClick();assert.equal(r.navigation[before].kind,'topics');nodes(r.tree).find(n=>n.type==='button'&&n.props['aria-label']==='搜索').props.onClick();assert.equal(r.tabs.at(-1),'search');assert(!r.navigation.some(n=>n.kind==='ranks'),'ranking tabs never push a separate page');
 console.log('PASS actual Home, RankRow, Masonry and useChannelVideos with synthetic offline API');
 console.log('PASS default hot; recommend/potential mapping; source rank/order/metric; direct homepage display; feed navigation');
 console.log('PASS rapid tab race, inactive/no hidden requests, completed rank retention, errors/empty/retry');
 console.log('PASS random lazy load, exact sort=random, topic filter, pagination, refresh/retry, stale response, inactive observer');
 console.log('PASS no category crawl during all ranking scenarios; preserved topics/search');
})().catch(e=>{console.error(e);process.exitCode=1});
