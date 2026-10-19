/**
 * Fortissimus — standalone web app entry point.
 *
 * Assets (boards, event cards, tokens, dice, STLs) live in the GitHub repo
 * and are served over raw.githubusercontent.com so the client can load them
 * directly without bundling anything into the Apps Script project.
 */

// Base URL for the repo's asset files. Change the branch here if needed.
var ASSET_BASE = 'https://raw.githubusercontent.com/lanseroo/Fortissimus/main/';

/** Serve the web app. */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Fortissimus')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Include another HTML file's contents (for CSS/JS partials). */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Full raw-URL for a named asset, e.g. assetUrl('ColosseumBoard.png'). */
function assetUrl(name) {
  return ASSET_BASE + name;
}

// ---------------------------------------------------------------------------
// Online rooms (Phase 1). A room is a lobby, then a running game whose actions
// live in a shared log. Room metadata (seats, tokens, status) is in Script
// Properties; the action log is a JSON file in Drive, rewritten under a lock.
// Clients replay the log in order (lockstep), so the server only orders and
// validates actions — it does not run the rules.
// ---------------------------------------------------------------------------

var ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I/L
var ROOM_FACTIONS = ['Blue', 'Green', 'Purple', 'Yellow'];
var ROOM_PREFIX = 'room_';
var ROOM_PRESENCE_EVERY_MS = 10000;   // how often a poll is allowed to rewrite lastSeen

function roomLoad_(id) {
  var raw = PropertiesService.getScriptProperties().getProperty(ROOM_PREFIX + id);
  return raw ? JSON.parse(raw) : null;
}
function roomSave_(room) {
  PropertiesService.getScriptProperties().setProperty(ROOM_PREFIX + room.id, JSON.stringify(room));
}
function roomNewId_() {
  for (var tries = 0; tries < 50; tries++) {
    var id = '';
    for (var i = 0; i < 4; i++) id += ROOM_CODE_CHARS.charAt(Math.floor(Math.random() * ROOM_CODE_CHARS.length));
    if (!roomLoad_(id)) return id;
  }
  throw new Error('Could not make a free room code, try again');
}
function roomSeatFor_(room, token) {
  for (var i = 0; i < room.seats.length; i++) if (room.seats[i].token === token) return room.seats[i];
  throw new Error('This browser is not in that room');
}
function roomNorm_(roomId) { return String(roomId || '').trim().toUpperCase(); }
function roomWithLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function roomPublic_(room) {
  return {
    roomId: room.id, status: room.status, humanCount: room.humanCount, version: room.version,
    seats: room.seats.map(function (s) { return { faction: s.faction, name: s.name, host: !!s.host, lastSeen: s.lastSeen }; })
  };
}

/** Host: make a room with `humanCount` human seats; the host takes `faction`. */
function createRoom(humanCount, faction, name) {
  return roomWithLock_(function () {
    var n = Math.max(1, Math.min(4, Number(humanCount) || 1));
    if (ROOM_FACTIONS.indexOf(faction) < 0) throw new Error('Pick a faction');
    var token = Utilities.getUuid();
    var room = {
      id: roomNewId_(), status: 'lobby', humanCount: n, version: 0, seed: null, logFileId: null,
      seats: [{ faction: faction, name: String(name || 'Host').slice(0, 20), token: token, lastSeen: Date.now(), host: true }]
    };
    roomSave_(room);
    return { roomId: room.id, token: token, faction: faction, humanCount: n };
  });
}

/** Joiner: take an open faction in a lobby that still has a free human seat. */
function joinRoom(roomId, faction, name) {
  return roomWithLock_(function () {
    var room = roomLoad_(roomNorm_(roomId));
    if (!room) throw new Error('No room with that code');
    if (room.status !== 'lobby') throw new Error('That game has already started');
    if (ROOM_FACTIONS.indexOf(faction) < 0) throw new Error('Pick a faction');
    if (room.seats.some(function (s) { return s.faction === faction; })) throw new Error(faction + ' is already taken');
    if (room.seats.length >= room.humanCount) throw new Error('The lobby is full');
    var token = Utilities.getUuid();
    room.seats.push({ faction: faction, name: String(name || 'Player').slice(0, 20), token: token, lastSeen: Date.now(), host: false });
    roomSave_(room);
    return { roomId: room.id, token: token, faction: faction, humanCount: room.humanCount };
  });
}

/** Lobby view (no tokens). Safe to poll. */
function getRoom(roomId) {
  var room = roomLoad_(roomNorm_(roomId));
  if (!room) throw new Error('No room with that code');
  return roomPublic_(room);
}

/**
 * Host starts the game. `heroPool` comes from the client (the hero card list); the server picks the
 * seed and writes the log header, so every screen starts from the same seed and seat set.
 * Factions without a human seat are CPUs.
 */
