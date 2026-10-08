const {PartyAdapter}=require('./party-adapter.cjs');
const {restoreRooms}=require('./state-persistence');
const {finishGame}=require('./game-engine');
const {createBotDriver}=require('./bots');

function createPartySupport(ctx,{secret,file,botDelayScale=1}){
 const {rooms,helpers,io}=ctx;let adapter,starting=false,closed=false;
 // The game server plays every bot seat; bots count as permanently connected.
 const bots=createBotDriver(ctx,{delayScale:botDelayScale});
 const humansLeft=room=>[...room.players.values()].some(p=>!p.bot&&!room.party.forfeits.includes(p.sessionId));
 const capture=room=>({code:room.code,createdAt:room.createdAt,lastActiveAt:room.lastActiveAt,hostSessionId:room.hostSessionId,mode:room.mode,match:room.match,chatMessages:room.chatMessages,party:room.party,
  players:[...room.players.values()].map(p=>({...p,connected:false,socketId:null,lastSeenAt:Date.now()})),
  game:room.game?{...room.game,phaseTimer:null,marksByCard:room.game.marksByCard.map(s=>[...s])}:null});
 adapter=new PartyAdapter({secret,file,minPlayers:4,maxPlayers:8,
  create:payload=>{const code=helpers.createRoomCode(),room={code,createdAt:Date.now(),lastActiveAt:Date.now(),hostSessionId:(payload.players.find(p=>!p.bot)||payload.players[0]).id,players:new Map(),mode:'casual',match:null,game:null,chatMessages:[],party:{match:payload.id,members:payload.players.map(p=>p.id),forfeits:[]}};
   for(let i=0;i<payload.players.length;i++){const member=payload.players[i],player=helpers.createPlayer(member.name,null);Object.assign(player,{sessionId:member.id,name:member.name,color:member.color,connected:member.bot===true,team:i%2?'blue':'red',role:i<2?'spymaster':'operative'});
    if(member.bot===true)Object.assign(player,{bot:true,skill:member.skill||'normal'});room.players.set(member.id,player)}rooms.set(code,room);return room;},
  restore:saved=>{const room=restoreRooms([saved]).get(saved.code);room.players.forEach(p=>{p.connected=Boolean(p.bot);p.socketId=null});rooms.set(room.code,room);return room;},capture,
  result:room=>room.game?.phase==='finished'?{winners:[...room.players.values()].filter(p=>p.team===room.game.winner&&!room.party.forfeits.includes(p.sessionId)).map(p=>p.sessionId),draw:!room.game.winner,reason:room.game.reason==='forfeit'?'forfeit':'played'}:null,
  connected:room=>[...room.players.values()].filter(p=>p.bot||(p.connected&&!room.party.forfeits.includes(p.sessionId))).map(p=>p.sessionId),
  join:(room,id)=>{const player=room.players.get(id);if(player?.bot)throw Error('Bots cannot be joined');if(!player||room.party.forfeits.includes(id))throw Error('This seat was forfeited');return {room:room.code,sessionId:id,reconnectToken:player.reconnectToken}},
  forfeit:(room,id)=>{
   if(room.game?.phase==='finished'||room.party.forfeits.includes(id))return;
   const player=room.players.get(id);if(!player)return;room.party.forfeits.push(id);helpers.handleVoiceLeave(room,player);
   const socket=io.sockets.sockets.get(player.socketId);if(socket){helpers.clearSocketBinding(socket);socket.disconnect(true)}player.socketId=null;player.connected=false;
   const team=[...room.players.values()].filter(p=>p.team===player.team&&!room.party.forfeits.includes(p.sessionId));
   if(!room.game&&team.length<2){helpers.startNewRound(room,'party_forfeit')}
   if(room.game&&team.length<2){finishGame(room.game,player.team==='red'?'blue':'red',player.team,'forfeit');helpers.clearPhaseTimerState(room)}
   else if(player.role==='spymaster'&&team.length)team[0].role='spymaster';
   // Without humans the round ends now: the remaining bots play it out instantly.
   if(!humansLeft(room)&&room.game?.phase!=='finished'){if(!room.game){starting=true;try{helpers.startNewRound(room,'party_forfeit')}finally{starting=false}}bots.finishWithoutHumans(room)}
   helpers.emitStateToRoom(room);
  }
 });
 const emit=helpers.emitStateToRoom;
 helpers.emitStateToRoom=room=>{
  if(room.party&&!closed){
   if(!starting&&!room.game&&[...room.players.values()].every(p=>p.connected||room.party.forfeits.includes(p.sessionId))){starting=true;try{helpers.startNewRound(room,'party')}finally{starting=false}}
   adapter.save(room.party.match,true);
  }
  emit(room);
  if(room.party&&!closed)bots.kick(room);
 };
 for(const record of adapter.rooms.values())bots.kick(record.room);
 const checkpoint=setInterval(()=>{for(const room of rooms.values())if(room.party)adapter.save(room.party.match)},1000);checkpoint.unref();
 function register(socket){socket.on('player:identity',(payload={},callback)=>{
  const body=helpers.preflightAction(socket,'player:identity',payload,callback);if(!body)return;
  const context=helpers.getContext(socket,'player:identity');if(!context?.room.party){helpers.ackError(callback,'Tournament identity is unavailable');return}
  if(body.color!==undefined&&!/^#[a-f0-9]{6}$/i.test(body.color)){helpers.ackError(callback,'Choose a valid color');return}
  if(body.name!==undefined)context.player.name=body.name.trim()||context.player.name;
  if(body.color!==undefined)context.player.color=body.color;
  helpers.emitStateToRoom(context.room);helpers.ackOk(callback,{name:context.player.name,color:context.player.color});
 });}
 return {adapter,register,handle:(req,res)=>adapter.handle(req,res),close(){if(closed)return;closed=true;clearInterval(checkpoint);bots.close();adapter.close()}};
}
module.exports={createPartySupport};
