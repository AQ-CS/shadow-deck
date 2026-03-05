// src/App.jsx
// ═══════════════════════════════════════════════════════════════════════════
//  ShadowDeck — Root Application
//
//  ARCHITECTURE CHANGES (UI/UX Pivot):
//  1. Background (ActiveBackground) lives at z:0 and NEVER unmounts.
//     It is a sibling of the content layer, not a child of any view.
//  2. The Shell is a floating glass card with padding around its edges,
//     letting the animated background bleed through on all sides.
//  3. Laboratory + LiveFeed have been merged into <ChatConsole>.
//     Navigation is simplified: 'chat' | 'settings'.
//  4. Chat state is managed by useChatEngine (rolling context window).
//  5. Deep Scan (SwarmEngine) is wired through ChatConsole's onSend handler.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef, lazy, Suspense, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shell } from './components/Layout/Shell';
import { CommandCenter } from './components/Views/CommandCenter';
import { Settings } from './components/Views/Settings';

const { ipcRenderer } = window.require('electron');

// ── Background variants (lazy — large shader bundles) ───────────────────────
const ShaderAnimation = lazy(() => import('./components/shader-animation').then(m => ({ default: m.ShaderAnimation })));
const InterstellarShader = lazy(() => import('./components/ui/InterstellarShader').then(m => ({ default: m.InterstellarShader })));
const ShaderBackground = lazy(() => import('./components/shader-background'));
const SkyBackground = lazy(() => import('./components/ui/SkyBackground'));

const BRIDGE = 'http://localhost:9090';

// ═══════════════════════════════════════════════════════════════════════════
//  App
// ═══════════════════════════════════════════════════════════════════════════

export default function App() {
  // ── Config state ──────────────────────────────────────────────────────────
  const [config, setConfig] = useState({
    mode: 'local',
    activeProfile: 'beast',
    apiKeys: { gemini: '', openai: '' },
    ui: { accentColor: '#14b8a6', background: 'pulse', glareShield: false },
    incognito: false,
  });

  // ── App state ─────────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState('chat');
  const [activeProject, setActiveProject] = useState(null);
  const [connectionMode, setConnectionMode] = useState(null); // 'ide' | 'manual' | null
  const [bridgeStatus, setBridgeStatus] = useState('online');

  // Derived config shortcuts
  const accentColor = config.ui.accentColor;
  const activeBg = config.ui.background;
  const glareShield = config.ui.glareShield;
  const incognito = config.incognito;

  // ── Load persisted config & history ──────────────────────────────────────
  useEffect(() => {
    fetch(`${BRIDGE}/store/config`)
      .then(r => r.json())
      .then(stored => setConfig(prev => ({
        ...prev, ...stored,
        apiKeys: { ...prev.apiKeys, ...stored?.apiKeys },
        ui: { ...prev.ui, ...stored?.ui },
      })))
      .catch((err) => { console.error('[STORE] Failed to load config', err); });
  }, []);

  // ── Config helpers ────────────────────────────────────────────────────────
  const updateConfig = useCallback((patch) => {
    setConfig(prev => {
      const updated = {
        ...prev, ...patch,
        apiKeys: patch.apiKeys ? { ...prev.apiKeys, ...patch.apiKeys } : prev.apiKeys,
        ui: patch.ui ? { ...prev.ui, ...patch.ui } : prev.ui,
      };
      fetch(`${BRIDGE}/store/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      }).catch((err) => { console.error('[STORE] Failed to save config', err); });
      return updated;
    });
  }, []);

  const setAccentColor = useCallback((hex) => updateConfig({ ui: { accentColor: hex } }), [updateConfig]);
  const setActiveBg = useCallback((id) => updateConfig({ ui: { background: id } }), [updateConfig]);
  const setGlareShield = useCallback((val) => updateConfig({ ui: { glareShield: typeof val === 'function' ? val(glareShield) : val } }), [updateConfig, glareShield]);
  const setIncognito = useCallback((val) => updateConfig({ incognito: val }), [updateConfig]);

  // ── Project connection ────────────────────────────────────────────────────
  const handleConnectProject = useCallback(async () => {
    try {
      const selectedPath = await ipcRenderer.invoke('dialog-open-project');
      if (!selectedPath) return;
      const res = await fetch(`${BRIDGE}/project/connect`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedPath }),
      });
      const data = await res.json();
      if (data.status === 'connected') {
        setActiveProject(data.path);
        setConnectionMode('manual');
        console.log(`[SUCCESS] Project connected: ${data.path}`);
      }
    } catch (err) {
      console.log(`[ERROR] Connect failed: ${err.message}`);
    }
  }, []);

  // ── Clear history ─────────────────────────────────────────────────────────
  const handleClearHistory = useCallback(() => {
    fetch(`${BRIDGE}/store/history`, { method: 'DELETE' }).catch((err) => { console.error('[STORE] Failed to clear history', err); });
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  //  RENDER
  //
  //  DOM layers (bottom → top):
  //    0  PersistentBackground   (fixed, z-0, pointer-events:none)
  //    1  CRT / Noise overlays   (fixed, z-1, pointer-events:none)
  //    2  Padding container      (fixed inset, z-10, p-4)
  //       └── Shell (glass card, h-full, rounded-2xl)
  //              └── AnimatePresence (view content only — NOT background)
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black">

      {/* ── LAYER 0: Persistent animated shader background ── */}
      {/* Absolute sibling of the content layer — never nested inside AnimatePresence
          so it never remounts on view changes. The black root provides the base
          color while the lazy shader loads. */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{ opacity: glareShield ? 0.12 : 0.55, transition: 'opacity 0.6s ease' }}
        aria-hidden="true"
      >
        <Suspense fallback={null}>
          {activeBg === 'pulse' && <ShaderAnimation color={accentColor} />}
          {activeBg === 'interstellar' && <InterstellarShader color={accentColor} />}
          {activeBg === 'neon' && <ShaderBackground color={accentColor} />}
          {activeBg === 'sky' && <SkyBackground color={accentColor} />}
        </Suspense>
      </div>

      {/* ── LAYER 1: CRT scanlines + film grain ── */}
      <div className="crt-overlay" aria-hidden="true" />
      <div className="noise-overlay" aria-hidden="true" />

      {/* ── LAYER 2: Floating glass console ── */}
      {/* p-4 creates the margin so the shader bleeds around the card edges. */}
      <div className="absolute inset-0 z-10 p-4 flex flex-col overflow-hidden">
        <Shell
          accentColor={accentColor}
          activeView={activeView}
          onViewChange={setActiveView}
          bridgeStatus={bridgeStatus}
          glareShield={glareShield}
          onGlareToggle={() => setGlareShield(v => !v)}
          activeProject={activeProject}
          connectionMode={connectionMode}
          onConnectProject={handleConnectProject}

          // New prop: enable the floating card style inside Shell
          floating={true}
        >
          {/* View content — only this area animates, not the background */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.15 }}
              className="w-full h-full"
            >
              {activeView === 'chat' && (
                <CommandCenter
                  projectRoot={activeProject}
                  isConnected={!!activeProject}
                />
              )}

              {activeView === 'settings' && (
                <Settings
                  accentColor={accentColor}
                  onAccentChange={setAccentColor}
                  activeBg={activeBg}
                  onBgChange={setActiveBg}
                  glare={glareShield}
                  config={config}
                  onConfigChange={updateConfig}
                  incognito={incognito}
                  onIncognitoChange={setIncognito}
                  onClearHistory={handleClearHistory}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </Shell>
      </div>


    </div>
  );
}