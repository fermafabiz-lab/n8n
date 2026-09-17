"use client";

/**
 * The house at dusk, drawn in WebGL.
 *
 * Loaded only by Facade.tsx, and only when there is a WebGL context and the
 * visitor has not asked for reduced motion — which is also what keeps three.js
 * out of the first load of /login, the one page outside the password gate.
 *
 * Plain three, not react-three-fiber: R3F 9's stable line peers on
 * `react@">=19 <19.3"` and this app floats to 19.3, and it pulls an optional
 * expo/react-native peer graph that has no business in a Next web app. A
 * reconciler earns its keep when a scene is built out of components that mount
 * and unmount; this one is a dozen meshes that never change shape, so the
 * whole scene is built once here and only the window colours and the camera
 * move afterwards.
 *
 * Every colour below is a literal. The convention in globals.css allows that
 * on a surface that is the same in both themes, and says to name the reason:
 * this is a picture of a building at dusk. It does not invert at night any
 * more than a photograph would. The login card in front of it is themed
 * normally.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";

import { WINDOWS, type WindowState } from "@/lib/facade";

/** Window light colours, and how brightly each one burns. */
const LIGHT: Record<Exclude<WindowState, "dark">, { color: number; intensity: number }> = {
  run: { color: 0x5b8ee8, intensity: 0.85 }, // working
  wait: { color: 0xe6b45a, intensity: 1.0 }, // waiting on you — this one pulses
  err: { color: 0xea6a5f, intensity: 0.95 }, // failed
};
const DARK = 0x11131a;

const COLS = 6;

