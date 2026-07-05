import {Config} from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// Lambda renders are billed by GB-seconds; chromium-headless-shell keeps memory low.
Config.setChromiumOpenGlRenderer('angle');
