# ⚔️ Become OP - Progressive Weapon Game

A multiplayer progressive game inspired by "Become OP" in Roblox. Pick weapons, upgrade them, add mutations, and fight endless waves of enemies with friends!

## Features

- **8 Weapons**: Sword, Axe, Spear, Boomerang, Hammer, Shuriken, Staff, Scythe
- **6 Upgrade Stats**: Damage, Scale, Speed, Lifetime, Cooldown, Amount
- **8 Mutations**: Explosive, Piercing, Homing, Split, Vampiric, Frozen, Chain, Critical
- **Wave-based Progression**: Endless waves of increasingly difficult enemies
- **Multiplayer**: Play with friends via WebSocket server
- **Leveling System**: Gain XP, level up, increase max HP

## Project Structure

```
├── client/
│   └── index.html      # Game client (open directly in browser)
├── server/
│   ├── package.json    # Server dependencies
│   └── server.js       # WebSocket multiplayer backend
└── README.md
```

## How to Run

### Backend Server

```bash
cd server
npm install
npm start
```

The server runs on port 3000 by default. Set the `PORT` environment variable to change it.

### Client

Simply open `client/index.html` in your browser. No hosting required!

1. Open `client/index.html` in your browser
2. Enter your server WebSocket URL (e.g., `ws://your-server-ip:3000`)
3. Enter your player name
4. Click PLAY!

## Controls

- **WASD / Arrow Keys**: Move
- **Mouse Click**: Attack in mouse direction
- **1-9 Keys**: Switch weapons
- **B**: Open/Close shop
- **ESC**: Close shop

## Gameplay

1. Start by killing enemies with your starter Sword
2. Earn gold and XP from kills
3. Open the Shop (B) to upgrade weapons, buy new ones, or add mutations
4. Survive as many waves as possible!
5. If you die, you respawn but lose 10% of your gold

## Server Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | 3000 | Server port |