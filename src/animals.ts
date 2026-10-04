import * as THREE from "three";
import { Surface } from "./humans";
import type { Actor } from "./model";
export interface AnimalRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  ears: THREE.Group[];
  legs: THREE.Group[];
  tail: THREE.Group;
  hare: boolean;
}
function joint(parent: THREE.Object3D, x: number, y: number, z: number) {
  const j = new THREE.Group();
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}
export function createAnimal(a: Actor): AnimalRig {
  const root = new THREE.Group(),
    hare = a.role === 0,
    body = joint(root, 0, 0, 0);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
  });
  const fur = hare
    ? a.id % 2
      ? "#ad9275"
      : "#d2bb97"
    : a.id % 2
      ? "#a77d53"
      : "#bc966b";
  const pale = "#e8d7b8",
    dark = "#3b3029",
    s = new Surface();
  s.oval(
    fur,
    0,
    hare ? 0.24 : 0.71,
    0.04,
    hare ? 0.19 : 0.22,
    hare ? 0.2 : 0.26,
    hare ? 0.3 : 0.48,
  );
  s.oval(
    pale,
    0,
    hare ? 0.19 : 0.63,
    -0.13,
    hare ? 0.14 : 0.17,
    hare ? 0.13 : 0.19,
    hare ? 0.19 : 0.27,
  );
  if (!hare) {
    s.oval(fur, 0, 0.99, -0.28, 0.14, 0.33, 0.17, [0.25, 0, 0]);
    for (const side of [-1, 1])
      for (let i = 0; i < 9; i++)
        s.oval(
          pale,
          side * (0.18 + (i % 2) * 0.015),
          0.8 + (i % 3) * 0.025,
          -0.18 + Math.floor(i / 3) * 0.19,
          0.018,
          0.024,
          0.026,
        );
  }
  s.finish(body, material);
  const head = joint(body, 0, hare ? 0.36 : 1.19, hare ? -0.2 : -0.38),
    face = new Surface();
  face.oval(
    fur,
    0,
    0,
    0,
    hare ? 0.12 : 0.13,
    hare ? 0.12 : 0.17,
    hare ? 0.13 : 0.19,
  );
  face.oval(
    pale,
    0,
    -0.055,
    -0.11,
    hare ? 0.085 : 0.08,
    0.058,
    hare ? 0.075 : 0.13,
  );
  face.oval(dark, 0, -0.032, hare ? -0.171 : -0.23, 0.03, 0.021, 0.017);
  for (const side of [-1, 1]) {
    face.oval(
      dark,
      side * (hare ? 0.086 : 0.105),
      0.018,
      -0.077,
      0.025,
      0.026,
      0.022,
    );
    face.oval(
      "#fff4d8",
      side * (hare ? 0.094 : 0.117),
      0.026,
      -0.091,
      0.008,
      0.009,
      0.008,
    );
  }
  face.finish(head, material);
  const ears = [-1, 1].map((side) => {
    const ear = joint(
        head,
        side * (hare ? 0.065 : 0.115),
        hare ? 0.07 : 0.09,
        0.015,
      ),
      e = new Surface();
    e.oval(
      fur,
      side * 0.025,
      hare ? 0.145 : 0.06,
      0.008,
      hare ? 0.044 : 0.095,
      hare ? 0.18 : 0.075,
      0.03,
      [0, 0, -side * (hare ? 0.15 : 0.4)],
    );
    e.oval(
      "#bd907e",
      side * 0.025,
      hare ? 0.145 : 0.06,
      -0.017,
      hare ? 0.024 : 0.065,
      hare ? 0.135 : 0.044,
      0.01,
      [0, 0, -side * (hare ? 0.15 : 0.4)],
    );
    e.finish(ear, material);
    return ear;
  });
  if (!hare && a.id === 9) {
    const antlers = new Surface();
    for (const side of [-1, 1]) {
      antlers.add(
        new THREE.CylinderGeometry(0.013, 0.028, 0.32, 7),
        "#dccaa4",
        [side * 0.105, 0.26, 0.012],
        [1, 1, 1],
        [0, 0, -side * 0.25],
      );
      for (let i = 0; i < 2; i++)
        antlers.add(
          new THREE.CylinderGeometry(0.006, 0.014, 0.14, 7),
          "#dccaa4",
          [side * (0.14 + i * 0.025), 0.24 + i * 0.09, -0.04],
          [1, 1, 1],
          [-0.6, 0, -side * 0.6],
        );
    }
    antlers.finish(head, material);
  }
  const legs: THREE.Group[] = [];
  for (const z of [-1, 1])
    for (const side of [-1, 1]) {
      const leg = joint(
          body,
          side * (hare ? 0.115 : 0.14),
          hare ? 0.16 : 0.64,
          z * (hare ? 0.18 : 0.3),
        ),
        l = new Surface();
      if (hare) {
        l.oval(fur, 0, -0.025, 0, z === 1 ? 0.095 : 0.045, 0.095, 0.075);
        l.oval(pale, 0, -0.115, -0.055, 0.048, 0.039, 0.095);
      } else {
        l.oval(fur, 0, -0.17, 0, 0.052, 0.21, 0.061);
        l.oval(fur, 0, -0.4, 0.01, 0.027, 0.2, 0.029);
        l.oval(dark, 0, -0.6, -0.025, 0.039, 0.042, 0.064);
      }
      l.finish(leg, material);
      legs.push(leg);
    }
  const tail = joint(body, 0, hare ? 0.27 : 0.85, hare ? 0.32 : 0.46),
    t = new Surface();
  t.oval(
    pale,
    0,
    0,
    0,
    hare ? 0.07 : 0.04,
    hare ? 0.065 : 0.13,
    hare ? 0.07 : 0.045,
    [0.45, 0, 0],
  );
  t.finish(tail, material);
  return { root, body, head, ears, legs, tail, hare };
}
export function poseAnimal(r: AnimalRig, a: Actor, tick: number): void {
  const t = tick / 60,
    phase = t * (r.hare ? 12 : 7) + a.id,
    walk = a.moving ? 1 : 0;
  r.body.position.y = r.hare
    ? Math.max(0, Math.sin(phase)) * 0.055 * walk
    : Math.abs(Math.sin(phase)) * 0.016 * walk;
  r.head.rotation.set(
    a.task === 4 ? 0.3 : !walk ? 0.2 + Math.sin(t * 0.9 + a.id) * 0.15 : 0,
    Math.sin(t * 0.7 + a.id) * 0.1,
    0,
  );
  r.ears.forEach((e, i) =>
    e.rotation.set(
      Math.sin(t * 2 + a.id + i) * 0.07,
      0,
      (i ? 1 : -1) * (0.06 + Math.sin(t * 0.5) * 0.05),
    ),
  );
  r.legs.forEach(
    (l, i) =>
      (l.rotation.x =
        Math.sin(
          phase +
            (r.hare ? (i < 2 ? 0 : Math.PI) : i === 0 || i === 3 ? 0 : Math.PI),
        ) *
        0.42 *
        walk),
  );
  r.tail.rotation.z = Math.sin(t * 4 + a.id) * 0.12;
}
