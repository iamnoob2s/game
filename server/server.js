const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const MAX_MESSAGE_SIZE = 2048; // Max message size in bytes
const RATE_LIMIT_MESSAGES = 60; // Max messages per second
const RATE_LIMIT_WINDOW = 1000; // 1 second window
const WORLD_BOUNDS = { minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 };
const MAX_MOVE_SPEED = 10; // Max distance per move message

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      players: Object.keys(allPlayers).length,
      parties: Object.keys(parties).length,
      publicGames: Object.keys(games).filter(id => games[id].isPublic).length
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocket.Server({ server, maxPayload: MAX_MESSAGE_SIZE });

// ============ GAME DEFINITIONS ============
const WEAPONS = {
  sword: { name: 'Sword', baseDamage: 10, baseSpeed: 1, baseScale: 1, baseCooldown: 1000, baseLifetime: 500, baseAmount: 1, cost: 0 },
  axe: { name: 'Axe', baseDamage: 25, baseSpeed: 0.7, baseScale: 1.5, baseCooldown: 1500, baseLifetime: 600, baseAmount: 1, cost: 100 },
  spear: { name: 'Spear', baseDamage: 15, baseSpeed: 1.5, baseScale: 0.8, baseCooldown: 800, baseLifetime: 700, baseAmount: 1, cost: 150 },
  boomerang: { name: 'Boomerang', baseDamage: 12, baseSpeed: 2, baseScale: 0.6, baseCooldown: 1200, baseLifetime: 1500, baseAmount: 1, cost: 200 },
  hammer: { name: 'Hammer', baseDamage: 50, baseSpeed: 0.5, baseScale: 2, baseCooldown: 2500, baseLifetime: 400, baseAmount: 1, cost: 500 },
  shuriken: { name: 'Shuriken', baseDamage: 5, baseSpeed: 3, baseScale: 0.4, baseCooldown: 300, baseLifetime: 800, baseAmount: 3, cost: 300 },
  staff: { name: 'Staff', baseDamage: 30, baseSpeed: 1.2, baseScale: 1.2, baseCooldown: 1800, baseLifetime: 1000, baseAmount: 2, cost: 750 },
  scythe: { name: 'Scythe', baseDamage: 40, baseSpeed: 0.8, baseScale: 1.8, baseCooldown: 2000, baseLifetime: 600, baseAmount: 1, cost: 1000 }
};

const MUTATIONS = {
  explosive: { name: 'Explosive', description: 'Projectiles explode on hit', damageBonus: 1.5, cost: 500 },
  piercing: { name: 'Piercing', description: 'Projectiles pass through enemies', cost: 400 },
  homing: { name: 'Homing', description: 'Projectiles track nearest enemy', cost: 600 },
  split: { name: 'Split', description: 'Projectiles split into 2 on hit', cost: 800 },
  vampiric: { name: 'Vampiric', description: 'Heal 10% of damage dealt', cost: 700 },
  frozen: { name: 'Frozen', description: 'Slow enemies on hit', cost: 450 },
  chain: { name: 'Chain', description: 'Damage chains to nearby enemies', cost: 900 },
  critical: { name: 'Critical', description: '20% chance for 3x damage', cost: 550 }
};

const ENEMY_TYPES = [
  { name: 'Slime', hp: 20, speed: 0.5, damage: 5, xpReward: 10, goldReward: 5, size: 15 },
  { name: 'Goblin', hp: 40, speed: 1, damage: 10, xpReward: 20, goldReward: 12, size: 18 },
  { name: 'Skeleton', hp: 60, speed: 0.8, damage: 15, xpReward: 35, goldReward: 20, size: 20 },
  { name: 'Orc', hp: 100, speed: 0.6, damage: 25, xpReward: 50, goldReward: 35, size: 25 },
  { name: 'Demon', hp: 150, speed: 1.2, damage: 30, xpReward: 80, goldReward: 50, size: 22 },
  { name: 'Dragon', hp: 300, speed: 0.4, damage: 50, xpReward: 150, goldReward: 100, size: 35 },
  { name: 'Boss', hp: 1000, speed: 0.3, damage: 80, xpReward: 500, goldReward: 300, size: 50 }
];

const VALID_UPGRADE_STATS = ['damage', 'scale', 'speed', 'lifetime', 'cooldown', 'amount'];
const MAX_UPGRADE_LEVEL = 50;

