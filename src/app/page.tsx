import Link from "next/link";
import { Mark, Wordmark } from "@/components/Logo";
import HeroDemo from "@/components/HeroDemo";
import { TOOLS, ROADMAP_TOOLS } from "@/lib/tools";

export default function Home() {
  return (
    <div className="min-h-dvh bg-ink-900">
      <SiteHeader />

      {/* ---------------------------- hero ---------------------------- */}
      <section className="relative overflow-hidden border-b border-ink-800">
        <Safelight />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-5 py-16 sm:py-24 lg:grid-cols-[1fr_1.15fr] lg:items-center lg:gap-16">
          <div className="rise">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-800/60 px-3 py-1 text-[11px] text-paper-400">
              <span className="h-1.5 w-1.5 rounded-full bg-fixer-400" />
              Runs offline · nothing uploads
            </p>

            <h1 className="text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.03em] text-paper-100 sm:text-6xl">
              A darkroom that
              <br />
              runs in your
              <br />
              <span className="text-amber-400">browser.</span>
            </h1>

            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-paper-300">
              Open a photo and it stays on your machine. The editing happens on
              your own graphics card, at full resolution, and the file you save
              carries no watermark and no account attached to it.
            </p>

            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-paper-400">
              What you build while editing is a Look — a small recipe you can
              hand to someone else. When they change it, your name stays on the
              part you wrote.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/edit"
                className="focus-ring rounded-lg bg-amber-500 px-5 py-3 text-sm font-medium text-ink-900 transition hover:bg-amber-400"
              >
                Open the editor
              </Link>
              <a
                href="https://github.com/bryankwandou/grainroom"
                className="focus-ring rounded-lg border border-ink-600 px-5 py-3 text-sm text-paper-300 transition hover:border-ink-500 hover:text-paper-100"
              >
                Read the source
              </a>
            </div>

            <dl className="mt-10 grid grid-cols-3 gap-5 border-t border-ink-800 pt-6">
              {[
                { k: "0", v: "bytes uploaded" },
                { k: "4", v: "GPU passes per frame" },
                { k: "0", v: "accounts required" },
              ].map((s) => (
                <div key={s.v}>
                  <dt className="tabular text-2xl font-semibold text-paper-100">
                    {s.k}
                  </dt>
                  <dd className="mt-0.5 text-[11px] leading-snug text-paper-400">
                    {s.v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="develop">
            <HeroDemo />
          </div>
        </div>
      </section>

      {/* ------------------------- the problem ------------------------ */}
      <section className="border-b border-ink-800 px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <SectionLabel>Why this exists</SectionLabel>
          <h2 className="mt-3 max-w-2xl text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-paper-100 sm:text-4xl">
            A preset is somebody&rsquo;s work. Right now it travels like a
            stray file.
          </h2>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              {
                n: "01",
                h: "The copy leaves no trace",
                p: "Someone spends a week building a grade, sells it, and by the weekend it is in a shared folder. There is no way to tell an authorised copy from a lifted one, because the file is identical either way.",
              },
              {
                n: "02",
                h: "Credit stops at the first hop",
                p: "Photographers adapt each other's grades constantly. That is healthy. What is missing is any record of where a look came from once it has been tweaked twice and renamed.",
              },
              {
                n: "03",
                h: "The tool holds the work hostage",
                p: "A grade built in one application rarely survives the move to another. The settings are stored in a private format, so leaving the software means rebuilding from scratch.",
              },
            ].map((c) => (
              <article
                key={c.n}
                className="rounded-xl border border-ink-800 bg-ink-800/40 p-5"
              >
                <span className="tabular text-[11px] font-medium text-amber-500">
                  {c.n}
                </span>
                <h3 className="mt-2.5 text-[15px] font-medium text-paper-100">
                  {c.h}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-paper-400">
                  {c.p}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------- how looks work -------------------- */}
      <section className="border-b border-ink-800 px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <SectionLabel>How a Look travels</SectionLabel>
          <h2 className="mt-3 max-w-2xl text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-paper-100 sm:text-4xl">
            The photograph stays put. Only the recipe moves.
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-paper-300">
            A Look is a few hundred bytes of numbers — the position of every
            slider, the control points of every curve. Applied to the same
            pixels it produces the same image on any machine, which is what
            makes it safe to address by its own content hash.
          </p>

          <LookDiagram />
        </div>
      </section>

      {/* --------------------------- registry ------------------------- */}
      <section className="border-b border-ink-800 px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <SectionLabel>The registry, running on devnet</SectionLabel>
          <h2 className="mt-3 max-w-2xl text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-paper-100 sm:text-4xl">
            A preset sold as a file cannot prove where it came from.
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-paper-300">
            Copy a preset and the copy is indistinguishable from the original.
            That is why grades get passed around uncredited and why nobody
            upstream ever sees anything. A Look carries its parent, and the
            program settles every author in the chain inside the same
            transaction that pays the seller.
          </p>

          <Registry />
        </div>
      </section>

      {/* --------------------------- toolset -------------------------- */}
      <section className="border-b border-ink-800 px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <SectionLabel>What is wired up today</SectionLabel>
          <h2 className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-paper-100 sm:text-4xl">
            Shipping, and honest about the rest.
          </h2>

          <div className="mt-10 grid gap-8 lg:grid-cols-2">
            <div>
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-medium text-paper-200">
                <span className="h-1.5 w-1.5 rounded-full bg-fixer-400" />
                Running now
              </h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {TOOLS.map((t) => (
                  <li
                    key={t.id}
                    className="rounded-lg border border-ink-800 bg-ink-800/40 p-3"
                  >
                    <p className="text-[13px] font-medium text-paper-100">
                      {t.name}
                    </p>
                    <p className="mt-1 text-[11px] leading-snug text-paper-400">
                      {t.blurb}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-medium text-paper-200">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Next milestone
              </h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {ROADMAP_TOOLS.map((t) => (
                  <li
                    key={t.name}
                    className="rounded-lg border border-dashed border-ink-700 p-3"
                  >
                    <p className="text-[13px] font-medium text-paper-300">
                      {t.name}
                    </p>
                    <p className="mt-1 text-[11px] leading-snug text-paper-400/70">
                      {t.note}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[11px] leading-relaxed text-paper-400/70">
                What is left needs something a Look cannot carry on its own: a
                call out to the background removal service already running in
                Removix, a second photograph, or a decoder that has to run
                before the pipeline does. Everything else is finished and local.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------- privacy -------------------------- */}
      <section className="border-b border-ink-800 px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <SectionLabel>Where your files go</SectionLabel>
          <h2 className="mt-3 max-w-2xl text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-paper-100 sm:text-4xl">
            Nowhere. That is not a policy, it is the architecture.
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-paper-300">
            There is no upload endpoint in this codebase. Decoding happens
            through the browser&rsquo;s own image APIs, processing happens on
            the GPU, and the export is encoded by the same canvas you were
            looking at. You can pull the network cable and keep working.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { h: "No account", p: "Nothing to sign up for, nothing to cancel." },
              { h: "No watermark", p: "At any resolution, in any format." },
              { h: "No advertising", p: "Nothing on the page is sold to anyone." },
              { h: "No telemetry", p: "The editor makes no outbound requests." },
            ].map((c) => (
              <div
                key={c.h}
                className="rounded-lg border border-ink-800 bg-ink-800/40 p-4"
              >
                <p className="text-[13px] font-medium text-paper-100">{c.h}</p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-paper-400">
                  {c.p}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------- cta ---------------------------- */}
      <section className="px-5 py-20 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <Mark size={56} className="mx-auto safelight" />
          <h2 className="mt-6 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-paper-100 sm:text-4xl">
            Drop a photo in and see where it lands.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-paper-300">
            No setup, no install, no sign-in. The first render happens about a
            second after you pick a file.
          </p>
          <Link
            href="/edit"
            className="focus-ring mt-8 inline-block rounded-lg bg-amber-500 px-6 py-3 text-sm font-medium text-ink-900 transition hover:bg-amber-400"
          >
            Open the editor
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

/* ================================================================== */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-800 bg-ink-900/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center px-5">
        <Link href="/" className="focus-ring rounded">
          <Wordmark size={17} />
        </Link>
        <nav className="ml-auto flex items-center gap-1">
          <a
            href="https://github.com/bryankwandou/grainroom"
            className="focus-ring rounded-md px-3 py-1.5 text-xs text-paper-400 transition hover:text-paper-100"
          >
            Source
          </a>
          <Link
            href="/edit"
            className="focus-ring rounded-md bg-amber-500 px-3.5 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-amber-400"
          >
            Open editor
          </Link>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-ink-800 px-5 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center">
        <Wordmark size={15} />
        <p className="text-[11px] leading-relaxed text-paper-400 sm:ml-6 sm:max-w-md">
          Built from scratch. Not affiliated with, derived from, or endorsed by
          any other photo editing application.
        </p>
        <a
          href="https://github.com/bryankwandou/grainroom"
          className="focus-ring rounded text-[11px] text-paper-400 transition hover:text-paper-100 sm:ml-auto"
        >
          github.com/bryankwandou/grainroom
        </a>
      </div>
    </footer>
  );
}

const PROGRAM_ID = "14a2jErBjHQv7fD64F6P1nLt6LXCsKgiyoi1c4mkyfaE";

function Registry() {
  const instructions = [
    {
      name: "register_look",
      d: "Claims a grade. The hash is the account address, so the first claim on a given set of settings is the only one that fits.",
    },
    {
      name: "register_derivative",
      d: "Claims a grade built on another. The parent must already exist, and its fork count goes up in the same call.",
    },
    {
      name: "purchase",
      d: "Pays the seller and every ancestor at once. The chain is walked and checked, not taken on trust.",
    },
    {
      name: "withdraw",
      d: "Moves collected royalties to the author. Rent stays behind so the record outlives the payout.",
    },
  ];

  return (
    <div className="mt-10 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <div className="rounded-xl border border-ink-800 bg-ink-800/40 p-5">
        <p className="text-[10px] uppercase tracking-wider text-paper-400">
          Program id
        </p>
        <a
          href={`https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="focus-ring tabular mt-2 block break-all text-[12px] leading-relaxed text-amber-300 underline-offset-2 hover:text-amber-200 hover:underline"
        >
          {PROGRAM_ID}
        </a>

        <dl className="mt-5 space-y-3 border-t border-ink-800 pt-5">
          <div>
            <dt className="text-[11px] text-paper-400">
              What the chain never sees
            </dt>
            <dd className="mt-0.5 text-[13px] leading-relaxed text-paper-200">
              The photograph. Only a 32-byte hash of the settings is published,
              and nothing about the image can be recovered from it.
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-paper-400">Royalty ceiling</dt>
            <dd className="mt-0.5 text-[13px] leading-relaxed text-paper-200">
              Ten percent per author, eight generations deep. A long chain of
              ancestors can never swallow the payment before it reaches the
              person who did the most recent work.
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-paper-400">Check it yourself</dt>
            <dd className="tabular mt-1 rounded-md border border-ink-700 bg-ink-900 px-2.5 py-2 text-[11px] leading-relaxed text-paper-300">
              node anchor/scripts/verify-devnet.js
            </dd>
          </div>
        </dl>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {instructions.map((i) => (
          <li
            key={i.name}
            className="rounded-xl border border-ink-800 bg-ink-800/40 p-5"
          >
            <p className="tabular text-[13px] font-medium text-amber-400">
              {i.name}
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-paper-400">
              {i.d}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-500">
      {children}
    </p>
  );
}

/** A safelight wash behind the hero, kept in CSS so it costs nothing. */
function Safelight() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-70"
      style={{
        background:
          "radial-gradient(70% 55% at 78% 18%, rgba(255,106,31,0.16), transparent 62%), radial-gradient(50% 45% at 12% 82%, rgba(184,65,15,0.10), transparent 60%)",
      }}
    />
  );
}

function LookDiagram() {
  const steps = [
    {
      t: "You edit",
      d: "Slider positions and curve points accumulate as you work. Nothing is baked into the pixels.",
    },
    {
      t: "It gets hashed",
      d: "The settings are serialised in a fixed order and hashed. Two people who land on identical settings get identical hashes.",
    },
    {
      t: "It gets handed on",
      d: "The Look fits in a link. Someone opens it, applies it to their own photo, and adjusts from there.",
    },
    {
      t: "The lineage holds",
      d: "Their version records yours as its parent, so the chain back to the original author survives every fork.",
    },
  ];

  return (
    <div className="mt-10 grid gap-3 md:grid-cols-4">
      {steps.map((s, i) => (
        <div key={s.t} className="relative rounded-xl border border-ink-800 bg-ink-800/40 p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="tabular flex h-6 w-6 items-center justify-center rounded-full border border-amber-500/40 text-[11px] font-medium text-amber-400">
              {i + 1}
            </span>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className="hidden h-px flex-1 bg-gradient-to-r from-amber-500/40 to-transparent md:block"
              />
            )}
          </div>
          <p className="text-[14px] font-medium text-paper-100">{s.t}</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-paper-400">{s.d}</p>
        </div>
      ))}
    </div>
  );
}
