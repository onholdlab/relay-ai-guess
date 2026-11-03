// Run with: node i18n/check.mjs (Node.js built-ins only).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const source=fs.readFileSync(new URL('js/locale.js',root),'utf8');
const en=JSON.parse(fs.readFileSync(new URL('i18n/en.json',root),'utf8'));
const zh=JSON.parse(fs.readFileSync(new URL('i18n/zh-Hant.json',root),'utf8'));
assert.deepEqual(Object.keys(en).sort(),Object.keys(zh).sort());
for(const data of [en,zh])for(const value of Object.values(data))assert.equal(typeof value,'string');
const jsonStorage=source.includes("JSON.stringify(code)");
async function session({saved,language='en-US',denied=false,unavailable=[],partial=false,search='',stalled=[],stalledBodies=[]}={}){
 const writes=[],timers=new Map(),signals=[];let timerId=0;
 const context={URL,URLSearchParams,AbortController,setTimeout(fn){const id=++timerId;timers.set(id,fn);return id},clearTimeout(id){timers.delete(id)},document:{currentScript:{src:'https://example.test/js/locale.js'}},location:{search},navigator:{language},
 localStorage:{getItem(){if(denied)throw Error('blocked');return saved==null?null:jsonStorage?JSON.stringify(saved):saved},setItem(key,value){if(denied)throw Error('blocked');writes.push([key,value])}},
 fetch:async (url,options)=>{const name=new URL(url).pathname.split('/').pop();signals.push(options?.signal);if(stalled.includes(name))return new Promise(()=>{});if(unavailable.includes(name))throw Error('offline');return{ok:true,json:async()=>stalledBodies.includes(name)?new Promise(()=>{}):name==='en.json'?en:name==='zh-Hant.json'?(partial?{}:zh):{}}}};
 context.window=context;vm.runInNewContext(source,context);
 // Let successful requests settle, then advance only the outstanding timeout clocks.
 for(let i=0;i<20;i++)await Promise.resolve();
 for(const fn of [...timers.values()])fn();
 await context.OHLi18n.ready;assert.equal(timers.size,0);return{api:context.OHLi18n,writes,signals};
}
for(const [language,expected]of [['zh-TW','zh-Hant'],['zh-HK','zh-Hant'],['zh-CN','zh-Hant'],['en-US','en'],['ja-JP','en'],['','en']])assert.equal((await session({language})).api.language,expected);
assert.equal((await session({saved:'en',language:'zh-TW'})).api.language,'en');
assert.equal((await session({saved:'zh',language:'en-US'})).api.language,'zh-Hant');
assert.equal((await session({saved:'zh-Hant'})).api.language,'zh-Hant');
assert.equal((await session({saved:'../bad',language:'zh-TW'})).api.language,'zh-Hant');
const key=Object.keys(en)[0];
let {api,writes}=await session({saved:'zh',partial:true});assert.equal(api.t(key),en[key]);assert.equal(api.t('missing.key'),'missing.key');assert.equal(api.t('toString'),'toString');
({api,writes}=await session({denied:true,language:'zh-TW'}));assert.equal(api.t(key),zh[key]);api.setLanguage('en');assert.equal(api.language,'en');assert.equal(writes.length,0);
({api,writes}=await session());api.setLanguage('zh');assert.equal(writes.length,1);assert.equal(writes[0][1],jsonStorage?'"zh"':'zh');
({api}=await session({saved:'zh',unavailable:['zh-Hant.json']}));assert.equal(api.t(key),en[key]);
({api}=await session({unavailable:['zh-Hant.json','en.json']}));assert.equal(api.t(key),key);
({api}=await session({saved:'it'}));assert.equal(api.language,'it');assert.equal(api.t(key),en[key]);
for(const failure of ['stalled','stalledBodies']){
 const result=await session({saved:'zh',[failure]:['zh-Hant.json']});
 assert.equal(result.api.t(key),en[key]);assert.ok(result.signals.some(signal=>signal?.aborted));
 ({api}=await session({saved:'en',[failure]:['zh-Hant.json']}));assert.equal(api.t(key),en[key]);
 ({api}=await session({[failure]:['zh-Hant.json','en.json']}));assert.equal(api.t(key),key);
}
const parameterKey=Object.keys(en).find(k=>/\{[A-Za-z]/.test(en[k]));if(parameterKey){const names=[...en[parameterKey].matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(m=>m[1]);const params=Object.fromEntries(names.map(name=>[name,7]));({api}=await session());assert.equal(api.t(parameterKey,params),en[parameterKey].replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g,'7'))}
for(const file of ['index.html',...(fs.existsSync(new URL('privacy/index.html',root))?['privacy/index.html']:[])]){const html=fs.readFileSync(new URL(file,root),'utf8');for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);}
console.log(`i18n checks passed: ${Object.keys(en).length} keys; locale selection, blocked storage, fallback, failed/stalled requests and bodies, interpolation and inline script syntax.`);
