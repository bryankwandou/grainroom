"use client";

import { useCallback, useEffect, useState } from "react";
import { Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { ConnectButton } from "@/components/solana/ConnectButton";
import { hashParams, isNeutral, type LookParams } from "@/lib/looks";
import {
  MAX_ROYALTY_BPS,
  PROGRAM_ID,
  buildRegisterDerivativeIx,
  buildRegisterLookIx,
  buildWithdrawIx,
  claimableLamports,
  explorerUrl,
  fetchLineage,
  fetchLook,
  formatSol,
  type LookRecord,
} from "@/lib/solana/registry";

type ProgramState = "checking" | "live" | "absent" | "unreachable";

/**
 * The registry side of the editor.
 *
 * Nothing here is needed to edit a photo, and that separation is the point:
 * this panel reads and writes a public record of who wrote a grade, while
 * the pixels stay on the machine. A Look is a few hundred bytes of settings,
 * so the record is small enough to be worth keeping and useless to anyone
 * trying to reconstruct the photograph from it.
 */
export function ChainPanel({
  params,
  parentId,
  onNotify,
}: {
  params: LookParams;
  parentId: string | null;
  onNotify: (msg: string) => void;
}) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();

  const [lookId, setLookId] = useState<string | null>(null);
  const [record, setRecord] = useState<LookRecord | null>(null);
  const [lineage, setLineage] = useState<LookRecord[]>([]);
  const [parentRecord, setParentRecord] = useState<LookRecord | null>(null);
  const [claimable, setClaimable] = useState<bigint>(0n);

  const [programState, setProgramState] = useState<ProgramState>("checking");
  const [name, setName] = useState("");
  const [royaltyPct, setRoyaltyPct] = useState(5);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const neutral = isNeutral(params);

  /* -------------------------------------------------------------- */
  /* Program presence                                                */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    let live = true;
    connection
      .getAccountInfo(PROGRAM_ID)
      .then((info) => {
        if (!live) return;
        setProgramState(info?.executable ? "live" : "absent");
      })
      .catch(() => {
        if (live) setProgramState("unreachable");
      });
    return () => {
      live = false;
    };
  }, [connection]);

  /* -------------------------------------------------------------- */
  /* Hash the settings in hand                                       */
  /* -------------------------------------------------------------- */

  // Settled on a delay rather than run per change: painting emits a new
  // parameter set several times a second, and every one of those would
  // otherwise be a hash and a devnet lookup for a Look nobody has finished.
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      hashParams(params).then((h) => {
        if (live) setLookId(h);
      });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [params]);

  const refresh = useCallback(async () => {
    if (!lookId || programState !== "live") return;
    try {
      const found = await fetchLook(connection, lookId);
      setRecord(found);
      setLineage(found ? await fetchLineage(connection, lookId) : []);
      setClaimable(found ? await claimableLamports(connection, lookId) : 0n);
    } catch {
      setProblem("Devnet did not answer. The edit itself is unaffected.");
    }
  }, [connection, lookId, programState]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let live = true;
    if (!parentId || programState !== "live") {
      setParentRecord(null);
      return;
    }
    fetchLook(connection, parentId)
      .then((r) => {
        if (live) setParentRecord(r);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [connection, parentId, programState]);

  /* -------------------------------------------------------------- */
  /* Writes                                                          */
  /* -------------------------------------------------------------- */

  const send = useCallback(
    async (build: () => Promise<Transaction>, done: string) => {
      setProblem(null);
      setBusy(true);
      try {
        const tx = await build();
        const sig = await sendTransaction(tx, connection);
        await connection.confirmTransaction(sig, "confirmed");
        onNotify(done);
        await refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // A wallet rejection is a decision, not a fault worth shouting about.
        setProblem(/reject|denied|cancel/i.test(msg) ? null : trimError(msg));
      } finally {
        setBusy(false);
      }
    },
    [connection, sendTransaction, onNotify, refresh]
  );

  const register = () =>
    send(
      async () => {
        if (!lookId || !publicKey) throw new Error("Connect a wallet first.");
        const args = {
          lookHashHex: lookId,
          name: name.trim(),
          royaltyBps: Math.round(royaltyPct * 100),
          author: publicKey,
        };
        const ix =
          parentRecord && parentId
            ? await buildRegisterDerivativeIx({
                ...args,
                parentHashHex: parentId,
              })
            : await buildRegisterLookIx(args);
        return new Transaction().add(ix);
      },
      parentRecord ? "Derivative recorded on devnet" : "Look recorded on devnet"
    );

  const withdraw = () =>
    send(async () => {
      if (!lookId || !publicKey) throw new Error("Connect a wallet first.");
      return new Transaction().add(
        await buildWithdrawIx({ lookHashHex: lookId, author: publicKey })
      );
    }, "Royalties moved to your wallet");

  const isAuthor =
    !!record && !!publicKey && record.author.toBase58() === publicKey.toBase58();

  /* -------------------------------------------------------------- */

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-medium text-paper-200">Look registry</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-paper-400">
            Devnet. The photo stays here; only the recipe hash is published.
          </p>
        </div>
        <ConnectButton compact />
      </div>

      <ProgramBadge state={programState} />

      {/* ---- the id in hand ---- */}
      <section className="rounded-lg border border-ink-700 bg-ink-800/60 p-3">
        <p className="text-[10px] uppercase tracking-wider text-paper-400">
          Look id
        </p>
        {neutral ? (
          <p className="mt-1.5 text-[11px] leading-relaxed text-paper-400">
            Nothing has been changed yet. Move a slider and this becomes a
            distinct recipe worth claiming.
          </p>
        ) : (
          <button
            onClick={() => {
              if (lookId) {
                void navigator.clipboard.writeText(lookId);
                onNotify("Look id copied");
              }
            }}
            className="focus-ring tabular mt-1.5 block w-full break-all text-left text-[11px] leading-relaxed text-amber-300 transition hover:text-amber-200"
            title="Copy the full id"
          >
            {lookId ? `${lookId.slice(0, 24)}…${lookId.slice(-8)}` : "computing…"}
          </button>
        )}
        <p className="mt-2 text-[10px] leading-relaxed text-paper-400">
          The id is the SHA-256 of the settings themselves, so the same grade
          arrives at the same id on anyone else&apos;s machine.
        </p>
      </section>

      {/* ---- registered, or a form to register ---- */}
      {record ? (
        <RecordCard
          record={record}
          lineage={lineage}
          claimable={claimable}
          isAuthor={isAuthor}
          busy={busy}
          onWithdraw={withdraw}
        />
      ) : (
        <section className="space-y-3">
          {parentRecord && (
            <div className="rounded-lg border border-amber-600/30 bg-amber-600/5 p-3">
              <p className="text-[10px] uppercase tracking-wider text-amber-400">
                Derived from
              </p>
              <p className="mt-1 text-xs text-paper-200">{parentRecord.name}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-paper-400">
                {parentRecord.royaltyBps / 100}% of any sale returns to that
                author, and to theirs.
              </p>
            </div>
          )}

          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-paper-400">
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 48))}
              placeholder="Fibre Print No. 2"
              className="focus-ring mt-1.5 w-full rounded-md border border-ink-600 bg-ink-800 px-2.5 py-2 text-xs text-paper-100 placeholder:text-paper-400/60"
            />
          </label>

          <label className="block">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-wider text-paper-400">
                Your royalty
              </span>
              <span className="tabular text-xs text-amber-400">
                {royaltyPct.toFixed(1)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={MAX_ROYALTY_BPS / 100}
              step={0.5}
              value={royaltyPct}
              onChange={(e) => setRoyaltyPct(Number(e.target.value))}
              className="mt-2 w-full accent-amber-500"
              aria-label="Royalty percentage"
            />
            <p className="mt-1.5 text-[10px] leading-relaxed text-paper-400">
              Taken from whatever a Look built on top of this one earns later.
              Ten percent is the ceiling the program enforces, so a long chain
              of authors can never swallow an entire sale.
            </p>
          </label>

          {!connected ? (
            <ConnectButton />
          ) : (
            <button
              onClick={register}
              disabled={busy || neutral || !name.trim() || programState !== "live"}
              className="focus-ring w-full rounded-md bg-amber-500 px-3 py-2 text-xs font-medium text-ink-900 transition hover:bg-amber-400 disabled:opacity-35"
            >
              {busy
                ? "Waiting for confirmation…"
                : parentRecord
                  ? "Record as a derivative"
                  : "Claim this Look"}
            </button>
          )}
        </section>
      )}

      {problem && (
        <p className="rounded-md border border-amber-600/40 bg-amber-600/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-200">
          {problem}
        </p>
      )}
    </div>
  );
}

