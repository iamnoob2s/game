# ⚔️ Become OP - Progressive Weapon Game

A multiplayer progressive game inspired by "Become OP" in Roblox. Pick weapons, upgrade them, add mutations, and fight enemies or other players with friends!

## Features

- **8 Weapons**: Sword, Axe, Spear, Boomerang, Hammer, Shuriken, Staff, Scythe
- **6 Upgrade Stats**: Damage, Scale, Speed, Lifetime, Cooldown, Amount
- **8 Mutations**: Explosive, Piercing, Homing, Split, Vampiric, Frozen, Chain, Critical
- **Wave-based Progression**: Endless waves of increasingly difficult enemies
- **Party System**: Create or join parties with invite codes to play with friends
- **Game Modes**:
  - **PvE (Co-op)**: Fight waves of enemies together with your party
  - **PvP (Deathmatch)**: Fight other players in arena combat
  - **Public**: Join open PvE games without needing a party code
- **Multiplayer**: Play with friends via WebSocket server
- **Leveling System**: Gain XP, level up, increase max HP
- **Server-side Validation**: Damage calculations, rate limiting, and movement validation

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
4. Click **CONNECT**
5. Create or join a party (optional), select a game mode, and start playing!

## Controls

- **WASD / Arrow Keys**: Move
- **Mouse Click**: Attack in mouse direction
- **1-9 Keys**: Switch weapons
- **B**: Open/Close shop
- **ESC**: Close shop

## Game Modes

### 🐉 PvE (Co-op)
Fight endless waves of enemies with your party. Enemies get stronger each wave. Great for co-op play!

### ⚔️ PvP (Deathmatch)
Fight other players! Kill opponents to earn gold and XP. Players respawn on death but lose 10% gold.

### 🌐 Public
Join an open PvE game without needing a party. Anyone can join! Perfect for solo players looking for teammates.

## Party System

- **Create a Party**: Generate a 6-character party code to share with friends
- **Join a Party**: Enter a code to join an existing party
- **Party Leader**: The creator (or next member if leader leaves) controls game start and mode selection
- Parties support up to 8 members

## Gameplay

1. Connect to the server and enter a name
2. Create/join a party or play solo
3. Choose a game mode (PvE, PvP, or Public)
4. Kill enemies or players to earn gold and XP
5. Open the Shop (B) to upgrade weapons, buy new ones, or add mutations
6. Level up to increase max HP
7. If you die, you respawn but lose 10% of your gold

## Server Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | 3000 | Server port |

## Security

The server includes the following protections:
- **Server-side damage calculation**: Damage is calculated server-side, preventing client manipulation
- **Rate limiting**: 60 messages per second max to prevent spam/DoS
- **Message size limit**: 2KB max payload to prevent memory abuse
- **Movement validation**: Speed and world boundary enforcement
- **Input sanitization**: Player names and all inputs are validated and sanitized
- **Attack cooldown enforcement**: Server validates weapon cooldowns