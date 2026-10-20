import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
const root=new URL('../',import.meta.url);
test('candidate and baseline contain the exact measured engine pairs',()=>{
 for(const [directory,pair] of Object.entries({
  '7eeac96190be191e':['41a8319a4999f486b4883e11f3797f7e915aeee0f0f256fb79bfd177583999b7','7eeac96190be191ec3f87f62ec1a1987660fe4862b1cbe93f7e697796f3c8b42'],
  '621b8bfb41a16f19':['fb05b5483d214e5763ebbed90689d446c0a019d8982cce60367c908caab9739f','621b8bfb41a16f19073853733e43d5323facf485e6f4d6ee465d0264f40913f9']
 }))for(const [i,ext] of ['js','wasm'].entries())assert.equal(createHash('sha256').update(readFileSync(new URL(`docs/engine/${directory}/scummvm.${ext}`,root))).digest('hex'),pair[i]);
});
function load(timing){
 const elements=new Map(),fetches=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{style:{},value:'',addEventListener(){},classList:{add(){},toggle(){}}});return elements.get(id);};
 const document={getElementById:element,querySelector:element,createElement:()=>({}),addEventListener(){},body:{appendChild:script=>document.script=script}};
 const location=new URL(`https://example.github.io/goblins3-audio-test/player.html?edition=cd&timing=${timing}`);
 const window={parent:{postMessage(){}},fetch:async(input,options)=>{fetches.push({input,options});return new Response('ok');}};
 const context={window,document,location,history:{replaceState:(_a,_b,url)=>{context.rewritten=url;}},URL,URLSearchParams,Request,Response,Headers,navigator:{userAgent:'Test',platform:'Test',maxTouchPoints:0},XMLHttpRequest:class{open(){}},innerWidth:800,innerHeight:600,addEventListener(){},setTimeout,clearTimeout,console};
 const html=readFileSync(new URL('docs/player.html',root),'utf8');
 runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
 return {window,document,context,fetches};
}
test('candidate engine is selected under the repository path and timing fix is activated',()=>{const p=load('fixed');assert.match(p.document.script.src,/^\/goblins3-audio-test\/engine\/7eeac96190be191e\/scummvm.js$/);assert.match(p.context.rewritten,/service_timers=1/);});
test('comparison uses unchanged stable bytes, not the candidate engine',()=>{const p=load('baseline');assert.match(p.document.script.src,/\/621b8bfb41a16f19\/scummvm.js$/);assert.equal(p.context.rewritten,undefined);});
test('virtual data requests map to the project subpath, not the account root',async()=>{const p=load('fixed');await p.window.fetch('/data/index.json');assert.equal(p.fetches[0].input,'https://example.github.io/goblins3-audio-test/data/index.json');});
test('test CD storage is isolated and the catalog does not call the working site',()=>{
 assert.match(readFileSync(new URL('docs/cd-library.js',root),'utf8'),/goblins3-audio-test-cd-library/);
 assert.match(readFileSync(new URL('docs/player.html',root),'utf8'),/indexedDB.open\('goblins3-audio-test-cd-library'/);
 assert.deepEqual(JSON.parse(readFileSync(new URL('docs/data/index.json',root),'utf8')).games,{});
});