export default function FacadeScene({ lights }: { lights: WindowState[] }) {
  const host = useRef<HTMLDivElement>(null);
  // The latest lighting, read by the animation loop without restarting it.
  const lightsRef = useRef(lights);
  lightsRef.current = lights;

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x232840, 22, 60);

    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / mount.clientHeight, 0.1, 120);
    // Far enough back, and high enough, that the whole elevation and its roof
    // sit inside the frame with sky above and street below. Closer than this
    // and the house stops reading as a house and becomes a wall of lit
    // rectangles.
    camera.position.set(0, 5.2, 24);
    camera.lookAt(0, 4.6, 0);

    // --- the sky: one gradient plane behind everything ---------------------
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 60),
      new THREE.ShaderMaterial({
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color(0x121626) },
          bottom: { value: new THREE.Color(0x5a4470) },
        },
        vertexShader: `varying float h;
          void main(){ h = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying float h; uniform vec3 top; uniform vec3 bottom;
          void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(0.0,1.0,h)), 1.0); }`,
      }),
    );
    sky.position.set(0, 6, -22);
    scene.add(sky);

    // --- the house ---------------------------------------------------------
    const house = new THREE.Group();
    scene.add(house);

    // Off-centre on a wide screen, because the login card sits in the left of
    // the frame and a lit window hidden behind it is a readout nobody can
    // read. On a narrow one the card re-centres and the house is only a
    // backdrop, so it re-centres too — a building sliding off one edge looks
    // like a mistake, cropped evenly looks deliberate.
    const placeHouse = () => {
      const portrait = mount.clientWidth / mount.clientHeight < 1.1;
      house.position.x = portrait ? 0 : 3.2;
    };
    placeHouse();

    const wall = new THREE.MeshStandardMaterial({ color: 0x2b3040, roughness: 0.95, metalness: 0 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(9, 8, 6), wall);
    body.position.y = 4;
    house.add(body);

    // A four-sided cone is a hipped roof, and costs one geometry.
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(7.1, 2.5, 4),
      new THREE.MeshStandardMaterial({ color: 0x1a1d27, roughness: 1, metalness: 0 }),
    );
    roof.position.y = 9.25;
    roof.rotation.y = Math.PI / 4;
    house.add(roof);

    // --- the windows -------------------------------------------------------
    // One shared geometry, one material each, because each pane carries its
    // own colour and the amber ones breathe independently.
    const paneGeo = new THREE.PlaneGeometry(0.82, 1.05);
    // A bigger, additive plane sitting just proud of each pane. Without it a
    // lit window is a flat swatch — the painted fallback gets its glow from a
    // box-shadow, and the two renderers should agree about what "lit" looks
    // like. Cheaper than a bloom pass, which would mean another dependency.
    const haloGeo = new THREE.PlaneGeometry(2.6, 2.9);
    // A flat additive plane is just a bigger rectangle — it has to fall off
    // from the centre or the "glow" reads as a blocky square around the pane.
    const haloShader = {
      vertexShader: `varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform vec3 uColor; uniform float uAlpha;
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          gl_FragColor = vec4(uColor, a * a * uAlpha);
        }`,
    };
    const panes: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
    const halos: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
    for (let i = 0; i < WINDOWS; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = (col - (COLS - 1) / 2) * 1.42;
      const y = 6.9 - row * 1.3;

      const halo = new THREE.Mesh(
        haloGeo,
        new THREE.ShaderMaterial({
          ...haloShader,
          uniforms: { uColor: { value: new THREE.Color(DARK) }, uAlpha: { value: 0 } },
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      halo.position.set(x, y, 3.005);
      house.add(halo);
      halos.push(halo);

      const m = new THREE.Mesh(paneGeo, new THREE.MeshBasicMaterial({ color: DARK }));
      m.position.set(x, y, 3.01);
      house.add(m);
      panes.push(m);
    }

    // --- the door: always warm, it is the way in ---------------------------
    const door = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 2.2),
      new THREE.MeshBasicMaterial({ color: 0xffb95e }),
    );
    door.position.set(0, 1.1, 3.02);
    house.add(door);

    const spill = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 0.9),
      new THREE.MeshBasicMaterial({ color: 0xffb95e, transparent: true, opacity: 0.16 }),
    );
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(0, 0.02, 4.3);
    house.add(spill);

    // Two unlit neighbours. Without them the house floats in fog; with them
    // it stands in a row, which is what makes it a street.
    const neighbour = new THREE.MeshStandardMaterial({ color: 0x242836, roughness: 1 });
    for (const [x, w, h] of [
      [-10.5, 7.5, 9.5],
      [10.8, 8, 10.6],
    ] as const) {
      const n = new THREE.Mesh(new THREE.BoxGeometry(w, h, 5.5), neighbour);
      // Set back behind the house's front face, so they read as the rest of
      // the street rather than as slabs standing beside it.
      n.position.set(x, h / 2, -3.2);
      house.add(n);
    }

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 60),
      new THREE.MeshStandardMaterial({ color: 0x191c26, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    scene.add(new THREE.AmbientLight(0x585276, 1.5));
    const moon = new THREE.DirectionalLight(0x9aa6d0, 0.95);
    moon.position.set(-6, 9, 7);
    scene.add(moon);

    // --- the loop ----------------------------------------------------------
    let raf = 0;
    const clock = new THREE.Clock();

    const draw = () => {
      const t = clock.getElapsedTime();

      for (let i = 0; i < panes.length; i++) {
        const state = lightsRef.current[i] ?? "dark";
        const mat = panes[i].material;
        const halo = halos[i].material.uniforms;
        if (state === "dark") {
          mat.color.setHex(DARK);
          halo.uAlpha.value = 0;
          continue;
        }
        const { color, intensity } = LIGHT[state];
        // Amber breathes: the window that wants you is the one that moves.
        const k = state === "wait" ? intensity * (0.72 + 0.28 * Math.sin(t * 1.6 + i)) : intensity;
        mat.color.setHex(color).multiplyScalar(k);
        halo.uColor.value.setHex(color);
        halo.uAlpha.value = 0.85 * k;
      }

      // A slow drift, so the street feels inhabited rather than paused.
      camera.position.x = Math.sin(t * 0.08) * 1.1;
      camera.position.y = 5.2 + Math.sin(t * 0.06) * 0.15;
      camera.position.z = 24;
      camera.lookAt(0, 4.6, 0);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(draw);
    };
    draw();

    // The pause rule: a hidden tab paints nothing, so it should not be drawing
    // sixty times a second to do it.
    const visibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf) {
        clock.getDelta(); // drop the gap so the pulse does not jump on return
        draw();
      }
    };
    document.addEventListener("visibilitychange", visibility);

    const resize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      placeHouse();
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", visibility);
      ro.disconnect();
      // A WebGL context is not garbage collected on unmount; browsers cap how
      // many may exist at once, so this has to be explicit.
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className="facade-gl" aria-hidden="true" />;
}
