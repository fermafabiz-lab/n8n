/**
 * The house's routing table — mesh names on one side, app routes on the other.
 *
 * The 3D shell navigates the way basement.studio's does: one canvas that is
 * never unmounted, and a clickable object in the scene is a *named mesh* from
 * the GLB bound to a route. That makes the geometry's node names load-bearing:
 * rename `door_new` in Blender and the brief stops being reachable, with
 * nothing in the type system to notice. There is no compiler across that
 * boundary — a GLB is data — so the contract is written down here instead, and
 * `npm run check:house` asserts it in both directions.
 *
 * This file is the ONE owner of those names. The modelling brief reads it, the
 * scene reads it, and the check reads it; nothing restates a mesh name.
 *
 * What is deliberately NOT here yet: camera positions. A `{position, target,
 * fov}` per room is meaningless before the model exists, and a plausible-looking
 * placeholder coordinate is worse than an absent one — it reads as measured.
 * Those arrive with the geometry.
 */

/** Where a hotspot stands. Half documentation, half the modelling brief. */
export type Place =
  | "hall-ahead"
  | "hall-left"
  | "hall-right"
  | "hall-back-left"
  | "hall-back-right"
  | "hall-up"
  | "hall-under-stairs"
  | "hall-behind"
  | "office"
  | "bench"
  | "screening";

/**
 * One clickable thing in the house.
 *
 * Exactly one of `route` and `action` is set. Navigation and behaviour are not
 * the same kind of thing, and a hotspot that quietly had both would be a door
 * whose destination depends on how you clicked it.
 */
export interface Hotspot {
  /** The node name in the GLB. This IS the routing key — see the file header. */
  mesh: string;
  /** What the cursor says on hover. */
  hoverName: string;
  /** Where it stands. */
  where: Place;
  /** The app route it opens. */
  route?: string;
  /** What it does instead, when it is not navigation at all. */
  action?: string;
  /**
   * The route is not built yet, on purpose. The check asserts a planned route
   * does NOT resolve — so the day someone builds it, the check says to flip
   * this to a live door rather than letting the two drift quietly apart.
   */
  planned?: true;
}

/**
 * The prefixes a mesh name may use. Not decoration: the prefix says what the
 * thing IS, so a modelling pass can be checked without opening the scene, and
 * a stray mesh (`Cube.003`) can never accidentally become a link.
 */
export const MESH_PREFIXES = [
  "door",
  "stairs",
  "hatch",
  "lamp",
  "board",
  "drum",
  "chute",
  "bench",
  "screen",
  "rack",
] as const;

export const MESH_NAME = new RegExp(`^(${MESH_PREFIXES.join("|")})_[a-z][a-z0-9]*$`);

/**
 * The hall, and the rooms reached from it.
 *
 * The bearings are the structure: you come in the front door, the board is the
 * wall you face, and the rooms are left, right and behind you. Two of these
 * repair gaps the flat nav has today — `/series` has no desktop link at all
 * (it exists only in the phone menu), and the ops panel is buried at the foot
 * of `/projects` where nobody looks until something is already wrong.
 */
export const HALL: Hotspot[] = [
  {
    mesh: "board_floor",
    hoverName: "Today's floor",
    where: "hall-ahead",
    // The wall you face on entering: the hero line, the three running
    // projects, the stat tiles. Clicking through goes to the full list.
    route: "/projects",
  },
  {
    mesh: "door_new",
    hoverName: "Start a film",
    where: "hall-left",
    route: "/new",
  },
  {
    mesh: "door_projects",
    hoverName: "The floor",
    where: "hall-right",
    route: "/projects",
  },
  {
    mesh: "door_series",
    hoverName: "The shows",
    where: "hall-back-left",
    route: "/series",
  },
  {
    mesh: "stairs_cellar",
    hoverName: "The archive",
    where: "hall-back-right",
    route: "/admin/footage",
  },
  {
    mesh: "stairs_office",
    hoverName: "The office",
    where: "hall-up",
    route: "/admin",
  },
  {
    // The ops panel as a room with a light on it. There is no route for it
    // today — it is a component rendered at the bottom of /projects — so the
    // hatch is planned until `/admin/ops` exists.
    mesh: "hatch_boiler",
    hoverName: "The boiler room",
    where: "hall-under-stairs",
    route: "/admin/ops",
    planned: true,
  },
  {
    mesh: "door_front",
    hoverName: "Outside",
    where: "hall-behind",
    route: "/",
  },
  {
    // Not navigation. Reel Toss: throw reels into the archive chute.
    mesh: "chute_reeltoss",
    hoverName: "Reel toss",
    where: "hall-under-stairs",
    action: "reel-toss",
  },
];