// ============ GLOBAL STATE ============
const allPlayers = {}; // All connected players (not yet in a game)
const parties = {};    // Party code -> { id, code, leaderId, members[], mode, maxSize }
const games = {};      // Game ID -> { id, mode, players{}, enemies[], wave, ... }
let nextPlayerId = 1;
let nextGameId = 1;
let enemyIdCounter = 0;

// ============ UTILITY ============
function generatePartyCode() {
  // Generate a 6-character alphanumeric code
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function generateGameId() {
  return `game_${nextGameId++}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeName(name) {
  return (String(name) || '').slice(0, 20).replace(/[<>&"'/\\]/g, '').trim() || 'Player';
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcastToGame(gameId, message, excludeId) {
  const game = games[gameId];
  if (!game) return;
  const data = JSON.stringify(message);
  Object.values(game.players).forEach(p => {
    if (p.id !== excludeId && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  });
}

function broadcastToParty(partyCode, message, excludeId) {
  const party = parties[partyCode];
  if (!party) return;
  const data = JSON.stringify(message);
  party.members.forEach(playerId => {
    const player = allPlayers[playerId];
    if (player && player.id !== excludeId && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  });
}

// ============ SERVER-SIDE DAMAGE CALCULATION ============
function calculatePlayerDamage(player, weaponIndex) {
  const weapon = player.weapons[weaponIndex];
  if (!weapon) return 0;
  const def = WEAPONS[weapon.type];
  if (!def) return 0;
  let baseDmg = def.baseDamage + (weapon.upgrades.damage || 0) * 5;
  // Apply critical mutation chance
  if (weapon.mutations.includes('critical') && Math.random() < 0.2) {
    baseDmg *= 3;
  }
  // Apply explosive mutation bonus
  if (weapon.mutations.includes('explosive')) {
    baseDmg *= 1.5;
  }
  return Math.floor(baseDmg);
}

// ============ PLAYER MANAGEMENT ============
function createPlayer(ws) {
  const id = nextPlayerId++;
  const player = {
    id,
    ws,
    name: `Player${id}`,
    x: 400 + Math.random() * 200 - 100,
    y: 300 + Math.random() * 200 - 100,
    hp: 100,
    maxHp: 100,
    level: 1,
    xp: 0,
    xpToNext: 50,
    gold: 0,
    weapons: [{ type: 'sword', level: 1, upgrades: { scale: 0, speed: 0, lifetime: 0, cooldown: 0, amount: 0, damage: 0 }, mutations: [] }],
    activeWeaponIndex: 0,
    stats: { enemiesKilled: 0, damageDealt: 0, highestWave: 1, pvpKills: 0, pvpDeaths: 0 },
    gameId: null,
    partyCode: null,
    lastMoveTime: 0,
    messageCount: 0,
    messageWindowStart: Date.now(),
    lastAttackTime: 0
  };
  allPlayers[id] = player;
  return player;
}

function getPlayerData(player) {
  return {
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    hp: player.hp,
    maxHp: player.maxHp,
    level: player.level,
    xp: player.xp,
    xpToNext: player.xpToNext,
    gold: player.gold,
    weapons: player.weapons,
    activeWeaponIndex: player.activeWeaponIndex,
    stats: player.stats
  };
}

// ============ RATE LIMITING ============
function checkRateLimit(player) {
  const now = Date.now();
  if (now - player.messageWindowStart > RATE_LIMIT_WINDOW) {
    player.messageCount = 0;
    player.messageWindowStart = now;
  }
  player.messageCount++;
  return player.messageCount <= RATE_LIMIT_MESSAGES;
}

// ============ PARTY SYSTEM ============
function createParty(player) {
  if (player.partyCode) return { success: false, reason: 'Already in a party' };
  if (player.gameId) return { success: false, reason: 'Leave your current game first' };

  const code = generatePartyCode();
  parties[code] = {
    code,
    leaderId: player.id,
    members: [player.id],
    maxSize: 8
  };
  player.partyCode = code;
  return { success: true, code, party: getPartyData(code) };
}

function joinParty(player, code) {
  if (player.partyCode) return { success: false, reason: 'Already in a party' };
  if (player.gameId) return { success: false, reason: 'Leave your current game first' };

  const upperCode = String(code).toUpperCase().trim();
  const party = parties[upperCode];
  if (!party) return { success: false, reason: 'Party not found' };
  if (party.members.length >= party.maxSize) return { success: false, reason: 'Party is full' };

  party.members.push(player.id);
  player.partyCode = upperCode;

  // Notify party members
  broadcastToParty(upperCode, {
    type: 'partyMemberJoined',
    player: { id: player.id, name: player.name }
  }, player.id);

  return { success: true, code: upperCode, party: getPartyData(upperCode) };
}

function leaveParty(player) {
  if (!player.partyCode) return { success: false, reason: 'Not in a party' };

  const code = player.partyCode;
  const party = parties[code];
  if (!party) {
    player.partyCode = null;
    return { success: true };
  }

  party.members = party.members.filter(id => id !== player.id);
  player.partyCode = null;

  if (party.members.length === 0) {
    delete parties[code];
  } else {
    // Transfer leadership if leader left
    if (party.leaderId === player.id) {
      party.leaderId = party.members[0];
    }
    broadcastToParty(code, {
      type: 'partyMemberLeft',
      playerId: player.id,
      newLeaderId: party.leaderId
    });
  }

  return { success: true };
}

function getPartyData(code) {
  const party = parties[code];
  if (!party) return null;
  return {
    code: party.code,
    leaderId: party.leaderId,
    members: party.members.map(id => {
      const p = allPlayers[id];
      return p ? { id: p.id, name: p.name, level: p.level } : null;
    }).filter(Boolean),
    maxSize: party.maxSize
  };
}

// ============ GAME MANAGEMENT ============
// Modes: 'pve' (co-op vs enemies), 'pvp' (players fight each other), 'public' (open PvE anyone can join)
function createGame(mode, isPublic, creatorIds) {
  const gameId = generateGameId();
  const game = {
    id: gameId,
    mode, // 'pve', 'pvp', 'public'
    isPublic,
    players: {},
    enemies: [],
    wave: 1,
    waveTimer: null,
    gameActive: false,
    maxPlayers: mode === 'pvp' ? 8 : 12,
    createdAt: Date.now()
  };
  games[gameId] = game;

  // Add creator players
  creatorIds.forEach(playerId => {
    const player = allPlayers[playerId];
    if (player) {
      addPlayerToGame(player, gameId);
    }
  });

  startGameInstance(gameId);
  return gameId;
}

function addPlayerToGame(player, gameId) {
  const game = games[gameId];
  if (!game) return false;
  if (Object.keys(game.players).length >= game.maxPlayers) return false;

  player.gameId = gameId;
  player.x = 400 + Math.random() * 200 - 100;
  player.y = 300 + Math.random() * 200 - 100;
  player.hp = player.maxHp;
  game.players[player.id] = player;

  // Send game init to this player
  send(player.ws, {
    type: 'gameInit',
    gameId,
    mode: game.mode,
    isPublic: game.isPublic,
    player: getPlayerData(player),
    weapons: WEAPONS,
    mutations: MUTATIONS,
    enemyTypes: ENEMY_TYPES,
    otherPlayers: Object.values(game.players).filter(p => p.id !== player.id).map(getPlayerData),
    enemies: game.enemies.map(e => ({ id: e.id, type: e.type, name: e.name, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, speed: e.speed, damage: e.damage, size: e.size })),
    wave: game.wave,
    gameActive: game.gameActive
  });

  // Notify others in game
  broadcastToGame(gameId, { type: 'playerJoined', player: getPlayerData(player) }, player.id);
  return true;
}

function removePlayerFromGame(player) {
  const gameId = player.gameId;
  if (!gameId) return;
  const game = games[gameId];
  if (!game) { player.gameId = null; return; }

  delete game.players[player.id];
  player.gameId = null;

  broadcastToGame(gameId, { type: 'playerLeft', id: player.id });

  // Clean up empty games
  if (Object.keys(game.players).length === 0) {
    stopGameInstance(gameId);
    delete games[gameId];
  }
}

function findPublicGame() {
  // Find an existing public game with space
  for (const gameId of Object.keys(games)) {
    const game = games[gameId];
    if (game.isPublic && game.mode !== 'pvp' && Object.keys(game.players).length < game.maxPlayers) {
      return gameId;
    }
  }
  return null;
}

// ============ GAME INSTANCE LOGIC ============
function startGameInstance(gameId) {
  const game = games[gameId];
  if (!game || game.gameActive) return;
  game.gameActive = true;
  game.wave = 1;
  game.enemies = [];

  if (game.mode === 'pve' || game.mode === 'public') {
    spawnWaveForGame(gameId);
    game.waveTimer = setInterval(() => {
      if (game.enemies.length === 0 && game.gameActive) {
        game.wave++;
        Object.values(game.players).forEach(p => {
          if (p.stats.highestWave < game.wave) p.stats.highestWave = game.wave;
        });
        spawnWaveForGame(gameId);
      }
    }, 2000);
  }
  // PvP mode doesn't spawn enemies - players fight each other
}

function stopGameInstance(gameId) {
  const game = games[gameId];
  if (!game) return;
  game.gameActive = false;
  game.enemies = [];
  if (game.waveTimer) {
    clearInterval(game.waveTimer);
    game.waveTimer = null;
  }
}

function spawnWaveForGame(gameId) {
  const game = games[gameId];
  if (!game) return;

  const wave = game.wave;
  const enemyCount = Math.min(5 + wave * 2, 50);
  const maxEnemyType = Math.min(Math.floor(wave / 3), ENEMY_TYPES.length - 1);

  for (let i = 0; i < enemyCount; i++) {
    const typeIndex = Math.min(Math.floor(Math.random() * (maxEnemyType + 1)), ENEMY_TYPES.length - 1);
    const type = ENEMY_TYPES[typeIndex];
    const waveMultiplier = 1 + (wave - 1) * 0.15;

    const angle = Math.random() * Math.PI * 2;
    const dist = 500 + Math.random() * 200;

    const enemy = {
      id: enemyIdCounter++,
      type: typeIndex,
      name: type.name,
      x: 400 + Math.cos(angle) * dist,
      y: 300 + Math.sin(angle) * dist,
      hp: Math.floor(type.hp * waveMultiplier),
      maxHp: Math.floor(type.hp * waveMultiplier),
      speed: type.speed,
      damage: Math.floor(type.damage * waveMultiplier),
      xpReward: Math.floor(type.xpReward * waveMultiplier),
      goldReward: Math.floor(type.goldReward * waveMultiplier),
      size: type.size
    };
    game.enemies.push(enemy);
  }

  broadcastToGame(gameId, {
    type: 'waveStart',
    wave,
    enemies: game.enemies.map(e => ({ id: e.id, type: e.type, name: e.name, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, speed: e.speed, damage: e.damage, size: e.size }))
  });
}

// ============ GAME ACTIONS ============
function handleDamageEnemy(player, enemyId) {
  const game = games[player.gameId];
  if (!game) return;

  const enemy = game.enemies.find(e => e.id === enemyId);
  if (!enemy) return;

  // Server calculates damage instead of trusting client
  const damage = calculatePlayerDamage(player, player.activeWeaponIndex);
  if (damage <= 0) return;

  // Validate attack cooldown server-side
  const weapon = player.weapons[player.activeWeaponIndex];
  if (!weapon) return;
  const def = WEAPONS[weapon.type];
  const cooldown = Math.max(100, def.baseCooldown - (weapon.upgrades.cooldown || 0) * 80);
  const now = Date.now();
  if (now - player.lastAttackTime < cooldown * 0.5) return; // Allow some tolerance
  player.lastAttackTime = now;

  enemy.hp -= damage;
  player.stats.damageDealt += damage;

  if (enemy.hp <= 0) {
    player.xp += enemy.xpReward;
    player.gold += enemy.goldReward;
    player.stats.enemiesKilled++;

    // Level up check
    while (player.xp >= player.xpToNext) {
      player.xp -= player.xpToNext;
      player.level++;
      player.maxHp += 10;
      player.hp = player.maxHp;
      player.xpToNext = Math.floor(50 * Math.pow(1.3, player.level - 1));
      send(player.ws, { type: 'levelUp', level: player.level, maxHp: player.maxHp, xpToNext: player.xpToNext });
    }

    game.enemies = game.enemies.filter(e => e.id !== enemyId);
    broadcastToGame(player.gameId, { type: 'enemyDied', enemyId, killerId: player.id, xp: enemy.xpReward, gold: enemy.goldReward });
    send(player.ws, { type: 'reward', xp: enemy.xpReward, gold: enemy.goldReward, totalXp: player.xp, totalGold: player.gold });
  } else {
    broadcastToGame(player.gameId, { type: 'enemyHit', enemyId, hp: enemy.hp, damage });
  }
}

function handlePvPAttack(attacker, targetId) {
  const game = games[attacker.gameId];
  if (!game || game.mode !== 'pvp') return;

  const target = game.players[targetId];
  if (!target || target.id === attacker.id) return;

  const damage = calculatePlayerDamage(attacker, attacker.activeWeaponIndex);
  if (damage <= 0) return;

  // Cooldown check
  const weapon = attacker.weapons[attacker.activeWeaponIndex];
  if (!weapon) return;
  const def = WEAPONS[weapon.type];
  const cooldown = Math.max(100, def.baseCooldown - (weapon.upgrades.cooldown || 0) * 80);
  const now = Date.now();
  if (now - attacker.lastAttackTime < cooldown * 0.5) return;
  attacker.lastAttackTime = now;

  target.hp -= damage;
  attacker.stats.damageDealt += damage;

  broadcastToGame(attacker.gameId, {
    type: 'pvpHit',
    attackerId: attacker.id,
    targetId: target.id,
    damage,
    targetHp: target.hp
  });

  if (target.hp <= 0) {
    attacker.stats.pvpKills++;
    target.stats.pvpDeaths++;
    // Respawn target
    target.hp = target.maxHp;
    target.x = 400 + Math.random() * 200 - 100;
    target.y = 300 + Math.random() * 200 - 100;
    target.gold = Math.floor(target.gold * 0.9);

    // Reward attacker
    const reward = Math.floor(20 * attacker.level);
    attacker.gold += reward;
    attacker.xp += reward;

    broadcastToGame(attacker.gameId, {
      type: 'pvpKill',
      killerId: attacker.id,
      victimId: target.id,
      reward
    });

    send(target.ws, { type: 'pvpDeath', hp: target.hp, gold: target.gold, x: target.x, y: target.y });
    send(attacker.ws, { type: 'reward', xp: reward, gold: reward, totalXp: attacker.xp, totalGold: attacker.gold });
  }
}

function handleUpgradeWeapon(player, weaponIndex, stat) {
  if (!VALID_UPGRADE_STATS.includes(stat)) return { success: false, reason: 'Invalid stat' };
  if (typeof weaponIndex !== 'number' || weaponIndex < 0 || weaponIndex >= player.weapons.length) {
    return { success: false, reason: 'Invalid weapon' };
  }
  const weapon = player.weapons[weaponIndex];
  if (!weapon) return { success: false, reason: 'Invalid weapon' };

  const currentLevel = weapon.upgrades[stat] || 0;
  if (currentLevel >= MAX_UPGRADE_LEVEL) return { success: false, reason: 'Max level reached' };
  const cost = Math.floor(50 * Math.pow(1.5, currentLevel));

  if (player.gold < cost) return { success: false, reason: 'Not enough gold' };

  player.gold -= cost;
  weapon.upgrades[stat] = currentLevel + 1;

  return { success: true, gold: player.gold, weapon, cost };
}

function handleBuyWeapon(player, weaponType) {
  if (!WEAPONS[weaponType]) return { success: false, reason: 'Invalid weapon' };
  if (player.weapons.find(w => w.type === weaponType)) return { success: false, reason: 'Already owned' };

  const cost = WEAPONS[weaponType].cost;
  if (player.gold < cost) return { success: false, reason: 'Not enough gold' };

  player.gold -= cost;
  player.weapons.push({
    type: weaponType,
    level: 1,
    upgrades: { scale: 0, speed: 0, lifetime: 0, cooldown: 0, amount: 0, damage: 0 },
    mutations: []
  });

  return { success: true, gold: player.gold, weapons: player.weapons };
}

function handleBuyMutation(player, weaponIndex, mutationType) {
  if (typeof weaponIndex !== 'number' || weaponIndex < 0 || weaponIndex >= player.weapons.length) {
    return { success: false, reason: 'Invalid weapon' };
  }
  const weapon = player.weapons[weaponIndex];
  if (!weapon) return { success: false, reason: 'Invalid weapon' };
  if (!MUTATIONS[mutationType]) return { success: false, reason: 'Invalid mutation' };
  if (weapon.mutations.includes(mutationType)) return { success: false, reason: 'Already has mutation' };

  const cost = MUTATIONS[mutationType].cost;
  if (player.gold < cost) return { success: false, reason: 'Not enough gold' };

  player.gold -= cost;
  weapon.mutations.push(mutationType);

  return { success: true, gold: player.gold, weapon };
}

function handlePlayerHitByEnemy(player, enemyId) {
  const game = games[player.gameId];
  if (!game) return;

  const enemy = game.enemies.find(e => e.id === enemyId);
  if (!enemy) return;

  // Validate proximity - enemy must be close to player
  const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
  if (dist > enemy.size + 50) return; // Too far, reject

  // Server-side damage from enemy stats
  const damage = enemy.damage;
  player.hp -= damage;

  if (player.hp <= 0) {
    player.hp = player.maxHp;
    player.gold = Math.floor(player.gold * 0.9);
    send(player.ws, { type: 'respawn', hp: player.hp, gold: player.gold });
    broadcastToGame(player.gameId, { type: 'playerDied', id: player.id });
  } else {
    send(player.ws, { type: 'hpUpdate', hp: player.hp });
  }
}

// ============ CONNECTION HANDLER ============
wss.on('connection', (ws) => {
  const player = createPlayer(ws);
  console.log(`Player ${player.id} connected`);

  // Send lobby state
  send(ws, {
    type: 'lobbyInit',
    playerId: player.id,
    publicGames: Object.values(games)
      .filter(g => g.isPublic && Object.keys(g.players).length < g.maxPlayers)
      .map(g => ({
        id: g.id,
        mode: g.mode,
        players: Object.keys(g.players).length,
        maxPlayers: g.maxPlayers,
        wave: g.wave
      }))
  });

  ws.on('message', (data) => {
    try {
      // Rate limiting
      if (!checkRateLimit(player)) {
        send(ws, { type: 'error', message: 'Rate limited. Slow down.' });
        return;
      }

      const raw = data.toString();
      if (raw.length > MAX_MESSAGE_SIZE) return;
      const msg = JSON.parse(raw);

      // Validate message type
      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        // ---- LOBBY / PARTY ACTIONS ----
        case 'setName': {
          player.name = sanitizeName(msg.name);
          if (player.gameId) {
            broadcastToGame(player.gameId, { type: 'playerRenamed', id: player.id, name: player.name });
          }
          send(ws, { type: 'nameSet', name: player.name });
          break;
        }

        case 'createParty': {
          const result = createParty(player);
          send(ws, { type: 'createPartyResult', ...result });
          break;
        }

        case 'joinParty': {
          if (!msg.code || typeof msg.code !== 'string') {
            send(ws, { type: 'joinPartyResult', success: false, reason: 'Invalid code' });
            break;
          }
          const result = joinParty(player, msg.code);
          send(ws, { type: 'joinPartyResult', ...result });
          break;
        }

        case 'leaveParty': {
          const result = leaveParty(player);
          send(ws, { type: 'leavePartyResult', ...result });
          break;
        }

        case 'startGame': {
          // Mode: 'pve', 'pvp'
          const mode = ['pve', 'pvp'].includes(msg.mode) ? msg.mode : 'pve';

          if (player.gameId) {
            send(ws, { type: 'error', message: 'Already in a game' });
            break;
          }

          let playerIds = [player.id];

          // If in a party, only leader can start and all party members join
          if (player.partyCode) {
            const party = parties[player.partyCode];
            if (!party) break;
            if (party.leaderId !== player.id) {
              send(ws, { type: 'error', message: 'Only the party leader can start a game' });
              break;
            }
            playerIds = [...party.members];
          }

          const gameId = createGame(mode, false, playerIds);
          // Notify all party members the game started
          if (player.partyCode) {
            broadcastToParty(player.partyCode, { type: 'gameStarted', gameId, mode });
          }
          break;
        }

        case 'joinPublicGame': {
          if (player.gameId) {
            send(ws, { type: 'error', message: 'Already in a game' });
            break;
          }

          let gameId = findPublicGame();
          if (!gameId) {
            // Create a new public game
            gameId = createGame('pve', true, [player.id]);
          } else {
            addPlayerToGame(player, gameId);
          }
          break;
        }

        case 'leaveGame': {
          if (player.gameId) {
            removePlayerFromGame(player);
            send(ws, { type: 'leftGame' });
            // Send lobby state again
            send(ws, {
              type: 'lobbyInit',
              playerId: player.id,
              publicGames: Object.values(games)
                .filter(g => g.isPublic && Object.keys(g.players).length < g.maxPlayers)
                .map(g => ({
                  id: g.id,
                  mode: g.mode,
                  players: Object.keys(g.players).length,
                  maxPlayers: g.maxPlayers,
                  wave: g.wave
                }))
            });
          }
          break;
        }

        // ---- IN-GAME ACTIONS ----
        case 'move': {
          if (!player.gameId) break;
          if (typeof msg.x !== 'number' || typeof msg.y !== 'number') break;
          if (!isFinite(msg.x) || !isFinite(msg.y)) break;

          // Validate movement speed
          const dx = msg.x - player.x;
          const dy = msg.y - player.y;
          const moveDist = Math.sqrt(dx * dx + dy * dy);
          if (moveDist > MAX_MOVE_SPEED) {
            // Clamp to max speed
            const ratio = MAX_MOVE_SPEED / moveDist;
            msg.x = player.x + dx * ratio;
            msg.y = player.y + dy * ratio;
          }

          // Clamp to world bounds
          msg.x = clamp(msg.x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
          msg.y = clamp(msg.y, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY);

          player.x = msg.x;
          player.y = msg.y;
          broadcastToGame(player.gameId, { type: 'playerMoved', id: player.id, x: msg.x, y: msg.y }, player.id);
          break;
        }

        case 'attack': {
          if (!player.gameId) break;
          if (typeof msg.angle !== 'number' || !isFinite(msg.angle)) break;
          broadcastToGame(player.gameId, {
            type: 'playerAttack',
            id: player.id,
            weapon: player.weapons[player.activeWeaponIndex],
            x: player.x,
            y: player.y,
            angle: msg.angle
          }, player.id);
          break;
        }

        case 'damageEnemy': {
          if (!player.gameId) break;
          if (typeof msg.enemyId !== 'number') break;
          handleDamageEnemy(player, msg.enemyId);
          break;
        }

        case 'pvpAttack': {
          if (!player.gameId) break;
          if (typeof msg.targetId !== 'number') break;
          handlePvPAttack(player, msg.targetId);
          break;
        }

        case 'playerHit': {
          if (!player.gameId) break;
          if (typeof msg.enemyId !== 'number') break;
          handlePlayerHitByEnemy(player, msg.enemyId);
          break;
        }

        case 'upgradeWeapon': {
          if (typeof msg.weaponIndex !== 'number' || typeof msg.stat !== 'string') break;
          const upgradeResult = handleUpgradeWeapon(player, msg.weaponIndex, msg.stat);
          send(ws, { type: 'upgradeResult', ...upgradeResult });
          break;
        }

        case 'buyWeapon': {
          if (typeof msg.weaponType !== 'string') break;
          const buyResult = handleBuyWeapon(player, msg.weaponType);
          send(ws, { type: 'buyWeaponResult', ...buyResult });
          break;
        }

        case 'buyMutation': {
          if (typeof msg.weaponIndex !== 'number' || typeof msg.mutationType !== 'string') break;
          const mutResult = handleBuyMutation(player, msg.weaponIndex, msg.mutationType);
          send(ws, { type: 'buyMutationResult', ...mutResult });
          break;
        }

        case 'switchWeapon': {
          if (typeof msg.index !== 'number' || msg.index < 0 || msg.index >= player.weapons.length) break;
          player.activeWeaponIndex = msg.index;
          if (player.gameId) {
            broadcastToGame(player.gameId, { type: 'playerSwitchWeapon', id: player.id, index: msg.index }, player.id);
          }
          break;
        }
      }
    } catch (e) {
      console.error('Message parse error:', e.message);
    }
  });

  ws.on('close', () => {
    console.log(`Player ${player.id} disconnected`);
    if (player.gameId) {
      removePlayerFromGame(player);
    }
    if (player.partyCode) {
      leaveParty(player);
    }
    delete allPlayers[player.id];
  });
});

server.listen(PORT, () => {
  console.log(`Become OP Server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});
