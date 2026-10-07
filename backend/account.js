const {createHmac,timingSafeEqual}=require('node:crypto');
function verifyAccountToken(token, audience, secret) {
 if (!secret || typeof token !== 'string' || token.length>4096) return null;
 try {
  const [head,body,sig,...extra]=token.split('.');if(extra.length||!head||!body||!sig)return null;
  const header=JSON.parse(Buffer.from(head,'base64url').toString());if(header.alg!=='HS256')return null;
  const expected=createHmac('sha256',secret).update(head+'.'+body).digest();const got=Buffer.from(sig,'base64url');
  if(got.length!==expected.length||!timingSafeEqual(got,expected))return null;
  const p=JSON.parse(Buffer.from(body,'base64url').toString());const now=Math.floor(Date.now()/1000);
  if(p.iss!=='wleeaf-play'||p.aud!==audience||!Number.isInteger(p.exp)||p.exp<=now||p.exp>now+330||typeof p.sub!=='string'||!p.sub.trim()||p.sub.length>100||typeof p.name!=='string')return null;
  return {id:p.sub,name:p.name,expires:p.exp,gatewaySid:p.gatewaySid};
 }catch{return null;}
}
module.exports={verifyAccountToken};

async function accountSessionActive(account,secret,audience) {
 if(!process.env.PLAY_ACCOUNT_SECRET)return true;
 if(typeof account?.gatewaySid!=='string'||!/^[a-f0-9]{64}$/.test(account.gatewaySid))return false;
 try{
  const r=await fetch('http://play-account:3100/account/validate/'+audience,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret},body:JSON.stringify({gatewaySid:account.gatewaySid}),signal:AbortSignal.timeout(5000)});
  return r.ok && (await r.json()).active===true && account.expires*1000>Date.now();
 }catch{return false;}
}

module.exports.accountSessionActive=accountSessionActive;
