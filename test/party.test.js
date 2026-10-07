const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {mkdirSync,mkdtempSync,rmSync}=require('node:fs');const {join}=require('node:path');
const {io}=require('socket.io-client');const {createApp}=require('../backend/server');
const secret='private'.repeat(8);
const emit=(s,event,data)=>new Promise((resolve,reject)=>{s.timeout(3000).emit(event,data,(error,response)=>error?reject(error):resolve(response))});
test('Murmur private teams protect roles and keycards, score real team wins and survive restarts',async()=>{
 mkdirSync('data',{recursive:true});const dir=mkdtempSync(join(process.cwd(),'data/party-test-')),file=join(dir,'party.sqlite');let app,base;const sockets=[];
 async function boot(){app=createApp({restoreState:false,corsOrigin:'*',partySecret:secret,partyFile:file});await new Promise(r=>app.httpServer.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.httpServer.address().port}
 async function stop(){sockets.splice(0).forEach(s=>s.disconnect());await new Promise(r=>app.io.close(r));clearInterval(app.cleanupInterval);app.party.close()}
 async function call(path,body,auth=true){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(auth?{Authorization:'Bearer '+secret}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
 async function client(){const s=io(base,{transports:['websocket'],forceNew:true,reconnection:false});s.on('state:full',state=>s.snapshot=state);sockets.push(s);await new Promise((r,j)=>{s.once('connect',r);s.once('connect_error',j)});return s}
 const roster=n=>({id:randomUUID(),players:Array.from({length:n},(_,i)=>({id:randomUUID(),name:'Guest '+i,color:'#13acbc'}))});await boot();
 try{
  const payload=roster(4);assert.equal((await call('/_party/matches',payload,false)).status,403);assert.equal((await call('/_party/matches',roster(3))).status,400);
  const code=(await call('/_party/matches',payload)).data.room;const outsider=await client();assert.equal((await emit(outsider,'room:join',{code,name:'Intruder'})).ok,false);
  const players=[],seats=[];for(const p of payload.players){const seat=(await call(`/_party/matches/${payload.id}/join`,{player:p.id})).data;seats.push(seat);const s=await client();assert.equal((await emit(s,'room:rejoin',{code:seat.room,sessionId:seat.sessionId,reconnectToken:seat.reconnectToken,name:p.name})).ok,true);players.push(s)}
  const room=app.rooms.get(code);assert.equal(room.game.phase,'hint');assert.equal(room.players.size,4);
  assert.equal((await emit(outsider,'room:rejoin',{code,sessionId:seats[0].sessionId,reconnectToken:'forged'})).ok,false);
  for(const [event,body]of [['role:set',{role:'spymaster',team:'red'}],['team:set',{team:'blue'}],['game:rematch',{mode:'swap_teams'}],['room:leave',{}],['room:create',{name:'Elsewhere'}]])assert.equal((await emit(players[2],event,body)).ok,false,event);
  assert.equal((await emit(players[2],'player:identity',{name:'Ada Prime',color:'#ab1234'})).ok,true);
  const board=JSON.stringify(room.game.board);await stop();await boot();assert.equal(JSON.stringify(app.rooms.get(code).game.board),board);assert.equal(app.rooms.get(code).players.get(payload.players[2].id).color,'#ab1234');
  players.length=0;for(let i=0;i<4;i++){const s=await client();assert.equal((await emit(s,'room:rejoin',{code,sessionId:seats[i].sessionId,reconnectToken:seats[i].reconnectToken,name:payload.players[i].name})).ok,true);players.push(s)}
  await new Promise(r=>setTimeout(r,30));const spy=players.find(s=>s.snapshot.me.role==='spymaster'&&s.snapshot.me.team===s.snapshot.game.currentTeam),op=players.find(s=>s.snapshot.me.role==='operative'&&s.snapshot.me.team===s.snapshot.game.currentTeam);
  assert.equal(op.snapshot.game.seed,null);assert.equal(op.snapshot.game.board.every(c=>c.color===null),true);assert.equal(spy.snapshot.game.showKeycard,true);
  const assassin=spy.snapshot.game.board.find(c=>c.color==='assassin');assert.equal((await emit(spy,'turn:hint_submit',{word:'unlikelyclue',count:1})).ok,true);assert.equal((await emit(op,'turn:guess',{index:assassin.index})).ok,true);
  const outcome=(await call(`/_party/matches/${payload.id}`)).data.result;assert.equal(outcome.reason,'played');assert.equal(outcome.winners.length,2);assert.ok(outcome.winners.every(id=>app.rooms.get(code).players.get(id).team!==op.snapshot.me.team));
  assert.equal((await call(`/_party/matches/${payload.id}/forfeit`,{player:outcome.winners[0]})).data.forfeited,false);assert.deepEqual((await call(`/_party/matches/${payload.id}`)).data.result,outcome);
  const departed=roster(4);await call('/_party/matches',departed);const forfeit=(await call(`/_party/matches/${departed.id}/forfeit`,{player:departed.players[0].id})).data;assert.equal(forfeit.forfeited,true);assert.deepEqual(forfeit.result.winners,[departed.players[1].id,departed.players[3].id]);
  const larger=roster(8);const largerCode=(await call('/_party/matches',larger)).data.room;
  await call(`/_party/matches/${larger.id}/forfeit`,{player:larger.players[0].id});
  assert.equal(app.rooms.get(largerCode).players.get(larger.players[2].id).role,'spymaster');
  assert.equal((await call(`/_party/matches/${larger.id}`)).data.result,null);
  await call(`/_party/matches/${larger.id}/forfeit`,{player:larger.players[2].id});
  assert.equal(app.rooms.get(largerCode).players.get(larger.players[4].id).role,'spymaster');
  const teamLoss=(await call(`/_party/matches/${larger.id}/forfeit`,{player:larger.players[4].id})).data;
  assert.deepEqual(teamLoss.result.winners,[1,3,5,7].map(i=>larger.players[i].id));
  await stop();await boot();assert.deepEqual((await call(`/_party/matches/${payload.id}`)).data.result,outcome);
 }finally{await stop();rmSync(dir,{recursive:true,force:true})}
});
