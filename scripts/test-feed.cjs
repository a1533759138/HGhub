// Synthetic offline regression; run with npm test or pnpm test.
process.chdir(require("node:path").resolve(__dirname, ".."));
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict'), ts=require('typescript');
const hooks=[],updates=[],effects=[],requests=[];
let pos=0,tree,props={videoIds:[7],mode:'context',active:true,bottomInset:20};
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
const react={
 useState(init){const i=pos++;if(!hooks[i]){const h={value:typeof init==='function'?init():init};h.set=u=>updates.push(()=>{h.value=typeof u==='function'?u(h.value):u});hooks[i]=h}return [hooks[i].value,hooks[i].set]},
 useRef(init){return hooks[pos++]||=( {current:init})},
 useCallback(fn,deps){const i=pos++;if(!hooks[i]||!same(hooks[i].deps,deps))hooks[i]={deps,fn};return hooks[i].fn},
 useMemo(fn,deps){const i=pos++;if(!hooks[i]||!same(hooks[i].deps,deps))hooks[i]={deps,value:fn()};return hooks[i].value},
 useEffect(fn,deps){const i=pos++;if(!hooks[i]||!same(hooks[i].deps,deps)){const old=hooks[i];hooks[i]={deps};effects.push(()=>{old?.cleanup?.();hooks[i].cleanup=fn()})}}
};
const noop=()=>{}, VideoSurface=function VideoSurface(){}, jsx=(type,props,key)=>({type,props:props||{},key});
const store={isLiked:()=>false,isFav:()=>false,toggleLikeLocal:()=>true,toggleFavLocal:()=>true,toggleFollowLocal:()=>true,muted:true,setMuted:noop,volume:.7,setVolume:noop,toast:noop,addHistory:noop,user:null,setLoginOpen:noop,theater:false,setTheater:noop,fs:false,setFs:noop,follows:[]};
const api={video:()=>Promise.resolve({title:'test',episodes:[],counts:{},author:{}}),play:(id,ep)=>new Promise((resolve,reject)=>requests.push({id,ep,resolve,reject}))};
const imports={'react':react,'react/jsx-runtime':{jsx,jsxs:jsx},'../api':{api,cover:x=>x||'',fmt:String,fmtTime:String,isMobile:true,platform:'ios',mediaUrl:x=>x},'../store':{useStore:()=>store},'./ui':{Avatar:'Avatar',Img:'Img',Sheet:'Sheet'},'./VideoSurface':{default:VideoSurface},'./PlayerControls':{default:'PlayerControls'},'./Panels':{ArticlePanel:'ArticlePanel',CommentsPanel:'CommentsPanel',EpisodesPanel:'EpisodesPanel'},'../html':{sanitizeHtml:x=>x},'../back':{setBackHandler:noop},'../icons':new Proxy({},{get:(_,key)=>String(key)})};
const mod={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/Feed.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2021}}).outputText,{module:mod,exports:mod.exports,require:id=>{assert(id in imports,id);return imports[id]},window:{setTimeout:()=>0,clearTimeout:noop,addEventListener:noop,removeEventListener:noop},document:{addEventListener:noop,removeEventListener:noop},navigator:{},requestAnimationFrame:()=>0,cancelAnimationFrame:noop,console,Date,Set,Map,Promise});
function render(){pos=0;tree=mod.exports.default(props);while(effects.length)effects.shift()()}
function flush(){let n=0;while(updates.length){assert(++n<30,'render loop');while(updates.length)updates.shift()();render()}}
async function settle(){for(let i=0;i<8;i++){await Promise.resolve();flush()}}
function nodes(root){const out=[];function visit(x){if(Array.isArray(x))x.forEach(visit);else if(x&&typeof x==='object'){out.push(x);visit(x.props?.children)}}visit(root);return out}
const retry=()=>nodes(tree).find(n=>n.type==='button'&&n.props.children==='重试');
const surface=()=>nodes(tree).find(n=>n.type===VideoSurface);
(async()=>{
 render();flush();assert.equal(requests.length,1);
 requests[0].reject(Error('offline'));await settle();assert(retry());retry().props.onClick();flush();assert.equal(requests.length,2);assert(!retry());
 requests[1].resolve({video_url:'https://invalid.example/same.m3u8'});await settle();assert(surface());const firstKey=surface().key;
 let paused=0,resumed=-1;const handle={pause:()=>paused++,seek:t=>resumed=t,rate:noop,mute:noop,volume:noop};surface().props.ref.current=handle;
 surface().props.onDuration(100);flush();surface().props.onTime(25);surface().props.onPlaying();flush();
 surface().props.onError('fatal');flush();assert(retry());surface().props.onPlaying();flush();assert(!retry());
 surface().props.onError('fatal again');flush();retry().props.onClick();flush();assert.equal(paused,1);assert.equal(requests.length,3);
 requests[2].resolve({video_url:'https://invalid.example/same.m3u8'});await settle();assert.notEqual(surface().key,firstKey);surface().props.ref.current=handle;surface().props.onDuration(100);flush();assert.equal(resumed,25);
 console.log('PASS fetch retry, cleared errors/loading, fatal recovery, same-URL remount, resume at 25 seconds');
 props={...props,videoIds:[8]};render();flush();assert.equal(requests.length,4);requests[3].reject(Error('offline 8'));await settle();assert(retry());retry().props.onClick();flush();assert.equal(requests.length,5);
 props={...props,videoIds:[9],active:false};render();flush();assert.equal(requests.length,6);
 requests[4].resolve({video_url:'https://invalid.example/stale.m3u8'});requests[5].resolve({video_url:'https://invalid.example/current.m3u8'});await settle();assert.equal(surface().props.src,'https://invalid.example/current.m3u8');assert.equal(surface().props.autoPlay,false);
 console.log('PASS old request ignored after navigation; inactive page does not autoplay new source');
})().catch(e=>{console.error(e);process.exitCode=1});
