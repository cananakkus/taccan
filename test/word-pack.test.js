const test=require('node:test');
const assert=require('node:assert/strict');
const lifecycle=require('../backend/room-lifecycle');
const {createGameState}=require('../backend/game-engine');
test('rooms use bundled words without remote word-pack fetching',()=>{
 assert.equal(lifecycle({}).fetchWordPack,undefined);
 const game=createGameState();assert.equal(game.board.length,25);
 assert.equal(new Set(game.board.map(c=>c.word)).size,25);
});
