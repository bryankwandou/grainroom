import React from "react";
import { Composition } from "remotion";
import { Demo } from "./Demo";
import { Twitter, Vertical } from "./Cuts";

/**
 * Three cuts of one argument.
 *
 * The submission cut has room to show the product working; the social cuts
 * have to land the problem and the settlement before a thumb moves. Sharing
 * the same components keeps them from drifting into three different films.
 */
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Demo"
      component={Demo}
      durationInFrames={2100}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="Twitter"
      component={Twitter}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="Vertical"
      component={Vertical}
      durationInFrames={600}
      fps={30}
      width={1080}
      height={1920}
    />
  </>
);