/** Inside the office: the lamp whose switch is the real setting. */
export const OFFICE: Hotspot[] = [
  {
    mesh: "lamp_theme",
    hoverName: "The lamp",
    where: "office",
    route: "/admin/customize",
  },
];

/** Inside the writing room: the genre drum, which `GenreSpiral` already is. */
export const WRITING_ROOM: Hotspot[] = [
  {
    // GenreSpiral computes a helix in cylindrical coordinates by hand because
    // CSS `perspective` projected it wrong. In the scene it stops simulating a
    // drum and becomes one; the slug list stays GenreSpiral's.
    mesh: "drum_genres",
    hoverName: "Pick a look",
    where: "bench",
    action: "genre-drum",
  },
];

/**
 * The edit bench: one long bench, and the pipeline's stages are positions
 * along it rather than separate rooms.
 *
 * The data argues for this shape. `images` and `video` are the same
 * `SceneBoard` component under a different `focus` prop — one station in two
 * lights, not two rooms — and a silent film drops `audio` entirely, so the
 * booth goes dark rather than going missing. The last stage is not a station
 * at all: it is the door at the end, into the screening room.
 *
 * `check:house` asserts this list matches `STAGE_KEYS` in
 * `app/projects/[id]/page.tsx` exactly, in order. Add a stage to the pipeline
 * and the check fails until the bench grows a station for it.
 */
export const BENCH: { stage: string; mesh: string; label: string }[] = [
  { stage: "script", mesh: "bench_script", label: "The script desk" },
  { stage: "scenes", mesh: "bench_scenes", label: "The storyboard wall" },
  { stage: "audio", mesh: "bench_audio", label: "The sound booth" },
  { stage: "images", mesh: "bench_images", label: "The lightbox" },
  { stage: "video", mesh: "bench_video", label: "The monitors" },
  { stage: "final", mesh: "bench_final", label: "The console" },
  { stage: "assembly", mesh: "door_screening", label: "The screening room" },
];

/**
 * Routes that are deliberately not doors, each with the reason.
 *
 * Without this the check could only nag or be switched off. A route belongs
 * here when it is genuinely reached from inside something else — an alcove, a
 * drawer, a reel you picked up — and the reason is the record of that
 * decision.
 */
export const NOT_A_DOOR: { route: string; why: string }[] = [
  {
    route: "/login",
    why: "The façade. This is where you enter the house, so it has no door inside it.",
  },
  {
    route: "/projects/[id]",
    why: "The edit bench, reached by picking a reel on the floor. Covered by BENCH.",
  },
  {
    route: "/series/[id]",
    why: "An alcove inside the gallery, reached by picking a show off the wall.",
  },
  {
    route: "/admin/account",
    why: "A drawer in the office desk, and deliberately an empty placeholder page.",
  },
  {
    route: "/admin/billing",
    why: "A drawer in the office desk, and deliberately an empty placeholder page.",
  },
  {
    route: "/admin/notifications",
    why: "A drawer in the office desk, and deliberately an empty placeholder page.",
  },
];

/** Every hotspot in the house, wherever it stands. */
export const HOTSPOTS: Hotspot[] = [...HALL, ...OFFICE, ...WRITING_ROOM];
