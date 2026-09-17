"use client";

/**
 * The House of Videos entrance, at dusk.
 *
 * The building is a real model — `platform/public/house/entrance.glb`, built in
 * Blender by `platform/scripts/house/build_house.py` and committed. It is
 * constructed the way a building is: concrete piers and spandrels in front,
 * glazing set back behind them, so the reveals are geometry rather than
 * painted-on shading. An earlier pass at this was a box with a cone on top and
 * it looked like exactly that.
 *
 * The model carries no baked lighting — the `bpy` wheel ships EEVEE only, so
 * Cycles lightmaps are not available — which is why the light is all made here:
 * image-based lighting from `RoomEnvironment` (procedural, nothing to
 * download), a low warm key inside the entrance, a cool moon, and a bloom pass
 * so the lit windows read as light rather than as coloured rectangles.
 *
 * Loaded only by Facade.tsx, and only when there is a WebGL context and the
 * visitor has not asked for reduced motion — which is what keeps three.js and
 * the model out of the first load of /login, the one page outside the password
 * gate.
 *
 * Plain three, not react-three-fiber: R3F 9's stable line peers on
 * `react@">=19 <19.3"` while this app floats to 19.3, and it pulls an optional
 * expo/react-native peer graph that has no business in a Next app.
 *
 * Every colour below is a literal. The convention in globals.css allows that on
 * a surface that is the same in both themes, and says to name the reason: this
 * is a picture of a building at dusk. It does not invert at night any more than
 * a photograph would. The login card in front of it is themed normally.
 *
 * **The mesh names are load-bearing.** `bay_00`… are the window bays in the
 * order `windowStates()` returns them (left to right, top row first), and
 * `door_front` is the hotspot `lib/house.ts` binds to. Rename either in the
 * Blender script and this stops finding them.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import type { WindowState } from "@/lib/facade";

const MODEL = "/house/entrance.glb";

/** Window light colours, and how brightly each one burns. */
const LIGHT: Record<Exclude<WindowState, "dark">, { color: number; power: number }> = {
  // Tuned against the render, not guessed: above about 1.4 the bloom blows the
  // pane to white and floods the frame with its colour, which loses both the
  // window and the building behind it.
  run: { color: 0x5b8ee8, power: 1.05 }, // working
  wait: { color: 0xe6b45a, power: 1.25 }, // waiting on you — this one breathes
  err: { color: 0xea6a5f, power: 1.1 }, // failed
};
/** Unlit glass: dark, but still catching a little of the sky. */
const GLASS = 0x1a2338;

