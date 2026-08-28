import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// The frames are photographs of a graded print; anything looser than this
// shows banding in the sky, which is the one thing the product is about.
Config.setCrf(18);
