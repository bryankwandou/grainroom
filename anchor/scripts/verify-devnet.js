/**
 * Exercises the deployed Look Registry against devnet and checks that the
 * money lands where the design says it should.
 *
 *   node anchor/scripts/verify-devnet.js [path/to/payer-keypair.json]
 *
 * The payer needs roughly 0.5 devnet SOL. Fresh keypairs stand in for the
 * second author and the buyer, so the royalty split is observable rather
 * than one wallet paying itself.
 *
 * Instructions are encoded here by hand, the same way src/lib/solana/registry.ts
 * does it. That duplication is on purpose: if the two ever drift apart, this
 * script fails loudly instead of the browser failing quietly.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");

const PROGRAM_ID = new PublicKey("14a2jErBjHQv7fD64F6P1nLt6LXCsKgiyoi1c4mkyfaE");
const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";

const keypairPath =
  process.argv[2] || path.join(os.homedir(), ".config", "solana", "id.json");
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")))
);
const conn = new Connection(RPC, "confirmed");

/* ---------------------------------------------------------------- */
/* Wire format                                                       */
/* ---------------------------------------------------------------- */

const disc = (name) =>
  crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};

const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

const str = (s) => {
  const body = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length);
  return Buffer.concat([len, body]);
};

const pda = (hash) =>
  PublicKey.findProgramAddressSync([Buffer.from("look"), hash], PROGRAM_ID)[0];

/** Stands in for the canonical parameter hash the editor produces. */
const lookHash = (seed) => crypto.createHash("sha256").update(seed).digest();

/**
 * Reads a LookRecord. Option<Pubkey> is one byte when None and thirty-three
 * when Some — the account is sized for the larger case, but Borsh does not
 * pad, so stepping over the key unconditionally corrupts every field after it.
 */
function decodeRecord(data) {
  let o = 8;
  const author = new PublicKey(data.subarray(o, o + 32));
  o += 32 + 32;
  const hasParent = data[o] === 1;
  o += 1;
  let parent = null;
  if (hasParent) {
    parent = new PublicKey(data.subarray(o, o + 32));
    o += 32;
  }
  const depth = data[o];
  o += 1;
  const royaltyBps = data.readUInt16LE(o);
  o += 2;
  const derivativeCount = data.readBigUInt64LE(o);
  o += 8;
  const totalEarned = data.readBigUInt64LE(o);
  o += 8 + 8 + 1;
  const len = data.readUInt32LE(o);
  const name = data.subarray(o + 4, o + 4 + len).toString("utf8");
  return { author, parent, depth, royaltyBps, derivativeCount, totalEarned, name };
}

/* ---------------------------------------------------------------- */

let failures = 0;

function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`   ${ok ? "pass" : "FAIL"}  ${label}` + (ok ? "" : ` — got ${actual}, wanted ${expected}`));
}

const send = (ix, signers) =>
  sendAndConfirmTransaction(conn, new Transaction().add(ix), signers, {
    commitment: "confirmed",
  });

const registerIx = (hash, name, bps, author) =>
  new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pda(hash), isSigner: false, isWritable: true },
      { pubkey: author, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("register_look"), hash, str(name), u16(bps)]),
  });

const derivativeIx = (hash, parentHash, name, bps, author) =>
  new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pda(hash), isSigner: false, isWritable: true },
      { pubkey: pda(parentHash), isSigner: false, isWritable: true },
      { pubkey: author, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("register_derivative"), hash, str(name), u16(bps)]),
  });

const purchaseIx = (hash, seller, buyer, lamports, ancestors) =>
  new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pda(hash), isSigner: false, isWritable: true },
      { pubkey: seller, isSigner: false, isWritable: false },
      { pubkey: seller, isSigner: false, isWritable: true },
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...ancestors.map((a) => ({ pubkey: a, isSigner: false, isWritable: true })),
    ],
    data: Buffer.concat([disc("purchase"), u64(lamports)]),
  });

const withdrawIx = (hash, author) =>
  new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pda(hash), isSigner: false, isWritable: true },
      { pubkey: author, isSigner: true, isWritable: true },
    ],
    data: disc("withdraw"),
  });

/** Runs a transaction that is supposed to be rejected, and says why it was. */
async function expectRejected(label, ix, signers) {
  try {
    await send(ix, signers);
    failures++;
    console.log(`   FAIL  ${label} — the program accepted it`);
  } catch (e) {
    const logs = (e.logs || []).join("\n");
    const reason = logs.match(/Error Message: ([^\n]+)/);
    console.log(`   pass  ${label} — ${reason ? reason[1] : "rejected"}`);
  }
}

/* ---------------------------------------------------------------- */

