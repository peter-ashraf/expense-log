import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, Link2, Eye, ArrowRight, ExternalLink, ClipboardPaste } from 'lucide-react';
import { toast } from 'sonner';
import { parseViewLink, store, VLINK_KEY, viewLinkUrl } from '../lib/bridge';

export default function OnboardingView({ initialUrl = '', initialKey = '', onConnected }) {
  const [url, setUrl] = useState(initialUrl);
  const [apiKey, setApiKey] = useState(initialKey);
  const [connecting, setConnecting] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const [vlink, setVlink] = useState('');
  const [viewerLoading, setViewerLoading] = useState(false);

  const handleConnect = async (e) => {
    e.preventDefault();
    if (!url.trim() || !apiKey.trim() || connecting) return;
    setConnecting(true);
    try {
      await store.connect({ url: url.trim(), key: apiKey.trim() });
      toast.success('Connected to Google Sheet');
      onConnected?.();
    } catch (err) {
      toast.error(err.message || 'Could not connect');
      setConnecting(false);
    }
  };

  const handleDemo = async () => {
    if (demoLoading) return;
    setDemoLoading(true);
    try {
      await store.connect({ demo: true });
      toast.success('Demo loaded');
      onConnected?.();
    } catch (err) {
      toast.error(err.message || 'Could not load demo');
      setDemoLoading(false);
    }
  };

  const handleOpenViewLink = async (rawStr) => {
    const cfg = parseViewLink(rawStr ?? vlink);
    if (!cfg) {
      toast.error('That does not look like a view-only link');
      return;
    }
    setViewerLoading(true);
    try {
      await store.connectViewer(cfg);
      try { localStorage.setItem(VLINK_KEY, viewLinkUrl(cfg, cfg.token)); } catch { /* ignore */ }
      toast.success('Opened view-only');
      onConnected?.();
    } catch (err) {
      toast.error(err.message || 'Could not open the link');
      setViewerLoading(false);
    }
  };

  const handlePasteViewer = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t && t.trim()) {
        setVlink(t.trim());
        handleOpenViewLink(t.trim());
      } else {
        toast.error('Clipboard is empty');
      }
    } catch {
      toast.error('Paste the link into the box instead');
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-8 flex flex-col justify-center no-scrollbar">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="space-y-5 my-auto"
      >
        {/* Hero Brand Header */}
        <div className="flex flex-col items-center text-center space-y-3">
          <img
            src="icons/icon.svg"
            alt=""
            className="w-[72px] h-[72px] rounded-[22px] shadow-2xl border"
            style={{ borderColor: 'var(--border-strong)' }}
          />
          <div>
            <h1
              className="font-display text-[28px] font-extrabold leading-tight tracking-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              Your money,
              <br />
              always with you.
            </h1>
            <p className="text-[13px] mt-2 leading-relaxed max-w-[300px] mx-auto" style={{ color: 'var(--text-secondary)' }}>
              Log expenses anywhere — even offline. Everything syncs to your Google Sheet when you’re back online.
            </p>
          </div>
        </div>

        {/* Try the Demo CTA */}
        <button
          type="button"
          onClick={handleDemo}
          disabled={demoLoading}
          className="w-full py-3.5 px-4 rounded-2xl text-[14px] font-bold flex items-center justify-center gap-2 shadow-xl active:scale-[0.98] transition-transform disabled:opacity-60"
          style={{
            background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
            color: '#FFFFFF',
          }}
        >
          <Sparkles size={16} />
          <span>{demoLoading ? 'Loading demo…' : 'Try the demo'}</span>
        </button>

        {/* Connect Google Sheet Card */}
        <form onSubmit={handleConnect} className="surface-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Link2 size={15} style={{ color: 'var(--accent)' }} />
            <h2 className="font-display text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
              Connect your Google Sheet
            </h2>
          </div>

          <div>
            <label className="text-[11px] font-bold block mb-1" style={{ color: 'var(--text-secondary)' }}>
              Sheet API address
            </label>
            <input
              type="url"
              inputMode="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/…/exec"
              className="w-full px-3 py-2.5 rounded-xl border bg-transparent text-[16px] outline-none"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label className="text-[11px] font-bold block mb-1" style={{ color: 'var(--text-secondary)' }}>
              Access key
            </label>
            <input
              type="password"
              required
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Your secret key"
              className="w-full px-3 py-2.5 rounded-xl border bg-transparent text-[16px] outline-none"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
            />
          </div>

          <button
            type="submit"
            disabled={connecting}
            className="w-full py-3 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 border active:scale-[0.98] transition-transform disabled:opacity-60"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              borderColor: 'var(--border-strong)',
              color: 'var(--text-primary)',
            }}
          >
            <span>{connecting ? 'Connecting…' : 'Connect'}</span>
            <ArrowRight size={14} />
          </button>
        </form>

        {/* View-only link */}
        <div className="surface-card p-3.5 space-y-2.5">
          <button
            type="button"
            onClick={() => setShowViewer((v) => !v)}
            className="w-full flex items-center justify-between text-left"
          >
            <span className="inline-flex items-center gap-2 text-[12px] font-bold" style={{ color: 'var(--text-secondary)' }}>
              <Eye size={14} style={{ color: 'var(--accent)' }} />
              <span>Have a view-only link?</span>
            </span>
            <span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
              {showViewer ? 'Hide' : 'Paste it here'}
            </span>
          </button>

          {showViewer && (
            <div className="space-y-2 pt-1">
              <input
                type="url"
                inputMode="url"
                value={vlink}
                onChange={(e) => setVlink(e.target.value)}
                placeholder="https://…#v=…&t=…"
                className="w-full px-3 py-2 rounded-xl border bg-transparent text-[16px] outline-none"
                style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
              />
              <div className="flex gap-2">
                {typeof navigator !== 'undefined' && navigator.clipboard?.readText && (
                  <button
                    type="button"
                    onClick={handlePasteViewer}
                    className="px-3 py-2 rounded-xl text-[12px] font-semibold border inline-flex items-center gap-1.5"
                    style={{
                      backgroundColor: 'var(--bg-pill)',
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <ClipboardPaste size={13} />
                    <span>Paste</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={viewerLoading || !vlink.trim()}
                  onClick={() => handleOpenViewLink()}
                  className="flex-1 py-2 rounded-xl text-[12px] font-bold disabled:opacity-40"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                >
                  {viewerLoading ? 'Opening…' : 'Open view-only'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="text-center">
          <a
            href="setup.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12px] font-semibold"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span>New here? Set up your own Google Sheet</span>
            <ExternalLink size={12} />
          </a>
        </div>
      </motion.div>
    </div>
  );
}
