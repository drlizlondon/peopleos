import type {FC} from "react";
import {Composition, type CalculateMetadataFunction} from "remotion";
import {defaultAdConfig, type PeopleOSAdConfig} from "./config";
import {PeopleOSAd} from "./PeopleOSAd";

const calculateMetadata: CalculateMetadataFunction<PeopleOSAdConfig> = ({props}) => ({
  durationInFrames: Math.round(props.durationSeconds * 30),
  fps: 30,
  width: 1080,
  height: 1920,
  defaultCodec: "h264",
  defaultPixelFormat: "yuv420p"
});

export const RemotionRoot: FC = () => (
  <Composition
    id="PeopleOSDontFeelGuilty"
    component={PeopleOSAd}
    durationInFrames={405}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={defaultAdConfig}
    calculateMetadata={calculateMetadata}
  />
);
