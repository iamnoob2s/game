const { WebSocketServer } = require('ws');

const port = Number(process.env.PORT) || 8080;
const wss = new WebSocketServer({ port });

const players = new Map();

function broadcastState() {
  const list = [...players.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y, level: p.level, weapon: p.weapon }));
  const payload = JSON.stringify({ type: 'state', players: list });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

setInterval(broadcastState, 100);

wss.on('connection', (ws) => {
  const id = Math.random().toString(36).slice(2, 10);
  players.set(id, { x: 300, y: 300, level: 1, weapon: 'Blaster' });
  ws.send(JSON.stringify({ type: 'welcome', id }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'state') {
      const p = players.get(id);
      if (!p) return;
      if (typeof msg.x === 'number') p.x = msg.x;
      if (typeof msg.y === 'number') p.y = msg.y;
      if (typeof msg.level === 'number') p.level = msg.level;
      if (typeof msg.weapon === 'string') p.weapon = msg.weapon.slice(0, 20);
    }
  });

  ws.on('close', () => {
    players.delete(id);
  });
});

console.log(`OP Arena backend running on ws://0.0.0.0:${port}`);
