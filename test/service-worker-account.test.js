const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../frontend/public/sw.js'),'utf8');
function setup(){
 const handlers={},deleted=[];
 vm.runInNewContext(source,{URL,self:{location:{origin:'https://play.wleeaf.dev'},addEventListener:(name,fn)=>handlers[name]=fn,clients:{claim(){}},skipWaiting(){}},caches:{keys:async()=>['taccan-v3','taccan-v4-native-account','wordmurmur-v1','murmur-v0','murmur-v1','workbox-precache-simultana'],delete:async key=>deleted.push(key)}});
 return {handlers,deleted};
}
test('Murmur service worker never intercepts shared identity or another game',()=>{
 const {handlers}=setup();
 for(const path of ['/account/me','/account/client.js','/simultana/assets/app.js','/taccan/','/murmur/api/rooms','/murmur/socket.io/'])handlers.fetch({request:{method:'GET',url:'https://play.wleeaf.dev'+path},respondWith(){assert.fail('Private or out-of-scope request intercepted: '+path)}});
});
test('Murmur cache upgrades preserve other games and clear its old identity cache',async()=>{
 const {handlers,deleted}=setup();let work;
 handlers.activate({waitUntil:p=>work=p});await work;
 assert.deepEqual(deleted,['taccan-v3','taccan-v4-native-account','wordmurmur-v1','murmur-v0']);
});

test('offline room links reuse the cached application entry point', async () => {
 let handler;
 const shell = { status: 200, body: 'cached game' };
 vm.runInNewContext(source, {
  URL,
  self: {
   location: { origin: 'https://play.wleeaf.dev' },
   registration: { scope: 'https://play.wleeaf.dev/murmur/' },
   addEventListener: (name, fn) => { if (name === 'fetch') handler = fn; },
  },
  fetch: async () => { throw new Error('offline'); },
  caches: { match: async key => key === 'https://play.wleeaf.dev/murmur/' ? shell : undefined },
 });
 let response;
 handler({request:{method:'GET',url:'https://play.wleeaf.dev/murmur/room/ABCD',mode:'navigate'},respondWith:promise=>response=promise});
 assert.equal(await response, shell);
});
