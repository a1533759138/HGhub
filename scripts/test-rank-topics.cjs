// Synthetic offline regression; run with npm test or pnpm test.
process.chdir(require("node:path").resolve(__dirname, ".."));
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require(require.resolve('typescript',{paths:[process.cwd()]}));
const noop=()=>{};
function create(file,api){
 const hooks=[],queue=[],effects=[],navigation=[];let pos=0,props,component,tree;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={useState(init){const i=pos++;if(!hooks[i]){const h={v:typeof init==='function'?init():init};h.set=u=>queue.push(()=>{h.v=typeof u==='function'?u(h.v):u});hooks[i]=h}return [hooks[i].v,hooks[i].set]},useRef(init){return hooks[pos++]||=({current:init})},useCallback(fn,deps){const i=pos++;if(!hooks[i]||!same(hooks[i].deps,deps))hooks[i]={deps,fn};return hooks[i].fn},useMemo(fn,deps){const i=pos++;if(!hooks[i]||!same(hooks[i].deps,deps))hooks[i]={deps,v:fn()};return hooks[i].v},useEffect(fn,deps){const i=pos++;if(!hooks[i]||!same(hooks[i].deps,deps)){const old=hooks[i];hooks[i]={deps};effects.push(()=>{old?.cleanup?.();hooks[i].cleanup=fn()})}}};
 const jsx=(type,props,key)=>({type,props:props||{},key});
 const imports={'react':react,'react/jsx-runtime':{jsx,jsxs:jsx},'../api':{api,fmt:String,cover:x=>x},'../store':{useStore:()=>({push:p=>navigation.push(p),searchHist:[],addSearch:noop,clearSearchHist:noop,toast:noop})},'../components/cards':{Masonry:'Masonry',RankRow:'RankRow'},'../components/ui':{Empty:'Empty',Img:'Img'},'./ui':{Img:'Img'},'../icons':new Proxy({},{get:(_,key)=>String(key)})};
 const mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2021}}).outputText,{module:mod,exports:mod.exports,require:id=>{assert(id in imports,id);return imports[id]},console,Date,Set,Map,Promise,Math,navigator:{userAgent:'iPhone'}});
 function render(){pos=0;tree=component(props);while(effects.length)effects.shift()()}
 function flush(){let n=0;while(queue.length){assert(++n<30,'render loop');while(queue.length)queue.shift()();render()}return tree}
 return {exports:mod.exports,navigation,get tree(){return tree},mount(name,p){component=mod.exports[name];props=p;render();flush()},rerender(p){props=p;render();flush()},flush,async settle(){for(let i=0;i<10;i++){await Promise.resolve();flush()}},unmount(){for(const h of hooks)h?.cleanup?.()}};
}
function nodes(root){const out=[];function visit(x){if(Array.isArray(x))x.forEach(visit);else if(x&&typeof x==='object'){out.push(x);visit(x.props?.children)}}visit(root);return out}
const named=(r,name)=>nodes(r.tree).find(n=>typeof n.type==='function'&&n.type.name===name);
const first=(r,type)=>nodes(r.tree).find(n=>n.type===type);
const rows=r=>nodes(r.tree).filter(n=>n.type==='RankRow');
function deferred(){const calls=[];const fn=(...args)=>new Promise((resolve,reject)=>calls.push({args,resolve,reject}));return {calls,fn}}
const item=(id,rank=1)=>({video_id:id,rank,title:'v'+id,cover:'',tags:[],score:9,metric_label:'热力指数',metric_value:100+id});
const topic=id=>({id,slug:'s'+id,title:'topic'+id,cover:'',video_count:81});
const video=id=>({id,title:'v'+id,cover:'',tags:[]});
const range=(start,end,fn)=>Array.from({length:end-start+1},(_,i)=>fn(start+i));
async function rankTest(){
 const d=deferred(),r=create('src/pages/Search.tsx',{rank:d.fn,category(){throw Error('must not crawl category')}});
 r.mount('RankPage',{wide:false,onBack:noop});assert.deepEqual(d.calls[0].args,['hot']);assert.equal(d.calls.length,1);
 d.calls[0].resolve({type:'hot',items:[item(31,3),item(10,1)]});await r.settle();assert.equal(rows(r).map(n=>n.props.item.video_id).join(','),'31,10');assert.equal(rows(r)[0].props.item.rank,3);rows(r)[1].props.onOpen();assert.equal(r.navigation[0].videoIds.join(','),'31,10');assert.equal(r.navigation[0].index,1);
 function tab(label){return nodes(r.tree).find(n=>n.type==='button'&&n.props.children===label)}
 tab('推荐榜').props.onClick();r.flush();assert.deepEqual(d.calls[1].args,['recommend']);tab('飙升榜').props.onClick();r.flush();assert.deepEqual(d.calls[2].args,['potential']);
 d.calls[2].resolve({type:'potential',items:[item(90,6)]});await r.settle();d.calls[1].resolve({type:'recommend',items:[item(99,1)]});await r.settle();assert.equal(rows(r)[0].props.item.video_id,90);
 tab('热播榜').props.onClick();r.flush();d.calls[3].reject(Error('synthetic offline'));await r.settle();assert.equal(first(r,'Empty').props.title,'榜单加载失败');first(r,'Empty').props.onAction();r.flush();assert.deepEqual(d.calls[4].args,['hot']);d.calls[4].resolve({type:'hot',items:[]});await r.settle();assert.equal(first(r,'Empty').props.title,'榜单暂时为空');r.unmount();
 const c=create('src/components/cards.tsx',{});c.mount('RankRow',{item:item(1),metricMax:200,onOpen:noop});const strings=JSON.stringify(c.tree);assert(strings.includes('热力指数'));assert(strings.includes('101'));
 console.log('PASS server rank order/number/metrics/navigation, tab race, errors/retry/empty; no category crawl');
}
async function listTest(){
 const d=deferred(),r=create('src/pages/Topics.tsx',{topics:d.fn});r.mount('TopicsPage',{wide:false,onBack:noop});assert.deepEqual(d.calls[0].args,[1,30]);d.calls[0].resolve({items:range(1,30,topic),pagination:{pages:3,total:81}});await r.settle();assert.equal(d.calls.length,1,'must not preload all pages');
 named(r,'PageFooter').props.onMore();named(r,'PageFooter').props.onMore();r.flush();assert.equal(d.calls.length,2,'guard duplicate page request');assert.deepEqual(d.calls[1].args,[2,30]);d.calls[1].reject(Error('page2 offline'));await r.settle();assert.equal(nodes(r.tree).filter(n=>n.type==='Img').length,30);assert.equal(named(r,'PageFooter').props.error,'page2 offline');named(r,'PageFooter').props.onRetry();r.flush();assert.deepEqual(d.calls[2].args,[2,30]);d.calls[2].resolve({items:range(30,60,topic),pagination:{pages:3,total:81}});await r.settle();assert.equal(nodes(r.tree).filter(n=>n.type==='Img').length,60);
 named(r,'PageFooter').props.onMore();r.flush();assert.deepEqual(d.calls[3].args,[3,30]);d.calls[3].resolve({items:range(61,81,topic),pagination:{pages:3,total:81}});await r.settle();assert.equal(nodes(r.tree).filter(n=>n.type==='Img').length,81);assert.equal(named(r,'PageFooter').props.hasMore,false);named(r,'PageFooter').props.onMore();r.flush();assert.equal(d.calls.length,4);r.unmount();
 console.log('PASS topic list: manual 30/30/21 pagination to 81, failed-page retry, retain items, dedup, busy guard/end');
}
async function detailTest(){
 const d=deferred(),r=create('src/pages/Topics.tsx',{topic:d.fn});let props={slug:'alpha',name:'Alpha',wide:false,onBack:noop};r.mount('TopicPage',props);assert.deepEqual(d.calls[0].args,['alpha',1,20]);props={...props,slug:'beta',name:'Beta'};r.rerender(props);assert.deepEqual(d.calls[1].args,['beta',1,20]);
 d.calls[0].resolve({topic:{...topic(1),title:'STALE ALPHA'},videos:{items:[video(999)],pagination:{pages:1,total:1}}});d.calls[1].resolve({topic:{...topic(2),title:'BETA'},related:[topic(42)],videos:{items:range(1,20,video),pagination:{pages:5,total:81}}});await r.settle();assert.equal(first(r,'Masonry').props.videos.length,20);assert(!JSON.stringify(r.tree).includes('STALE ALPHA'));assert.equal(d.calls.length,2);const relatedButton=nodes(r.tree).find(n=>n.type==='button'&&JSON.stringify(n.props.children).includes('topic42'));assert(relatedButton,'related topic card');relatedButton.props.onClick();assert.equal(r.navigation[0].kind,'topic');assert.equal(r.navigation[0].slug,'s42');assert.equal(r.navigation[0].name,'topic42');assert.equal(d.calls.length,2,'related renders without extra requests');
 named(r,'PageFooter').props.onMore();r.flush();assert.deepEqual(d.calls[2].args,['beta',2,20]);props={...props,slug:'gamma',name:'Gamma'};r.rerender(props);assert(!first(r,'Masonry'),'old videos hidden immediately');assert(!JSON.stringify(r.tree).includes('topic42'),'old related hidden immediately');assert.deepEqual(d.calls[3].args,['gamma',1,20]);
 d.calls[2].resolve({topic:topic(2),videos:{items:[video(888)],pagination:{pages:5,total:81}}});d.calls[3].resolve({topic:topic(3),videos:{items:[],pagination:{pages:0,total:0}}});await r.settle();assert.equal(first(r,'Empty').props.title,'专题为空');assert(!first(r,'Masonry'));
 first(r,'Empty').props.onAction();r.flush();assert.deepEqual(d.calls[4].args,['gamma',1,20]);d.calls[4].reject(Error('refresh offline'));await r.settle();assert.equal(first(r,'Empty').props.title,'专题加载失败');first(r,'Empty').props.onAction();r.flush();assert.deepEqual(d.calls[5].args,['gamma',1,20],'refresh retry must repeat page1');d.calls[5].resolve({topic:topic(3),videos:{items:[video(3)],pagination:{pages:1,total:1}}});await r.settle();assert.equal(first(r,'Masonry').props.videos[0].id,3);r.unmount();
 console.log('PASS topic detail: slug reset, first/later stale response ignored, page+size, empty, refresh failure/retry page1');
}
(async()=>{await rankTest();await listTest();await detailTest();console.log('ALL PASS (synthetic offline API only)')})().catch(e=>{console.error(e);process.exitCode=1});