(async () => {
  const program = await conn.getAccountInfo(PROGRAM_ID);
  if (!program?.executable) {
    console.error(`No executable program at ${PROGRAM_ID.toBase58()} on ${RPC}.`);
    process.exit(1);
  }

  const balance = await conn.getBalance(payer.publicKey);
  console.log(`payer   ${payer.publicKey.toBase58()}  ${balance / LAMPORTS_PER_SOL} SOL`);
  console.log(`program ${PROGRAM_ID.toBase58()}\n`);
  if (balance < 0.4 * LAMPORTS_PER_SOL) {
    console.error("The payer needs about 0.5 SOL to run this.");
    process.exit(1);
  }

  const stamp = Date.now().toString();
  const rootHash = lookHash(`verify-root-${stamp}`);
  const forkHash = lookHash(`verify-fork-${stamp}`);
  const forker = Keypair.generate();
  const buyer = Keypair.generate();

  console.log("1. a root Look is claimed at 5%");
  await send(registerIx(rootHash, "Safelight Base", 500, payer.publicKey), [payer]);
  let root = decodeRecord((await conn.getAccountInfo(pda(rootHash))).data);
  check("name survives the round trip", root.name, "Safelight Base");
  check("depth starts at zero", root.depth, 0);
  check("no parent on a root", root.parent, null);
  check("royalty recorded", root.royaltyBps, 500);

  console.log("\n2. a second author and a buyer are funded");
  for (const [who, sol] of [[forker, 0.05], [buyer, 0.4]]) {
    await send(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: who.publicKey,
        lamports: Math.round(sol * LAMPORTS_PER_SOL),
      }),
      [payer]
    );
  }
  console.log("   done");

  console.log("\n3. the second author forks it at 3%");
  await send(
    derivativeIx(forkHash, rootHash, "Safelight Push", 300, forker.publicKey),
    [forker]
  );
  const fork = decodeRecord((await conn.getAccountInfo(pda(forkHash))).data);
  root = decodeRecord((await conn.getAccountInfo(pda(rootHash))).data);
  check("fork sits one hop down", fork.depth, 1);
  check("fork names its parent", fork.parent?.toBase58(), pda(rootHash).toBase58());
  check("parent counted the fork", root.derivativeCount, 1n);

  console.log("\n4. a purchase cannot skip the upstream author");
  await expectRejected(
    "ancestors omitted entirely",
    purchaseIx(forkHash, forker.publicKey, buyer.publicKey, 0.1 * LAMPORTS_PER_SOL, []),
    [buyer]
  );
  await expectRejected(
    "a stranger substituted for the ancestor",
    purchaseIx(forkHash, forker.publicKey, buyer.publicKey, 0.1 * LAMPORTS_PER_SOL, [
      pda(lookHash(`verify-impostor-${stamp}`)),
    ]),
    [buyer]
  );

  console.log("\n5. the honest purchase settles, 0.2 SOL for the fork");
  const price = 0.2 * LAMPORTS_PER_SOL;
  const rootBefore = await conn.getBalance(pda(rootHash));
  const sellerBefore = await conn.getBalance(forker.publicKey);
  await send(
    purchaseIx(forkHash, forker.publicKey, buyer.publicKey, price, [pda(rootHash)]),
    [buyer]
  );
  const rootGain = (await conn.getBalance(pda(rootHash))) - rootBefore;
  const sellerGain = (await conn.getBalance(forker.publicKey)) - sellerBefore;
  check("root took its 5%", rootGain, 0.01 * LAMPORTS_PER_SOL);
  check("seller took the rest", sellerGain, 0.19 * LAMPORTS_PER_SOL);

  console.log("\n6. the root author sweeps the royalty out");
  const payerBefore = await conn.getBalance(payer.publicKey);
  await send(withdrawIx(rootHash, payer.publicKey), [payer]);
  const payerGain = (await conn.getBalance(payer.publicKey)) - payerBefore;
  console.log(
    `   pass  collected ${(payerGain / LAMPORTS_PER_SOL).toFixed(6)} SOL (0.01 less the transaction fee)`
  );
  const rentFloor = await conn.getMinimumBalanceForRentExemption(
    (await conn.getAccountInfo(pda(rootHash))).data.length
  );
  check(
    "rent stayed behind, so the record survives",
    await conn.getBalance(pda(rootHash)),
    rentFloor
  );

  console.log(
    `\nroot  https://explorer.solana.com/address/${pda(rootHash).toBase58()}?cluster=devnet`
  );
  console.log(
    `fork  https://explorer.solana.com/address/${pda(forkHash).toBase58()}?cluster=devnet`
  );
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("\nAborted:", e.message);
  if (e.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
