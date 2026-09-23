/**
 * Client for the Look Registry program.
 *
 * Instructions are built by hand rather than through an Anchor IDL. Both
 * sides of this wire format live in one repository, the account layouts are
 * small and fixed, and doing it directly keeps a megabyte of IDL tooling out
 * of a bundle whose whole selling point is that it runs offline. The editor
 * must work with the chain code never loaded.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "7kc9jwXoetCASZ3G8zF7z4si4C72KD3jza36MszyqFeC"
);

export const DEVNET_RPC = "https://api.devnet.solana.com";

/** Mirrors MAX_ROYALTY_BPS in the program. */
export const MAX_ROYALTY_BPS = 1_000;
/** Mirrors MAX_LINEAGE_DEPTH in the program. */
export const MAX_LINEAGE_DEPTH = 8;

/* ------------------------------------------------------------------ */
/* Discriminators                                                      */
/* ------------------------------------------------------------------ */

/**
 * Anchor prefixes every instruction with the first eight bytes of
 * sha256("global:<snake_case_name>"). Computing it here rather than pasting
 * a magic constant means renaming a handler surfaces as a failed call in
 * testing instead of a silent mismatch.
 */
async function discriminator(name: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(`global:${name}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return new Uint8Array(digest).slice(0, 8);
}

/* ------------------------------------------------------------------ */
/* Addresses                                                           */
/* ------------------------------------------------------------------ */

/** Converts the hex Look id into the 32 raw bytes used as the PDA seed. */
export function hashToBytes(lookHashHex: string): Uint8Array {
  const clean = lookHashHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error("A Look id must be 64 hexadecimal characters.");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function lookPda(lookHashHex: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("look"), Buffer.from(hashToBytes(lookHashHex))],
    PROGRAM_ID
  );
}

/* ------------------------------------------------------------------ */
/* Encoding helpers                                                    */
/* ------------------------------------------------------------------ */

function encodeString(s: string): Uint8Array {
  const body = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, body.length, true);
  out.set(body, 4);
  return out;
}

function encodeU16(n: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, n, true);
  return out;
}

function encodeU64(n: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n, true);
  return out;
}

function concat(...parts: Uint8Array[]): Buffer {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return Buffer.from(out);
}

/* ------------------------------------------------------------------ */
/* Instructions                                                        */
/* ------------------------------------------------------------------ */

export interface RegisterArgs {
  lookHashHex: string;
  name: string;
  royaltyBps: number;
  author: PublicKey;
}

export async function buildRegisterLookIx(
  args: RegisterArgs
): Promise<TransactionInstruction> {
  validate(args);
  const [look] = lookPda(args.lookHashHex);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: look, isSigner: false, isWritable: true },
      { pubkey: args.author, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: concat(
      await discriminator("register_look"),
      hashToBytes(args.lookHashHex),
      encodeString(args.name),
      encodeU16(args.royaltyBps)
    ),
  });
}

export async function buildRegisterDerivativeIx(
  args: RegisterArgs & { parentHashHex: string }
): Promise<TransactionInstruction> {
  validate(args);
  const [look] = lookPda(args.lookHashHex);
  const [parent] = lookPda(args.parentHashHex);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: look, isSigner: false, isWritable: true },
      { pubkey: parent, isSigner: false, isWritable: true },
      { pubkey: args.author, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: concat(
      await discriminator("register_derivative"),
      hashToBytes(args.lookHashHex),
      encodeString(args.name),
      encodeU16(args.royaltyBps)
    ),
  });
}

/**
 * Builds a purchase. The ancestor chain must be supplied nearest-parent
 * first; the program walks it and rejects any gap, so this cannot be used
 * to quietly cut an upstream author out of their share.
 */
export async function buildPurchaseIx(args: {
  lookHashHex: string;
  seller: PublicKey;
  buyer: PublicKey;
  lamports: bigint;
  ancestors: PublicKey[];
}): Promise<TransactionInstruction> {
  if (args.ancestors.length > MAX_LINEAGE_DEPTH) {
    throw new Error(
      `A lineage of ${args.ancestors.length} exceeds the ${MAX_LINEAGE_DEPTH} the program settles in one transaction.`
    );
  }
  const [look] = lookPda(args.lookHashHex);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: look, isSigner: false, isWritable: true },
      { pubkey: args.seller, isSigner: false, isWritable: false },
      { pubkey: args.seller, isSigner: false, isWritable: true },
      { pubkey: args.buyer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...args.ancestors.map((a) => ({
        pubkey: a,
        isSigner: false,
        isWritable: true,
      })),
    ],
    data: concat(await discriminator("purchase"), encodeU64(args.lamports)),
  });
}

function validate(args: RegisterArgs) {
  if (!args.name.trim()) throw new Error("Give the Look a name.");
  if (args.name.length > 48) {
    throw new Error("Look names are capped at 48 characters.");
  }
  if (args.royaltyBps < 0 || args.royaltyBps > MAX_ROYALTY_BPS) {
    throw new Error("Royalty must sit between 0 and 10 percent.");
  }
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export interface LookRecord {
  address: PublicKey;
  author: PublicKey;
  lookHashHex: string;
  parent: PublicKey | null;
  depth: number;
  royaltyBps: number;
  derivativeCount: bigint;
  totalEarned: bigint;
  createdAt: Date;
  name: string;
}

/** Decodes a LookRecord account. Layout must track the Rust struct exactly. */
export function decodeLookRecord(
  address: PublicKey,
  data: Uint8Array
): LookRecord {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8; // skip the account discriminator

  const author = new PublicKey(data.slice(o, o + 32));
  o += 32;

  const lookHashHex = Array.from(data.slice(o, o + 32))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  o += 32;

  // Option<Pubkey>: a one-byte tag, then the key only when the tag is 1.
  // The account is sized for the Some case, but Borsh writes nothing after
  // the tag for None, so the read has to step over the key conditionally.
  // Advancing unconditionally shifts every later field by 32 bytes and
  // turns a root Look into plausible-looking nonsense.
  const hasParent = data[o] === 1;
  o += 1;
  let parent: PublicKey | null = null;
  if (hasParent) {
    parent = new PublicKey(data.slice(o, o + 32));
    o += 32;
  }

  const depth = data[o];
  o += 1;
  const royaltyBps = view.getUint16(o, true);
  o += 2;
  const derivativeCount = view.getBigUint64(o, true);
  o += 8;
  const totalEarned = view.getBigUint64(o, true);
  o += 8;
  const createdAt = new Date(Number(view.getBigInt64(o, true)) * 1000);
  o += 8;
  o += 1; // bump

  const nameLen = view.getUint32(o, true);
  o += 4;
  const name = new TextDecoder().decode(data.slice(o, o + nameLen));

  return {
    address,
    author,
    lookHashHex,
    parent,
    depth,
    royaltyBps,
    derivativeCount,
    totalEarned,
    createdAt,
    name,
  };
}

export async function fetchLook(
  connection: Connection,
  lookHashHex: string
): Promise<LookRecord | null> {
  const [address] = lookPda(lookHashHex);
  const info = await connection.getAccountInfo(address);
  if (!info) return null;
  return decodeLookRecord(address, new Uint8Array(info.data));
}

/**
 * Walks a Look back to its root.
 *
 * Returned nearest-parent first, which is the order `purchase` expects, so
 * the result feeds straight into a payment without reshuffling.
 */
export async function fetchLineage(
  connection: Connection,
  lookHashHex: string
): Promise<LookRecord[]> {
  const chain: LookRecord[] = [];
  let current = await fetchLook(connection, lookHashHex);
  if (!current) return chain;

  let guard = 0;
  while (current?.parent && guard < MAX_LINEAGE_DEPTH) {
    const info = await connection.getAccountInfo(current.parent);
    if (!info) break;
    const parent = decodeLookRecord(current.parent, new Uint8Array(info.data));
    chain.push(parent);
    current = parent;
    guard++;
  }
  return chain;
}

export function explorerUrl(address: PublicKey | string): string {
  return `https://explorer.solana.com/address/${address.toString()}?cluster=devnet`;
}

/**
 * Sweeps royalties out of a Look record and into its author's wallet.
 *
 * Rent stays behind, so this can be called repeatedly without ever
 * destroying the authorship record it is attached to.
 */
export async function buildWithdrawIx(args: {
  lookHashHex: string;
  author: PublicKey;
}): Promise<TransactionInstruction> {
  const [look] = lookPda(args.lookHashHex);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: look, isSigner: false, isWritable: true },
      { pubkey: args.author, isSigner: true, isWritable: true },
    ],
    data: concat(await discriminator("withdraw")),
  });
}

/** Lamports held above the rent floor, which is what `withdraw` releases. */
export async function claimableLamports(
  connection: Connection,
  lookHashHex: string
): Promise<bigint> {
  const [address] = lookPda(lookHashHex);
  const info = await connection.getAccountInfo(address);
  if (!info) return 0n;
  const floor = await connection.getMinimumBalanceForRentExemption(
    info.data.length
  );
  const excess = BigInt(info.lamports) - BigInt(floor);
  return excess > 0n ? excess : 0n;
}

export function formatSol(lamports: bigint): string {
  const sol = Number(lamports) / 1_000_000_000;
  if (sol === 0) return "0";
  if (sol < 0.001) return sol.toExponential(2);
  return sol.toFixed(sol < 1 ? 4 : 3).replace(/0+$/, "").replace(/\.$/, "");
}
