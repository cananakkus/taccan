const { DatabaseSync } = require('node:sqlite');
const { timingSafeEqual } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');

// Private server-to-server contract. Browser requests never choose seats or results.
class PartyAdapter {
  constructor({ secret, file, create, restore, capture, result, join, forfeit, connected = () => null, minPlayers = 2, maxPlayers = 4 }) {
    if (!secret || secret.length < 32) throw Error('PARTY_SECRET must contain at least 32 characters');
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.minPlayers = minPlayers; this.maxPlayers = maxPlayers;
    this.secret = secret; this.create = create; this.capture = capture; this.result = result;
    this.join = join; this.forfeit = forfeit; this.connected = connected; this.rooms = new Map(); this.savedAt = new Map();
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, payload TEXT NOT NULL, snapshot TEXT NOT NULL, outcome TEXT);');
    for (const row of this.db.prepare('SELECT * FROM matches').all()) {
      const payload = JSON.parse(row.payload), snapshot = JSON.parse(row.snapshot);
      this.rooms.set(row.id, { payload, room: restore(snapshot), outcome: row.outcome ? JSON.parse(row.outcome) : null });
    }
  }
  save(id, force = false) {
    const record = this.rooms.get(id); if (!record) return;
    const outcome = record.outcome || this.result(record.room);
    if (!force && !outcome && Date.now() - (this.savedAt.get(id) || 0) < 1000) return;
    if (!force && record.outcome) return;
    this.db.prepare('INSERT INTO matches VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot, outcome=excluded.outcome')
      .run(id, JSON.stringify(record.payload), JSON.stringify(this.capture(record.room)), outcome ? JSON.stringify(outcome) : null);
    record.outcome = outcome; this.savedAt.set(id, Date.now());
  }
  authorized(req) {
    const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, '')), expected = Buffer.from(this.secret);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
  async handle(req, res) {
    const url = new URL(req.url, 'http://local');
    if (!url.pathname.startsWith('/_party/')) return false;
    const respond = (status, body) => { res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); };
    if (!this.authorized(req)) { respond(403, {error:'Private game interface'}); return true; }
    try {
      let body = {};
      if (req.method === 'POST') {
        let text = ''; for await (const part of req) { text += part; if (text.length > 8192) throw Error('Request too large'); }
        body = JSON.parse(text || '{}');
      }
      if (req.method === 'POST' && url.pathname === '/_party/matches') {
        if (!/^[a-f0-9-]{36}$/.test(body.id) || !Array.isArray(body.players) || body.players.length < this.minPlayers || body.players.length > this.maxPlayers ||
            new Set(body.players.map(p=>p.id)).size !== body.players.length || body.players.some(p=>!/^[-a-f0-9]{36}$/.test(p.id) || typeof p.name !== 'string' || p.name.length > 18 || !/^#[a-f0-9]{6}$/i.test(p.color) ||
            (p.bot !== undefined && typeof p.bot !== 'boolean') || (p.skill !== undefined && !['easy','normal','hard'].includes(p.skill)))) throw Error('Invalid match roster');
        if (body.players.every(p=>p.bot===true)) throw Error('A match needs at least one human');
        let record = this.rooms.get(body.id);
        if (record && JSON.stringify(record.payload.players.map(p=>p.id)) !== JSON.stringify(body.players.map(p=>p.id))) throw Error('Match roster cannot change');
        if (!record) { record = {payload:body, room:this.create(body), outcome:null}; this.rooms.set(body.id, record); this.save(body.id, true); }
        respond(200, {room:record.room.id || record.room.code}); return true;
      }
      const match = url.pathname.match(/^\/_party\/matches\/([a-f0-9-]{36})(?:\/(join|forfeit))?$/);
      const record = match && this.rooms.get(match[1]);
      if (!record) { respond(404, {error:'Match unavailable'}); return true; }
      if (!match[2] && req.method === 'GET') {
        this.save(match[1]);
        respond(200, {room:record.room.id || record.room.code, result:record.outcome, connected:this.connected(record.room), status:record.outcome?'completed':'active'});
      } else if (match[2] === 'join' && req.method === 'POST') {
        if (record.outcome) throw Error('This match has finished');
        const seat = record.payload.players.find(p=>p.id===body.player);
        if (!seat) throw Error('This seat is not assigned to you');
        if (seat.bot) throw Error('Bots cannot be joined');
        respond(200, this.join(record.room, body.player));
      } else if (match[2] === 'forfeit' && req.method === 'POST') {
        if (!record.payload.players.some(p=>p.id===body.player)) throw Error('Unknown player');
        if (!record.outcome) { this.forfeit(record.room, body.player); this.save(match[1], true); }
        respond(200, {ok:true, result:record.outcome, forfeited:record.room.party?.forfeits.includes(body.player) || false});
      } else respond(405, {error:'Unsupported action'});
    } catch (error) { respond(400, {error:error.message}); }
    return true;
  }
  close() { for (const id of this.rooms.keys()) this.save(id, true); this.db.close(); }
}

module.exports = { PartyAdapter };