/* ================================================================== */

function ProgramBadge({ state }: { state: ProgramState }) {
  if (state === "live") return null;
  const copy: Record<Exclude<ProgramState, "live">, string> = {
    checking: "Checking the registry program on devnet…",
    absent:
      "The registry program is not yet live at this address on devnet. Editing, exporting and Look links all work regardless; only publishing is on hold.",
    unreachable:
      "Devnet is not answering from here. The editor keeps working offline.",
  };
  return (
    <p className="rounded-md border border-ink-600 bg-ink-800/60 px-2.5 py-2 text-[11px] leading-relaxed text-paper-400">
      {copy[state]}
    </p>
  );
}

function RecordCard({
  record,
  lineage,
  claimable,
  isAuthor,
  busy,
  onWithdraw,
}: {
  record: LookRecord;
  lineage: LookRecord[];
  claimable: bigint;
  isAuthor: boolean;
  busy: boolean;
  onWithdraw: () => void;
}) {
  const author = record.author.toBase58();

  return (
    <section className="space-y-3">
      <div className="rounded-lg border border-fixer-400/30 bg-fixer-400/5 p-3">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-fixer-400" />
          <p className="text-[10px] uppercase tracking-wider text-fixer-400">
            On the record
          </p>
        </div>
        <p className="mt-1.5 text-sm text-paper-100">{record.name}</p>
        <p className="mt-0.5 text-[11px] text-paper-400">
          Claimed {record.createdAt.toLocaleDateString()} by{" "}
          <span className="tabular">
            {author.slice(0, 4)}…{author.slice(-4)}
          </span>
          {isAuthor && <span className="text-fixer-400"> — that is you</span>}
        </p>

        <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-ink-700 pt-3">
          <Stat label="Royalty" value={`${record.royaltyBps / 100}%`} />
          <Stat label="Forks" value={String(record.derivativeCount)} />
          <Stat label="Earned" value={`${formatSol(record.totalEarned)} SOL`} />
        </dl>

        <a
          href={explorerUrl(record.address)}
          target="_blank"
          rel="noreferrer"
          className="focus-ring mt-3 inline-block text-[11px] text-amber-300 underline underline-offset-2 hover:text-amber-200"
        >
          Open the account in the explorer
        </a>
      </div>

      {isAuthor && (
        <button
          onClick={onWithdraw}
          disabled={busy || claimable === 0n}
          className="focus-ring w-full rounded-md border border-ink-600 px-3 py-2 text-xs text-paper-200 transition hover:border-ink-500 disabled:opacity-35"
        >
          {claimable === 0n
            ? "Nothing to collect yet"
            : `Collect ${formatSol(claimable)} SOL`}
        </button>
      )}

      {lineage.length > 0 && (
        <div className="rounded-lg border border-ink-700 p-3">
          <p className="text-[10px] uppercase tracking-wider text-paper-400">
            Lineage
          </p>
          <ol className="mt-2 space-y-1.5">
            {lineage.map((a, i) => (
              <li key={a.address.toBase58()} className="flex items-baseline gap-2">
                <span className="tabular text-[10px] text-paper-400">{i + 1}</span>
                <a
                  href={explorerUrl(a.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring flex-1 truncate text-[11px] text-paper-200 underline-offset-2 hover:underline"
                >
                  {a.name}
                </a>
                <span className="tabular text-[10px] text-amber-400">
                  {a.royaltyBps / 100}%
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] text-paper-400">{label}</dt>
      <dd className="tabular mt-0.5 text-xs text-paper-100">{value}</dd>
    </div>
  );
}

/** Program logs run long and keep the part a person can act on at the end. */
function trimError(msg: string): string {
  const known = msg.match(/Error Message: ([^.]+\.)/);
  if (known) return known[1];
  return msg.length > 180 ? `${msg.slice(0, 180)}…` : msg;
}