function startRoom(roomId, token, heroPool) {
  return roomWithLock_(function () {
    var room = roomLoad_(roomNorm_(roomId));
    if (!room) throw new Error('No room with that code');
    var seat = roomSeatFor_(room, token);
    if (!seat.host) throw new Error('Only the host can start the game');
    if (room.status !== 'lobby') throw new Error('Already started');
    var seatConfig = {};
    ROOM_FACTIONS.forEach(function (f) { seatConfig[f] = 'cpu'; });
    room.seats.forEach(function (s) { seatConfig[s.faction] = 'human'; });
    room.seed = Math.floor(Math.random() * 4294967296);
    var header = { v: 1, seed: room.seed, seatConfig: seatConfig, heroPool: heroPool || [] };
    var file = DriveApp.createFile('room_' + room.id + '.json', JSON.stringify({ header: header, log: [] }), MimeType.PLAIN_TEXT);
    room.logFileId = file.getId();
    room.status = 'running';
    room.version = 0;
    roomSave_(room);
    return roomPublic_(room);
  });
}

/**
 * A seat submits one action. The action must come from the seat it names, except `cpuStep`, which
 * only the driver (the first human seat) may submit. The log entry is stored as sent.
 */
function submitAction(roomId, token, action, clientVersion) {
  return roomWithLock_(function () {
    var room = roomLoad_(roomNorm_(roomId));
    if (!room) throw new Error('No room with that code');
    if (room.status !== 'running') throw new Error('The game is not running');
    var seat = roomSeatFor_(room, token);
    if (!action || typeof action.m !== 'string') throw new Error('Bad action');
    var driver = room.seats[0];
    if (action.m === 'cpuStep') {
      if (seat !== driver) throw new Error('Only the driver seat runs the CPUs');
    } else if (action.seat !== seat.faction) {
      throw new Error('It is not your seat to act');
    }
    var file = DriveApp.getFileById(room.logFileId);
    var data = JSON.parse(file.getBlob().getDataAsString());
    data.log.push(action);
    file.setContent(JSON.stringify(data));
    room.version = data.log.length;
    seat.lastSeen = Date.now();
    roomSave_(room);
    // Return the entries the client has not seen yet (its own entry included), so one call both sends and fetches.
    var from = Math.max(0, Math.min(Number(clientVersion) || 0, data.log.length - 1));
    return { version: room.version, from: from, entries: data.log.slice(from) };
  });
}

/**
 * Poll: entries after `version` (the number the client already has). Also a heartbeat for `token`.
 * Returns nothing new when the client is current, and only reads Drive when the version moved.
 */
function getSince(roomId, token, version, wantHeader) {
  var room = roomLoad_(roomNorm_(roomId));
  if (!room) throw new Error('No room with that code');
  var seat = token ? roomSeatFor_(room, token) : null;
  if (seat && Date.now() - seat.lastSeen > ROOM_PRESENCE_EVERY_MS) {
    seat.lastSeen = Date.now();
    roomSave_(room);   // rewrite presence only occasionally, so frequent polls stay cheap
  }
  var have = Number(version) || 0;
  if (room.version <= have && !wantHeader) return { status: room.status, version: room.version, from: have, entries: [], seats: roomPublic_(room).seats };
  var data = JSON.parse(DriveApp.getFileById(room.logFileId).getBlob().getDataAsString());
  return { status: room.status, version: room.version, from: have, header: wantHeader ? data.header : null,
           entries: data.log.slice(have), seats: roomPublic_(room).seats };
}

/** Test from the Apps Script editor: creates a room, joins it, starts it, and polls it once. */
function roomSelfTest() {
  var host = createRoom(2, 'Blue', 'Test host');
  var guest = joinRoom(host.roomId, 'Green', 'Test guest');
  var started = startRoom(host.roomId, host.token, ['Test']);
  submitAction(host.roomId, host.token, { m: 'cpuStep', a: [], seat: 'Blue' });
  var poll = getSince(host.roomId, guest.token, 0);
  Logger.log(JSON.stringify({ host: host.roomId, status: started.status, seats: started.seats, entries: poll.entries.length, header: poll.header }));
  return poll.entries.length === 1 ? 'ok' : 'unexpected entries';
}

/** Host ends the game for everyone. Other screens see status 'ended' on their next poll. */
function endRoom(roomId, token) {
  return roomWithLock_(function () {
    var room = roomLoad_(roomNorm_(roomId));
    if (!room) throw new Error('No room with that code');
    var seat = roomSeatFor_(room, token);
    if (!seat.host) throw new Error('Only the host can end the game');
    room.status = 'ended';
    roomSave_(room);
    return { ok: true };
  });
}

/** Leave a lobby. A joiner frees their seat; the host leaving closes the lobby. Not allowed once started. */
function leaveRoom(roomId, token) {
  return roomWithLock_(function () {
    var id = roomNorm_(roomId);
    var room = roomLoad_(id);
    if (!room) return { ok: true, closed: true };
    var seat = null;
    for (var i = 0; i < room.seats.length; i++) if (room.seats[i].token === token) seat = room.seats[i];
    if (!seat) return { ok: true };
    if (room.status !== 'lobby') throw new Error('The game has started, so you cannot leave it');
    if (seat.host) {
      PropertiesService.getScriptProperties().deleteProperty(ROOM_PREFIX + id);
      return { ok: true, closed: true };
    }
    room.seats = room.seats.filter(function (s) { return s !== seat; });
    roomSave_(room);
    return { ok: true };
  });
}