export default function FacadeScene({ lights }: { lights: WindowState[] }) {
  const host = useRef<HTMLDivElement>(null);
  // The latest lighting, read by the animation loop without restarting it.
  const lightsRef = useRef(lights);
  lightsRef.current = lights;

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    // Shadows and contact occlusion are most of what separates a lit model from
    // a flat one: without them every surface meets its neighbour with no
    // darkening, which is the giveaway that nothing is really touching.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0d16);
    scene.fog = new THREE.Fog(0x141a2e, 40, 120);

    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / mount.clientHeight, 0.1, 400);

    // Image-based lighting, generated rather than downloaded — no texture
    // library is reachable from this environment, and a scene lit by two
    // directional lights alone reads as plastic.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.34;

    scene.add(new THREE.AmbientLight(0x2a3358, 0.95));
    const moon = new THREE.DirectionalLight(0x8fa2d8, 1.35);
    moon.position.set(-18, 26, 16);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.near = 1;
    moon.shadow.camera.far = 90;
    const ext = 28;
    moon.shadow.camera.left = -ext;
    moon.shadow.camera.right = ext;
    moon.shadow.camera.top = ext;
    moon.shadow.camera.bottom = -ext;
    moon.shadow.bias = -0.0006;
    scene.add(moon);

    // The warm light spilling out of the entrance. It is what makes the door
    // read as the way in.
    const doorGlow = new THREE.PointLight(0xffb463, 85, 30, 2);
    doorGlow.position.set(0, 2.4, 1.2);
    scene.add(doorGlow);

    // --- post ---------------------------------------------------------------
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // Ambient occlusion was tried here and removed: on glazing recessed behind
    // deep reveals it is physically right and visually wrong — it crushed every
    // unlit pane to flat black, so the facade read as holes punched in concrete
    // rather than as windows. The shadow map gives the depth cue that actually
    // mattered, at a fraction of the cost on software GL.
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(mount.clientWidth, mount.clientHeight),
      0.48, // strength
      0.72, // radius
      0.62, // threshold — the lit windows and the doorway, nothing else
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // --- the model ----------------------------------------------------------
    const bays: THREE.MeshStandardMaterial[] = [];
    let raf = 0;
    const clock = new THREE.Clock();

    new GLTFLoader().load(MODEL, (gltf) => {
      if (disposed) return;
      const model = gltf.scene;

      // Each bay gets its own material so it can be lit independently. The
      // model ships them sharing one glass material; sharing it here would
      // light every window at once.
      const found: { i: number; mesh: THREE.Mesh }[] = [];
      model.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const m = /^bay_(\d+)$/.exec(o.name);
        if (m) found.push({ i: Number(m[1]), mesh: o });
      });
      found.sort((a, b) => a.i - b.i);
      for (const { mesh } of found) {
        const mat = new THREE.MeshStandardMaterial({
          color: GLASS,
          roughness: 0.05,
          metalness: 0.7,
          emissive: new THREE.Color(0x000000),
          emissiveIntensity: 1,
        });
        mesh.material = mat;
        bays.push(mat);
      }

      model.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      scene.add(model);
      draw();
    });

    // --- camera: standing at the foot of the steps -------------------------
    // Close enough that the doorway is the subject and the login card has the
    // entrance to sit in front of, far enough back that the glazed floors above
    // still read as a building.
    const place = () => {
      const portrait = mount.clientWidth / mount.clientHeight < 1.1;
      camera.position.set(0, portrait ? 8.5 : 7.2, portrait ? 46 : 32);
      camera.lookAt(0, portrait ? 10 : 9.2, 0);
    };
    place();

    const draw = () => {
      const t = clock.getElapsedTime();

      for (let i = 0; i < bays.length; i++) {
        const state = lightsRef.current[i] ?? "dark";
        const mat = bays[i];
        if (state === "dark") {
          mat.emissive.setHex(0x000000);
          mat.color.setHex(GLASS);
          continue;
        }
        const { color, power } = LIGHT[state];
        // Amber breathes: the window that wants you is the one that moves.
        const k = state === "wait" ? power * (0.72 + 0.28 * Math.sin(t * 1.5 + i)) : power;
        mat.emissive.setHex(color);
        mat.emissiveIntensity = k;
        mat.color.setHex(color);
      }

      // A slow drift, so the street feels inhabited rather than paused.
      camera.position.x = Math.sin(t * 0.07) * 1.4;
      camera.position.y += Math.sin(t * 0.055) * 0.0015;
      camera.lookAt(0, mount.clientWidth / mount.clientHeight < 1.1 ? 10 : 9.2, 0);

      composer.render();
      raf = requestAnimationFrame(draw);
    };

    // The pause rule: a hidden tab paints nothing, so it should not be drawing
    // sixty times a second to do it.
    const visibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf && bays.length) {
        clock.getDelta();
        draw();
      }
    };
    document.addEventListener("visibilitychange", visibility);

    const resize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      place();
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      composer.setSize(mount.clientWidth, mount.clientHeight);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", visibility);
      ro.disconnect();
      // A WebGL context is not garbage collected on unmount and browsers cap
      // how many may exist at once, so this has to be explicit.
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      });
      env.dispose();
      pmrem.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className="facade-gl" aria-hidden="true" />;
}
