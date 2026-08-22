"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

/**
 * Wallet picker built from scratch rather than pulled from
 * `wallet-adapter-react-ui`, whose stylesheet arrives with its own purple
 * palette and font stack and fights the rest of the room on sight.
 */
export function ConnectButton({ compact = false }: { compact?: boolean }) {
  const { wallets, select, connect, disconnect, connecting, connected, publicKey, wallet } =
    useWallet();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Selecting a wallet only registers the choice; the connect call has to
  // wait for the adapter to actually be in place or it throws.
  useEffect(() => {
    if (!wallet || connected || connecting) return;
    connect().catch(() => undefined);
  }, [wallet, connected, connecting, connect]);

  const installed = wallets.filter((w) => w.readyState === "Installed");
  const others = wallets.filter((w) => w.readyState !== "Installed");

  if (connected && publicKey) {
    const addr = publicKey.toBase58();
    return (
      <button
        onClick={() => disconnect()}
        title={`${addr} — click to disconnect`}
        className="focus-ring tabular rounded-md border border-fixer-400/40 bg-fixer-400/10 px-2.5 py-1.5 text-xs text-fixer-400 transition hover:border-fixer-400/70"
      >
        {addr.slice(0, 4)}…{addr.slice(-4)}
      </button>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={connecting}
        className={`focus-ring rounded-md border border-ink-600 text-paper-300 transition hover:border-ink-500 hover:text-paper-100 disabled:opacity-50 ${
          compact ? "px-2.5 py-1.5 text-xs" : "w-full px-3 py-2 text-xs"
        }`}
      >
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1.5 w-60 overflow-hidden rounded-lg border border-ink-600 bg-ink-800 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.9)]">
          {installed.length === 0 && (
            <p className="px-3 py-3 text-xs leading-relaxed text-paper-400">
              No wallet extension answered. Install Phantom, Solflare or
              Backpack, then reload this tab.
            </p>
          )}
          {[...installed, ...others].map((w) => (
            <button
              key={w.adapter.name}
              onClick={() => {
                select(w.adapter.name);
                setOpen(false);
              }}
              className="focus-ring flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-paper-200 transition hover:bg-ink-700"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={w.adapter.icon} alt="" className="h-4 w-4 rounded" />
              <span className="flex-1">{w.adapter.name}</span>
              {w.readyState !== "Installed" && (
                <span className="text-[10px] text-paper-400">not installed</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
