# 🛑 PROJECT ARCHIVED: ShadowDeck

> **Status: Abandoned / Archived.**
> *ShadowDeck was an experimental, local-first developer command center. As a systems engineering exercise in Electron, Node.js, and local LLM orchestration, it was a massive success. As a daily-driver productivity tool, it hit the physical limits of local hardware. Read the Architecture Review below for details.*

---

## 🔍 Architecture Review: The Local AI Reality Check

ShadowDeck was originally built to be a comprehensive AI analyzer that could read an entire repository, intercept IDE signals, and execute agentic commands via a local Express bridge. We orchestrated local models (`deepseek-r1:14b`, `qwen3.5:9b`) via Ollama and Cloud APIs to act as a "Council of Agents" doing automated PR reviews, UI audits, and test generation.

**Why active development was paused:**
1. **The Context Collapse:** Local 9B/14B models cannot reliably hold entire repositories in context. Trying to feed them massive `git diffs` or map-reducing entire codebases resulted in hallucinations and dropped system prompts.
2. **The Hardware Tax:** Running a 14B parameter model sequentially across a file queue pins a 12GB GPU to 100% compute. A developer tool that prevents the developer's machine from running smoothly is counterproductive.
3. **The Cloud Dominance:** Ultimately, trying to replicate the functionality of frontier cloud models (like Claude 3.5 Sonnet or GPT-4o) using local VRAM is inefficient for general coding tasks. Unless working in a strict, air-gapped enterprise environment, paid cloud tools provide faster, more accurate results with zero hardware tax. 

This repository remains as a blueprint for building high-contrast, zero-latency **Electron + Vite interfaces** and **deterministically routing local AI payloads**, but active feature development has ceased.

---

# 🛡️ ShadowDeck (Original Documentation)

> AI-powered developer command center. Intercepts IDE signals, routes code through a Council of AI Agents, and displays results in a sci-fi terminal interface.

## ⚡ Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/your/shadow-deck.git
cd shadow-deck
npm install
```

### 2. Ignition (One-Time Setup)
Installs Ollama + Downloads AI Models (DeepSeek R1 & Qwen 3)
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
| **The Inquisitor** | Logic & bug detection | Gemini 2.0 Flash / DeepSeek R1 |
| **The Artist** | UI/UX & accessibility audit | Gemini 2.0 Flash |
| **The Ghost** | Maestro test generation | Gemini 2.0 Flash |
| **The Lawyer** | Dependency license audit | Gemini 2.0 Flash / Qwen 3.5 |
| **The Sentinel** | Code review & fix verification | Gemini 2.0 Flash |

## 🏗️ Architecture

```
IDE (VS Code) ──POST /analyze──▶ Bridge (port 9090) ──IPC──▶ React Dashboard
                                  POST /git/diff                   │
                                                          Local LLM / Gemini API
```

## 📜 Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Electron + Vite dev servers |
| `npm run setup` | Install Ollama + pull AI models |
| `npm run build` | Production build |