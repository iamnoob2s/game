const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', players: Object.keys(players).length }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocket.Server({ server });

// Game state
const players = {};
let nextPlayerId = 1;

// Weapon definitions
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

// Mutation definitions
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

// Enemy types that spawn in waves
const ENEMY_TYPES = [
  { name: 'Slime', hp: 20, speed: 0.5, damage: 5, xpReward: 10, goldReward: 5, size: 15 },
  { name: 'Goblin', hp: 40, speed: 1, damage: 10, xpReward: 20, goldReward: 12, size: 18 },
  { name: 'Skeleton', hp: 60, speed: 0.8, damage: 15, xpReward: 35, goldReward: 20, size: 20 },
  { name: 'Orc', hp: 100, speed: 0.6, damage: 25, xpReward: 50, goldReward: 35, size: 25 },
  { name: 'Demon', hp: 150, speed: 1.2, damage: 30, xpReward: 80, goldReward: 50, size: 22 },
  { name: 'Dragon', hp: 300, speed: 0.4, damage: 50, xpReward: 150, goldReward: 100, size: 35 },
  { name: 'Boss', hp: 1000, speed: 0.3, damage: 80, xpReward: 500, goldReward: 300, size: 50 }
];

// Game world enemies (shared state)
let enemies = [];
let enemyIdCounter = 0;
let wave = 1;
let waveTimer = null;
let gameActive = false;

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
    stats: { enemiesKilled: 0, damageDealt: 0, highestWave: 1 }
  };
  players[id] = player;
  return player;
}

function removePlayer(id) {
  delete players[id];
  broadcast({ type: 'playerLeft', id });
  if (Object.keys(players).length === 0) {
    stopGame();
  }
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

function broadcast(message, excludeId) {
  const data = JSON.stringify(message);
  Object.values(players).forEach(p => {
    if (p.id !== excludeId && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  });
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function spawnWave() {
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
    enemies.push(enemy);
  }

  broadcast({ type: 'waveStart', wave, enemies: enemies.map(e => ({ id: e.id, type: e.type, name: e.name, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, speed: e.speed, damage: e.damage, size: e.size })) });
}

function startGame() {
  if (gameActive) return;
  gameActive = true;
  wave = 1;
  enemies = [];
  spawnWave();

  waveTimer = setInterval(() => {
    if (enemies.length === 0 && gameActive) {
      wave++;
      Object.values(players).forEach(p => {
        if (p.stats.highestWave < wave) p.stats.highestWave = wave;
      });
      spawnWave();
    }
  }, 2000);
}

function stopGame() {
  gameActive = false;
  enemies = [];
  if (waveTimer) {
    clearInterval(waveTimer);
    waveTimer = null;
  }
}

function handleDamageEnemy(playerId, enemyId, damage) {
  const enemy = enemies.find(e => e.id === enemyId);
  const player = players[playerId];
  if (!enemy || !player) return;

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

    enemies = enemies.filter(e => e.id !== enemyId);
    broadcast({ type: 'enemyDied', enemyId, killerId: playerId, xp: enemy.xpReward, gold: enemy.goldReward });
    send(player.ws, { type: 'reward', xp: enemy.xpReward, gold: enemy.goldReward, totalXp: player.xp, totalGold: player.gold });
  } else {
    broadcast({ type: 'enemyHit', enemyId, hp: enemy.hp, damage });
  }
}

function handleUpgradeWeapon(player, weaponIndex, stat) {
  const weapon = player.weapons[weaponIndex];
  if (!weapon) return { success: false, reason: 'Invalid weapon' };

  const currentLevel = weapon.upgrades[stat] || 0;
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

wss.on('connection', (ws) => {
  const player = createPlayer(ws);
  console.log(`Player ${player.id} connected`);

  // Send init data
  send(ws, {
    type: 'init',
    player: getPlayerData(player),
    weapons: WEAPONS,
    mutations: MUTATIONS,
    enemyTypes: ENEMY_TYPES,
    otherPlayers: Object.values(players).filter(p => p.id !== player.id).map(getPlayerData),
    enemies: enemies.map(e => ({ id: e.id, type: e.type, name: e.name, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, speed: e.speed, damage: e.damage, size: e.size })),
    wave,
    gameActive
  });

  // Notify others
  broadcast({ type: 'playerJoined', player: getPlayerData(player) }, player.id);

  // Start game if first player
  if (Object.keys(players).length === 1) {
    startGame();
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      switch (msg.type) {
        case 'move':
          player.x = msg.x;
          player.y = msg.y;
          broadcast({ type: 'playerMoved', id: player.id, x: msg.x, y: msg.y }, player.id);
          break;

        case 'attack':
          broadcast({ type: 'playerAttack', id: player.id, weapon: player.weapons[player.activeWeaponIndex], x: msg.x, y: msg.y, angle: msg.angle }, player.id);
          break;

        case 'damageEnemy':
          handleDamageEnemy(player.id, msg.enemyId, msg.damage);
          break;

        case 'upgradeWeapon':
          const upgradeResult = handleUpgradeWeapon(player, msg.weaponIndex, msg.stat);
          send(ws, { type: 'upgradeResult', ...upgradeResult });
          break;

        case 'buyWeapon':
          const buyResult = handleBuyWeapon(player, msg.weaponType);
          send(ws, { type: 'buyWeaponResult', ...buyResult });
          break;

        case 'buyMutation':
          const mutResult = handleBuyMutation(player, msg.weaponIndex, msg.mutationType);
          send(ws, { type: 'buyMutationResult', ...mutResult });
          break;

        case 'switchWeapon':
          player.activeWeaponIndex = msg.index;
          broadcast({ type: 'playerSwitchWeapon', id: player.id, index: msg.index }, player.id);
          break;

        case 'setName':
          player.name = (msg.name || '').slice(0, 20) || player.name;
          broadcast({ type: 'playerRenamed', id: player.id, name: player.name });
          break;

        case 'playerHit':
          player.hp -= msg.damage;
          if (player.hp <= 0) {
            player.hp = player.maxHp;
            player.gold = Math.floor(player.gold * 0.9);
            send(ws, { type: 'respawn', hp: player.hp, gold: player.gold });
            broadcast({ type: 'playerDied', id: player.id });
          }
          break;
      }
    } catch (e) {
      console.error('Message parse error:', e.message);
    }
  });

  ws.on('close', () => {
    console.log(`Player ${player.id} disconnected`);
    removePlayer(player.id);
  });
});

server.listen(PORT, () => {
  console.log(`Become OP Server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});
