"use client";

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { DEVNET_RPC } from "@/lib/solana/registry";

/**
 * Wraps the parts of the app that may talk to a wallet.
 *
 * The adapter list is deliberately empty. Every wallet worth supporting now
 * announces itself through the Wallet Standard, so the provider discovers
 * Phantom, Solflare, Backpack and the rest at runtime. Bundling the adapter
 * package instead would add roughly a megabyte to a build whose entire claim
 * is that the editor keeps working with the network switched off.
 */
export function WalletBridge({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => DEVNET_RPC, []);

  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
