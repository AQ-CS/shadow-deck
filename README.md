# 🛡️ ShadowDeck

> AI-powered developer command center. Intercepts IDE signals, routes code through a Council of AI Agents, and displays results in a sci-fi terminal interface.

## ⚡ Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/your/shadow-deck.git
cd shadow-deck
npm install
```

### 2. Ignition (One-Time Setup)
*Installs Ollama + Downloads AI Models (DeepSeek R1 & Qwen 3)*
```bash
npm run setup
```

### 3. Configure API Key
Create a `.env` file in the project root:
```
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

### 4. Launch
```bash
npm run dev
```

## 🧠 The Council of Agents

| Agent | Role | Model |
|---|---|---|
| **The Inquisitor** | Logic & bug detection | Gemini 2.0 Flash |
| **The Artist** | UI/UX & accessibility audit | Gemini 2.0 Flash |
| **The Ghost** | Maestro test generation | Gemini 2.0 Flash |
| **The Lawyer** | Dependency license audit | Gemini 2.0 Flash |
| **The Sentinel** | Code review & fix verification | Gemini 2.0 Flash |

## 🏗️ Architecture

```
IDE (VS Code) ──POST /analyze──▶ Bridge (port 9090) ──IPC──▶ React Dashboard
                                  POST /git/diff                   │
                                                          Gemini API + Agents
```

## 📜 Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Electron + Vite dev servers |
| `npm run setup` | Install Ollama + pull AI models |
| `npm run build` | Production build |