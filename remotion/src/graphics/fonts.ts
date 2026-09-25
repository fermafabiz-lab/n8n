import {loadFont as loadLeagueGothic} from '@remotion/google-fonts/LeagueGothic';
import {loadFont as loadJetBrainsMono} from '@remotion/google-fonts/JetBrainsMono';
import {loadFont as loadMontserrat} from '@remotion/google-fonts/Montserrat';
import {loadFont as loadSpaceMono} from '@remotion/google-fonts/SpaceMono';
import {loadFont as loadArchivoBlack} from '@remotion/google-fonts/ArchivoBlack';
import {loadFont as loadBarlowCondensed} from '@remotion/google-fonts/BarlowCondensed';
import {loadFont as loadCaveat} from '@remotion/google-fonts/Caveat';
import {loadFont as loadInter} from '@remotion/google-fonts/Inter';

// The faces of the graphic styles, from the catalog blocks each element was
// modelled on. latin-ext on every one: ș and ț live there (docs:
// lessons-render, "latin-ext"). Weights must match server/hf-bundle.mjs FONTS,
// which fails the page at load if one is missing.
const ext = {subsets: ['latin', 'latin-ext'] as ('latin' | 'latin-ext')[]};
export const GF = {
	leagueGothic: loadLeagueGothic('normal', {weights: ['400'], ...ext}).fontFamily,
	jetbrainsMono: loadJetBrainsMono('normal', {weights: ['400'], ...ext}).fontFamily,
	montserrat: loadMontserrat('normal', {weights: ['400', '700'], ...ext}).fontFamily,
	spaceMono: loadSpaceMono('normal', {weights: ['700'], ...ext}).fontFamily,
	archivoBlack: loadArchivoBlack('normal', {weights: ['400'], ...ext}).fontFamily,
	barlowCondensed: loadBarlowCondensed('normal', {weights: ['700', '800'], ...ext}).fontFamily,
	caveat: loadCaveat('normal', {weights: ['700'], ...ext}).fontFamily,
	inter: loadInter('normal', {weights: ['400', '500', '600'], ...ext}).fontFamily,
};
