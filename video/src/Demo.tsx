/**
 * The submission cut: seventy seconds, 16:9.
 *
 * Structure is problem, then the editor working, then the money settling,
 * then what was checked. The order is deliberate — a judge who stops watching
 * after twenty seconds should still have seen the product do something.
 */
import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { C } from "./theme";
import {
  Body,
  Develop,
  Eyebrow,
  Figure,
  Headline,
  Hold,
  Print,
  Room,
  Row,
  body,
  display,
  mono,
} from "./parts";

const pad: React.CSSProperties = {
  padding: "110px 130px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
};

export const Demo: React.FC = () => (
  <Room>
    {/* ---- 0:00 cold open ---- */}
    <Sequence durationInFrames={150} premountFor={30}>
      <Hold out={126} style={{ ...pad, justifyContent: "center" }}>
        <Headline delay={8} size={128}>
          Open a photograph.
          <br />
          Nothing leaves
          <br />
          the machine.
        </Headline>
        <div style={{ height: 44 }} />
        <Eyebrow delay={52}>Grainroom · a darkroom in the browser</Eyebrow>
      </Hold>
    </Sequence>

    {/* ---- 0:05 the problem ---- */}
    <Sequence from={150} durationInFrames={210} premountFor={30}>
      <Hold out={186} style={pad}>
        <Eyebrow>The gap</Eyebrow>
        <div style={{ height: 34 }} />
        <Headline delay={14} size={92}>
          A preset is somebody&rsquo;s
          <br />
          week of work.
        </Headline>
        <div style={{ height: 40 }} />
        <Body delay={46} size={40}>
          It sells on Monday and it is in a shared folder by the weekend.
        </Body>
        <Body delay={72} size={40} color={C.grey}>
          Nothing in the file separates the copy somebody paid for from the one
          they did not, because the two files are the same bytes.
        </Body>
      </Hold>
    </Sequence>

    {/* ---- 0:12 the editor, working ---- */}
    <Sequence from={360} durationInFrames={240} premountFor={45}>
      <Hold
        out={216}
        style={{ ...pad, alignItems: "center", justifyContent: "center" }}
      >
        <Develop
          from="frames/0.png"
          to="frames/1.png"
          at={70}
          delay={6}
          width={1240}
          caption="Untouched · Safelight — twenty-one tools, on your own graphics card"
        />
      </Hold>
    </Sequence>

    {/* ---- 0:20 geometry ---- */}
    <Sequence from={600} durationInFrames={200} premountFor={45}>
      <Hold out={176} style={{ ...pad, flexDirection: "row", gap: 90, alignItems: "center" }}>
        <Print src="frames/2.png" delay={6} width={760} caption="Cropped, straightened, framed" />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Eyebrow delay={40}>Geometry</Eyebrow>
          <div style={{ height: 26 }} />
          <Headline delay={54} size={72}>
            The frame is
            <br />
            part of the recipe.
          </Headline>
          <div style={{ height: 26 }} />
          <Body delay={78} size={32} width={520}>
            Crop, straighten and keystone run in the first pass, so grain and
            vignette land on the picture you keep.
          </Body>
        </div>
      </Hold>
    </Sequence>

    {/* ---- 0:27 painted work ---- */}
    <Sequence from={800} durationInFrames={200} premountFor={45}>
      <Hold out={176} style={{ ...pad, flexDirection: "row", gap: 90, alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Eyebrow delay={40}>By hand</Eyebrow>
          <div style={{ height: 26 }} />
          <Headline delay={54} size={72}>
            Dodged, burned,
            <br />
            and held to tone.
          </Headline>
          <div style={{ height: 26 }} />
          <Body delay={78} size={32} width={520}>
            Brush marks are stored as coordinates in the photograph, not as a
            bitmap, so the recipe still fits in a link.
          </Body>
        </div>
        <Print src="frames/3.png" delay={6} width={760} caption="Painted light, one selective point" />
      </Hold>
    </Sequence>

    {/* ---- 0:33 the Look ---- */}
    <Sequence from={1000} durationInFrames={230} premountFor={45}>
      <Hold out={206} style={pad}>
        <Eyebrow>What travels</Eyebrow>
        <div style={{ height: 30 }} />
        <Headline delay={12} size={80}>
          The photograph stays put.
          <br />
          Only the recipe moves.
        </Headline>
        <div style={{ height: 44 }} />
        <div
          style={{
            fontFamily: mono,
            fontSize: 31,
            lineHeight: 1.85,
            color: C.paperDim,
            backgroundColor: C.tray,
            border: `1px solid ${C.edge}`,
            borderLeft: `3px solid ${C.safelight}`,
            padding: "30px 36px",
            maxWidth: 1300,
          }}
        >
          <Body delay={44} size={31} color={C.paperDim} width={1300}>
            <span style={{ fontFamily: mono }}>
              {"{ id: "}
              <span style={{ color: C.safelight }}>&quot;9f2c…a713&quot;</span>
              {", parent: "}
              <span style={{ color: C.safelight }}>&quot;4b81…0c92&quot;</span>
              {", params: { … } }"}
            </span>
          </Body>
        </div>
        <div style={{ height: 30 }} />
        <Body delay={80} size={34} color={C.grey}>
          A few hundred bytes, hashed from its own contents. The pixels are not
          in there, and never were.
        </Body>
      </Hold>
    </Sequence>

    {/* ---- 0:41 the settlement ---- */}
    <Sequence from={1230} durationInFrames={330} premountFor={45}>
      <Hold out={306} style={pad}>
        <Eyebrow>One sale, on devnet · amounts in SOL</Eyebrow>
        <div style={{ height: 30 }} />
        <Headline delay={12} size={78}>
          The upstream author is
          <br />
          paid in the same transaction.
        </Headline>
        <div style={{ height: 40 }} />
        <Row what="Fork sold" who="Buyer pays" amount="0.200" delay={60} />
        <Row
          what="Upstream share, taken on the way past"
          who="First author"
          amount="+0.010"
          delay={100}
          accent={C.fixer}
        />
        <Row
          what="Remainder"
          who="Second author"
          amount="+0.190"
          delay={140}
          accent={C.fixer}
        />
        <div style={{ height: 34 }} />
        <Body delay={190} size={32} color={C.grey}>
          Leaving the first author off the transaction does not pay them less.
          It fails.
        </Body>
      </Hold>
    </Sequence>

    {/* ---- 0:52 what was checked ---- */}
    <Sequence from={1560} durationInFrames={300} premountFor={45}>
      <Hold out={276} style={pad}>
        <Eyebrow>Checked, not claimed</Eyebrow>
        <div style={{ height: 34 }} />
        <div style={{ display: "flex", gap: 70 }}>
          <Figure value="6" label="settlement checks against the live devnet program" delay={20} />
          <Figure value="18" label="rendered assertions on the editing pipeline" delay={50} />
          <Figure value="3" label="shader programs compiled before anything ships" delay={80} />
        </div>
        <div style={{ height: 54 }} />
        <Body delay={130} size={32} color={C.paperDim}>
          The render test found that every photograph had been coming out upside
          down. It compiled, it typechecked, it built, and it was wrong.
        </Body>
        <div style={{ height: 18 }} />
        <Body delay={165} size={32} color={C.grey}>
          That is the difference between a test that runs the product and a test
          that reads it.
        </Body>
      </Hold>
    </Sequence>

    {/* ---- 1:02 close ---- */}
    <Sequence from={1860} durationInFrames={240} premountFor={45}>
      <AbsoluteFill style={{ ...pad, alignItems: "center", justifyContent: "center" }}>
        <Print src="frames/4.png" delay={0} width={900} />
        <div style={{ height: 46 }} />
        <div
          style={{
            fontFamily: display,
            fontSize: 62,
            color: C.paper,
            letterSpacing: -1,
          }}
        >
          <Headline delay={34} size={62}>
            grainroom-seven.vercel.app
          </Headline>
        </div>
        <div style={{ height: 22 }} />
        <Body delay={62} size={27} color={C.grey} width={1200}>
          <span style={{ fontFamily: mono }}>
            devnet · 14a2jErBjHQv7fD64F6P1nLt6LXCsKgiyoi1c4mkyfaE
          </span>
        </Body>
      </AbsoluteFill>
    </Sequence>
  </Room>
);

export const bodyFont = body;
