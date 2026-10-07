const params=new URLSearchParams(location.search);
export const isTournament=Boolean(params.get('party')&&params.get('match'));
type Seat={room:string;sessionId:string;reconnectToken:string;name:string;color:string};
let pending:Promise<Seat>|null=null;
export function loadPartySeat():Promise<Seat>{
 if(!pending)pending=fetch(`/party-api/parties/${encodeURIComponent(params.get('party')||'')}/launch?match=${encodeURIComponent(params.get('match')||'')}&game=murmur`,{credentials:'same-origin',signal:AbortSignal.timeout(10000)}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error||'Your assigned match is unavailable');return data}).catch(e=>{pending=null;throw e});
 return pending;
}
export async function savePartyIdentity(identity:{name:string;color:string}){
 const me=await fetch('/party-api/me').then(r=>r.json());
 const r=await fetch(`/party-api/parties/${params.get('party')}/identity`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify(identity)});if(!r.ok)throw Error('Your party identity could not be saved');
}
