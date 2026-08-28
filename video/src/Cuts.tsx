/**
 * The social cuts.
 *
 * Both play muted and both are watched by someone who did not choose to watch
 * them, so the argument has to survive on type and one moving picture. The
 * settlement is the hook rather than the payoff: it is the only line here that
 * a photo editor cannot say.
 */
import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { C } from "./theme";
import { Body, Develop, Eyebrow, Headline, Hold, Print, Room, Row, mono } from "./parts";

/* ------------------------------------------------------------------ */
/* Twitter — 30 seconds, 16:9, read at arm's length                    */
/* ------------------------------------------------------------------ */

const wide: React.CSSProperties = {
  padding: "100px 120px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
};

export const Twitter: React.FC = () => (
  <Room>
    <Sequence durationInFrames={120} premountFor={30}>
      <Hold out={96} style={wide}>
        <Headline delay={4} size={118}>
          Sell a preset today
          <br />
          and it is in a shared
          <br />
          folder by Friday.
        </Headline>
      </Hold>
    </Sequence>

    <Sequence from={120} durationInFrames={240} premountFor={45}>
      <Hold out={216} style={{ ...wide, alignItems: "center" }}>
        <Develop
          from="frames/0.png"
          to="frames/1.png"
          at={54}
          delay={4}
          width={1180}
          caption="Twenty-one tools · nothing uploaded · no watermark"
        />
      </Hold>
    </Sequence>

    <Sequence from={360} durationInFrames={300} premountFor={45}>
      <Hold out={276} style={wide}>
        <Eyebrow>What a Look does that a file cannot · SOL</Eyebrow>
        <div style={{ height: 34 }} />
        <Row what="Fork sold" who="Buyer pays" amount="0.200" delay={26} />
        <Row
          what="Upstream share"
          who="First author"
          amount="+0.010"
          delay={62}
          accent={C.fixer}
        />
        <Row
          what="Remainder"
          who="Second author"
          amount="+0.190"
          delay={98}
          accent={C.fixer}
        />
        <div style={{ height: 34 }} />
        <Body delay={150} size={34} color={C.grey}>
          Settled in one transaction. Skipping the first author fails rather
          than paying less.
        </Body>
      </Hold>
    </Sequence>

    <Sequence from={660} durationInFrames={240} premountFor={45}>
      <AbsoluteFill style={{ ...wide, alignItems: "center", justifyContent: "center" }}>
        <Print src="frames/7.png" delay={0} width={780} />
        <div style={{ height: 44 }} />
        <Headline delay={30} size={64}>
          grainroom-seven.vercel.app
        </Headline>
        <div style={{ height: 18 }} />
        <Body delay={56} size={26} color={C.grey} width={1000}>
          <span style={{ fontFamily: mono }}>runs offline · solana devnet</span>
        </Body>
      </AbsoluteFill>
    </Sequence>
  </Room>
);

/* ------------------------------------------------------------------ */
/* Vertical — 20 seconds, 9:16, safe zones respected                   */
/* ------------------------------------------------------------------ */

const tall: React.CSSProperties = {
  // Top and bottom are left clear of the platform's own furniture: the
  // caption, the handle, the buttons down the right-hand side.
  padding: "200px 80px 260px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
};

export const Vertical: React.FC = () => (
  <Room>
    <Sequence durationInFrames={120} premountFor={30}>
      <Hold out={96} style={tall}>
        <Headline delay={4} size={104}>
          Your grade.
          <br />
          Somebody
          <br />
          else&rsquo;s folder.
        </Headline>
      </Hold>
    </Sequence>

    <Sequence from={120} durationInFrames={210} premountFor={45}>
      <Hold out={186} style={{ ...tall, alignItems: "center" }}>
        <Develop
          from="frames/5.png"
          to="frames/6.png"
          at={48}
          delay={4}
          width={880}
          caption="Edited in the browser"
        />
      </Hold>
    </Sequence>

    <Sequence from={330} durationInFrames={150} premountFor={45}>
      <Hold out={126} style={tall}>
        <Eyebrow>On sale, on devnet</Eyebrow>
        <div style={{ height: 30 }} />
        <Headline delay={16} size={92}>
          0.010 SOL
          <br />
          goes upstream
          <br />
          on its own.
        </Headline>
        <div style={{ height: 30 }} />
        <Body delay={54} size={38} color={C.grey} width={840}>
          Out of a 0.200 sale, without asking anyone.
        </Body>
      </Hold>
    </Sequence>

    <Sequence from={480} durationInFrames={120} premountFor={45}>
      <AbsoluteFill style={{ ...tall, alignItems: "center", justifyContent: "center" }}>
        <Headline delay={6} size={72}>
          grainroom-seven
          <br />
          .vercel.app
        </Headline>
        <div style={{ height: 26 }} />
        <Body delay={38} size={32} color={C.grey} width={800}>
          <span style={{ fontFamily: mono }}>free · offline · no watermark</span>
        </Body>
      </AbsoluteFill>
    </Sequence>
  </Room>
);
