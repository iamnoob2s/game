# ⚔️ Become OP - Progressive Weapon Game

A multiplayer progressive game inspired by "Become OP" in Roblox. Pick weapons, upgrade them, add mutations, and fight enemies or other players with friends!

## Architecture

This project has a **separated client and server** architecture:

- **Client** (`client/`): A static HTML/JS game client that can be hosted on any static hosting service (Netlify, Vercel, GitHub Pages, etc.)
- **Server** (`server/`): A WebSocket backend that handles game state, player positions, game logic, and data storage. Deploy on any Node.js hosting (Railway, Render, Fly.io, etc.)

The client connects to the server via WebSocket — you enter the server URL in the client UI.

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
- **Auto-reconnect**: Client automatically reconnects with exponential backoff

## Project Structure

```
├── client/
│   └── index.html      # Game client (host on any static hosting)
├── server/
│   ├── package.json    # Server dependencies
│   └── server.js       # WebSocket multiplayer backend
└── README.md
```

## Deployment

### Server Deployment

The server is a pure WebSocket/HTTP backend with no static file serving. Deploy it on any Node.js platform:

```bash
cd server
npm install
npm start
```

#### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `ALLOWED_ORIGINS` | `*` | Comma-separated list of allowed client origins (e.g. `https://yourgame.netlify.app,https://yourgame.com`) |
| `NODE_ENV` | `development` | Set to `production` in production |

#### Example: Deploy to Railway/Render/Fly.io

1. Push the `server/` directory to your platform
2. Set environment variables:
   ```
   PORT=3000
   ALLOWED_ORIGINS=https://your-client-domain.com
   NODE_ENV=production
   ```
3. The server will be available at `wss://your-server-domain.com`

### Client Deployment

The client is a single HTML file — host it on any static hosting:

- **Netlify**: Drop `client/` folder into Netlify
- **Vercel**: Deploy `client/` directory
- **GitHub Pages**: Serve from `client/` folder

No build step required.

### Connecting Client to Server

1. Open your hosted client in a browser
2. Enter your server's WebSocket URL in the connection field:
   - Production: `wss://your-server-domain.com`
   - Local development: `ws://localhost:3000`
3. The URL is saved in your browser's localStorage for convenience

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

## Security

The server includes the following protections:
- **Origin validation**: Only allowed origins can connect (configurable via `ALLOWED_ORIGINS`)
- **Server-side damage calculation**: Damage is calculated server-side, preventing client manipulation
- **Rate limiting**: 60 messages per second max to prevent spam/DoS
- **Message size limit**: 2KB max payload to prevent memory abuse
- **Movement validation**: Speed and world boundary enforcement
- **Input sanitization**: Player names and all inputs are validated and sanitized
- **Attack cooldown enforcement**: Server validates weapon cooldowns
- **Graceful shutdown**: Server notifies clients before shutting down