const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const {verifyAccountToken}=require('../backend/account');
const secret='test-only-secret';
function token(overrides={},algorithm='HS256') {
 const h=Buffer.from(JSON.stringify({alg:algorithm})).toString('base64url');
 const p=Buffer.from(JSON.stringify({iss:'wleeaf-play',aud:'taccan',sub:'test-player',name:'Player',exp:Math.floor(Date.now()/1000)+300,...overrides})).toString('base64url');
 return h+'.'+p+'.'+createHmac('sha256',secret).update(h+'.'+p).digest('base64url');
}
test('account proof binds player identity to the correct game and signing key',()=>{
 assert.equal(verifyAccountToken(token(),'taccan',secret).id,'test-player');
 assert.equal(verifyAccountToken(token(),'suedocu',secret),null);
 assert.equal(verifyAccountToken(token(),'taccan','wrong-secret'),null);
 assert.equal(verifyAccountToken(token({iss:'other'}),'taccan',secret),null);
 assert.equal(verifyAccountToken(token({},'none'),'taccan',secret),null);
});
test('expired, overlong, malformed and tampered proofs are rejected',()=>{
 for(const value of [token({exp:0}),token({exp:Math.floor(Date.now()/1000)+3600}),token({sub:42}),token()+'.extra','garbage',undefined,'a'.repeat(5000)])assert.equal(verifyAccountToken(value,'taccan',secret),null);
 const good=token();const parts=good.split('.');parts[1]=Buffer.from(JSON.stringify({sub:'someone-else'})).toString('base64url');assert.equal(verifyAccountToken(parts.join('.'),'taccan',secret),null);
});

test('account proofs reject empty identities and non-integer expiry', () => {
 for (const overrides of [{sub:''}, {sub:'   '}, {exp:Math.floor(Date.now()/1000)+0.5}]) {
  assert.equal(verifyAccountToken(token(overrides),'taccan',secret),null);
 }
});
