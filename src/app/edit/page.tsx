import type { Metadata } from "next";
import Editor from "@/components/editor/Editor";
import { WalletBridge } from "@/components/solana/WalletBridge";

export const metadata: Metadata = {
  title: "Editor",
  description:
    "The Grainroom editing surface. Photos are processed on your device and never leave it.",
};

export default function EditPage() {
  return (
    <WalletBridge>
      <Editor />
    </WalletBridge>
  );
}
