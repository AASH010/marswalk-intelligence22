import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Canvas, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";

import * as THREE from "three";

import { getHeightmap, TERRAIN_TEXTURE_URL } from "../../api/terrain";
import { formatCoordinate } from "../../utils/coordinates";
import Spinner from "../ui/Spinner";

import "./Terrain3D.css";

/**
 * 3D terrain view of the Jezero AOI.
 *
 * One metric transform is shared by everything in the scene:
 *   world x =  (X - centerX) * S
 *   world z = -(Y - centerY) * S          (north is -z)
 *   world y =  (elevation - minElevation) * S * exaggeration
 * with S = 100 / (larger AOI side in metres). Horizontal and vertical use the
 * same scale, so "1x" is the true shape of the ground and the stated
 * exaggeration is exactly what is drawn.
 *
 * The terrain, the route, the Start / Goal markers and the science targets all
 * get their height from the same triangulated surface that is rendered (see
 * createSurfaceSampler), so nothing floats above or sinks below the mesh.
 */

// three.js cannot read CSS custom properties, so the scene colours repeat the
// design tokens from src/styles/tokens.css by value.
const SCENE_BACKGROUND = "#080E14"; // Deep Space
const GRID_MAJOR = "#405464"; // Strong Border
const GRID_MINOR = "#293B49"; // Default Border
const ROUTE_COLOR = "#55D6E8"; // Mission Cyan
const ROUTE_STALE_COLOR = "#F4B860"; // Warning
const ROUTE_CASING = "#080E14"; // Deep Space
const START_COLOR = "#55C99A"; // Success
const GOAL_COLOR = "#F07178"; // Critical
const SCIENCE_COLOR = "#A78BFA"; // Science Violet

// Surface colours for the elevation model when the CTX texture is unavailable.
// They stand in for imagery, so they stay outside the interface palette.
const SLOPE_SHADING_LOW = "#765b43";
const SLOPE_SHADING_MID = "#b58b55";
const SLOPE_SHADING_HIGH = "#d9c7a0";
const SKIRT_COLOR = "#2a211b";

const WORLD_SIZE = 100; // world units across the larger AOI side
const EXAGGERATIONS = [1, 2, 3, 5];
const DEFAULT_EXAGGERATION = 3;
const ROUTE_LIFT_M = 3; // metres above the surface, keeps the line out of the mesh
const ROUTE_STEP_FRACTION = 0.25; // route samples per DEM cell along each segment
const MARKER_POLE_M = 260; // Start / Goal pole height in metres (before exaggeration)

// ============================================================
// Surface model
// ============================================================

/** Index of the last grid position <= value (grid is ascending), clamped. */
function bracket(grid, value) {
  let lo = 0;
  let hi = grid.length - 1;
  if (value <= grid[0]) return 0;
  if (value >= grid[hi]) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (grid[mid] <= value) lo = mid;
    else hi = mid;
  }
  return lo;
}

function validateHeightmap(data) {
  const rows = data?.height;
  const cols = data?.width;
  const ok =
    Number.isInteger(rows) &&
    Number.isInteger(cols) &&
    rows >= 2 &&
    cols >= 2 &&
    data.elevation_m?.length === rows &&
    data.slope_deg?.length === rows &&
    data.valid_mask?.length === rows &&
    data.row_indices?.length === rows &&
    data.col_indices?.length === cols &&
    Array.isArray(data.transform) &&
    data.transform.length >= 6 &&
    Number.isInteger(data.source_width) &&
    Number.isInteger(data.source_height);
  if (!ok) throw new Error("Heightmap dimensions or coordinate metadata are invalid.");

  const [a, b, , d, e] = data.transform;
  if (Math.abs(b) > 1e-9 || Math.abs(d) > 1e-9) throw new Error("Rotated DEM transforms are not supported.");
  if (!(a > 0) || !(e < 0)) throw new Error("Unexpected DEM transform orientation.");
}

/**
 * Builds the terrain model from the heightmap payload: flat arrays, the
 * metric transform, and a sampler that returns the elevation of the rendered
 * surface (same triangle split as the mesh) at any map coordinate.
 */
export function buildModel(data) {
  validateHeightmap(data);

  const rows = data.height;
  const cols = data.width;
  const [a, , c, , e, f] = data.transform;

  const elevation = new Float64Array(rows * cols);
  const slope = new Float64Array(rows * cols);
  const valid = new Uint8Array(rows * cols);
  let minElevation = Infinity;
  let maxElevation = -Infinity;
  let maxSlope = 0;

  for (let r = 0; r < rows; r += 1) {
    const er = data.elevation_m[r];
    const sr = data.slope_deg[r];
    const vr = data.valid_mask[r];
    if (er?.length !== cols || sr?.length !== cols || vr?.length !== cols) {
      throw new Error("Heightmap rows have inconsistent dimensions.");
    }
    for (let col = 0; col < cols; col += 1) {
      const i = r * cols + col;
      const z = er[col];
      const s = sr[col];
      const ok = Boolean(vr[col]) && Number.isFinite(z) && Number.isFinite(s);
      valid[i] = ok ? 1 : 0;
      elevation[i] = ok ? z : NaN;
      slope[i] = ok ? s : NaN;
      if (ok) {
        if (z < minElevation) minElevation = z;
        if (z > maxElevation) maxElevation = z;
        if (s > maxSlope) maxSlope = s;
      }
    }
  }
  if (!Number.isFinite(minElevation)) throw new Error("Heightmap contains no valid elevation samples.");

  // Full DEM extent (cell edges) and the metric scale.
  const xmin = c;
  const xmax = c + a * data.source_width;
  const ymax = f;
  const ymin = f + e * data.source_height;
  const centerX = (xmin + xmax) / 2;
  const centerY = (ymin + ymax) / 2;
  const scale = WORLD_SIZE / Math.max(xmax - xmin, ymax - ymin);

  // Displayed grid positions in source-cell units (cell centres).
  const colGrid = Float64Array.from(data.col_indices);
  const rowGrid = Float64Array.from(data.row_indices);

  const toWorldXZ = (x, y) => [(x - centerX) * scale, -(y - centerY) * scale];
  const heightToWorld = (z) => (z - minElevation) * scale; // before exaggeration

  /** Elevation (m) of the rendered surface at map (x, y); null off-surface. */
  const sampleElevation = (x, y) => {
    const fc = (x - c) / a - 0.5;
    const fr = (y - f) / e - 0.5;
    if (fc < colGrid[0] - 1e-9 || fc > colGrid[cols - 1] + 1e-9) return null;
    if (fr < rowGrid[0] - 1e-9 || fr > rowGrid[rows - 1] + 1e-9) return null;

    const k = bracket(colGrid, fc);
    const m = bracket(rowGrid, fr);
    const u = Math.min(1, Math.max(0, (fc - colGrid[k]) / (colGrid[k + 1] - colGrid[k])));
    const v = Math.min(1, Math.max(0, (fr - rowGrid[m]) / (rowGrid[m + 1] - rowGrid[m])));

    const i00 = m * cols + k;
    const i01 = i00 + 1; // east neighbour
    const i10 = i00 + cols; // south neighbour
    const i11 = i10 + 1;
    if (!valid[i00] || !valid[i01] || !valid[i10] || !valid[i11]) return null;

    // Same split as the index buffer: (00, 10, 01) and (01, 10, 11).
    if (u + v <= 1) {
      return elevation[i00] * (1 - u - v) + elevation[i01] * u + elevation[i10] * v;
    }
    return elevation[i11] * (u + v - 1) + elevation[i01] * (1 - v) + elevation[i10] * (1 - u);
  };

  /** Map coordinates of a world point (inverse of toWorldXZ). */
  const fromWorldXZ = (wx, wz) => ({ x: wx / scale + centerX, y: -wz / scale + centerY });

  return {
    rows,
    cols,
    elevation,
    slope,
    valid,
    colGrid,
    rowGrid,
    sourceWidth: data.source_width,
    sourceHeight: data.source_height,
    resolution: a,
    extent: { xmin, xmax, ymin, ymax },
    scale,
    minElevation,
    maxElevation,
    maxSlope,
    toWorldXZ,
    fromWorldXZ,
    heightToWorld,
    sampleElevation,
    contains: (x, y) => x >= xmin && x <= xmax && y >= ymin && y <= ymax,
  };
}

/** Terrain surface and side walls, built once at 1x (exaggeration is a group scale). */
function buildGeometries(model) {
  const { rows, cols, elevation, slope, valid, colGrid, rowGrid, sourceWidth, sourceHeight, extent, resolution } = model;

  const positions = new Float32Array(rows * cols * 3);
  const uvs = new Float32Array(rows * cols * 2);
  const colors = new Float32Array(rows * cols * 3);

  const low = new THREE.Color(SLOPE_SHADING_LOW);
  const mid = new THREE.Color(SLOPE_SHADING_MID);
  const high = new THREE.Color(SLOPE_SHADING_HIGH);
  const color = new THREE.Color();

  for (let r = 0; r < rows; r += 1) {
    const y = extent.ymax - (rowGrid[r] + 0.5) * resolution;
    for (let col = 0; col < cols; col += 1) {
      const i = r * cols + col;
      const x = extent.xmin + (colGrid[col] + 0.5) * resolution;
      const [wx, wz] = model.toWorldXZ(x, y);
      positions[i * 3] = wx;
      positions[i * 3 + 1] = valid[i] ? model.heightToWorld(elevation[i]) : 0;
      positions[i * 3 + 2] = wz;

      // The CTX texture covers the DEM grid one pixel per cell; sample the
      // centre of the cell this vertex stands for.
      uvs[i * 2] = (colGrid[col] + 0.5) / sourceWidth;
      uvs[i * 2 + 1] = 1 - (rowGrid[r] + 0.5) / sourceHeight;

      const t = valid[i] ? THREE.MathUtils.clamp(slope[i] / 25, 0, 1) : 0;
      if (t < 0.5) color.copy(low).lerp(mid, t * 2);
      else color.copy(mid).lerp(high, (t - 0.5) * 2);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
  }

  const indices = [];
  for (let r = 0; r < rows - 1; r += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const i = r * cols + col;
      if (valid[i] && valid[i + 1] && valid[i + cols] && valid[i + cols + 1]) {
        indices.push(i, i + cols, i + 1, i + 1, i + cols, i + cols + 1);
      }
    }
  }

  const surface = new THREE.BufferGeometry();
  surface.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  surface.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  surface.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  surface.setIndex(indices.length > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : indices);
  surface.computeVertexNormals();
  surface.computeBoundingSphere();

  // Side walls from the outer edge down to the base, so the block reads as
  // solid ground instead of a floating sheet.
  const base = -0.02 * WORLD_SIZE * 0.25;
  const wall = [];
  const edge = (list) => {
    for (let n = 0; n < list.length - 1; n += 1) {
      const p = list[n];
      const q = list[n + 1];
      if (!valid[p] || !valid[q]) continue;
      const px = positions[p * 3], py = positions[p * 3 + 1], pz = positions[p * 3 + 2];
      const qx = positions[q * 3], qy = positions[q * 3 + 1], qz = positions[q * 3 + 2];
      wall.push(px, py, pz, px, base, pz, qx, qy, qz, qx, qy, qz, px, base, pz, qx, base, qz);
    }
  };
  const top = Array.from({ length: cols }, (_, col) => col);
  const bottom = Array.from({ length: cols }, (_, col) => (rows - 1) * cols + col);
  const left = Array.from({ length: rows }, (_, r) => r * cols);
  const right = Array.from({ length: rows }, (_, r) => r * cols + cols - 1);
  [top, bottom, left, right].forEach(edge);

  const skirt = new THREE.BufferGeometry();
  skirt.setAttribute("position", new THREE.Float32BufferAttribute(wall, 3));
  skirt.computeVertexNormals();

  return { surface, skirt, base };
}

// ============================================================
// Overlays draped on the surface
// ============================================================

/** Route polyline densified along the rendered surface (world coords at 1x). */
export function drapeRoute(coordinates, model) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const step = model.resolution * ROUTE_STEP_FRACTION;
  const lift = ROUTE_LIFT_M;
  const points = [];
  let missing = 0;

  const push = (x, y) => {
    const z = model.sampleElevation(x, y);
    if (z === null) {
      missing += 1;
      return;
    }
    const [wx, wz] = model.toWorldXZ(x, y);
    points.push([wx, model.heightToWorld(z + lift), wz]);
  };

  for (let n = 0; n < coordinates.length - 1; n += 1) {
    const [x0, y0] = coordinates[n];
    const [x1, y1] = coordinates[n + 1];
    const length = Math.hypot(x1 - x0, y1 - y0);
    const pieces = Math.max(1, Math.ceil(length / step));
    for (let s = 0; s < pieces; s += 1) {
      const t = s / pieces;
      push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  }
  const [xl, yl] = coordinates[coordinates.length - 1];
  push(xl, yl);

  return points.length >= 2 ? { points, missing } : null;
}

function TerrainBlock({ model, geometries, texture, exaggeration, onHover, onLeave }) {
  useEffect(
    () => () => {
      geometries.surface.dispose();
      geometries.skirt.dispose();
    },
    [geometries]
  );

  return (
    <group scale={[1, exaggeration, 1]}>
      <mesh
        geometry={geometries.surface}
        receiveShadow
        castShadow
        onPointerMove={(event) => {
          event.stopPropagation();
          onHover(event.point);
        }}
        onPointerOut={onLeave}
      >
        <meshStandardMaterial
          key={texture ? "textured" : "shaded"}
          map={texture || null}
          vertexColors={!texture}
          roughness={0.95}
          metalness={0}
        />
      </mesh>
      <mesh geometry={geometries.skirt}>
        <meshStandardMaterial color={SKIRT_COLOR} roughness={1} metalness={0} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function RouteLine({ draped, stale, exaggeration }) {
  if (!draped) return null;
  return (
    <group scale={[1, exaggeration, 1]}>
      {/* Both lines are transparent so renderOrder decides: casing first, colour on top. */}
      <Line
        points={draped.points}
        color={ROUTE_CASING}
        lineWidth={stale ? 6 : 8}
        transparent
        opacity={stale ? 0.45 : 0.75}
        depthWrite={false}
        renderOrder={1}
        toneMapped={false}
      />
      <Line
        points={draped.points}
        color={stale ? ROUTE_STALE_COLOR : ROUTE_COLOR}
        lineWidth={stale ? 3 : 4}
        transparent
        opacity={1}
        depthWrite={false}
        renderOrder={2}
        toneMapped={false}
        dashed={stale}
        dashSize={0.4}
        gapSize={0.9}
      />
    </group>
  );
}

/** Round "S" / diamond "G" label as a canvas texture (same look as the 2D pins). */
function createPinTexture(type) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const color = type === "start" ? START_COLOR : GOAL_COLOR;
  const center = size / 2;

  ctx.fillStyle = color;
  ctx.strokeStyle = SCENE_BACKGROUND;
  ctx.lineWidth = 10;
  ctx.beginPath();
  if (type === "start") {
    ctx.arc(center, center, 46, 0, Math.PI * 2);
  } else {
    ctx.moveTo(center, 10);
    ctx.lineTo(size - 10, center);
    ctx.lineTo(center, size - 10);
    ctx.lineTo(10, center);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = SCENE_BACKGROUND;
  ctx.font = "700 56px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(type === "start" ? "S" : "G", center, center + 3);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function PointMarker({ point, type, model, exaggeration }) {
  const texture = useMemo(() => createPinTexture(type), [type]);
  useEffect(() => () => texture.dispose(), [texture]);

  if (!point || !model.contains(point.x, point.y)) return null;
  const elevation = model.sampleElevation(point.x, point.y);
  if (elevation === null) return null;

  const [wx, wz] = model.toWorldXZ(point.x, point.y);
  const ground = model.heightToWorld(elevation) * exaggeration;
  const pole = MARKER_POLE_M * model.scale;
  const color = type === "start" ? START_COLOR : GOAL_COLOR;

  return (
    <group position={[wx, ground, wz]}>
      <mesh position={[0, pole / 2, 0]}>
        <cylinderGeometry args={[0.07, 0.07, pole, 8]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.35, 0.65, 32]} />
        <meshBasicMaterial color={color} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* Constant on-screen size and always drawn on top, like a map pin. */}
      <sprite position={[0, pole, 0]} scale={[0.045, 0.045, 1]} renderOrder={10}>
        <spriteMaterial map={texture} sizeAttenuation={false} depthTest={false} depthWrite={false} transparent toneMapped={false} />
      </sprite>
    </group>
  );
}

function ScienceTargets({ targets, model, exaggeration, selectedTargetId, onSelect, onHoverTarget }) {
  const meshRef = useRef(null);
  const sphere = useMemo(() => new THREE.SphereGeometry(1, 16, 12), []);
  useEffect(() => () => sphere.dispose(), [sphere]);

  const placed = useMemo(() => {
    const items = [];
    for (const target of targets) {
      if (!Number.isFinite(target?.x) || !Number.isFinite(target?.y) || !model.contains(target.x, target.y)) continue;
      const elevation = model.sampleElevation(target.x, target.y);
      if (elevation === null) continue;
      const [wx, wz] = model.toWorldXZ(target.x, target.y);
      const score = typeof target.science_value === "number" ? target.science_value : 0;
      items.push({ target, wx, wz, elevation, radius: 0.28 + 0.22 * score });
    }
    return items;
  }, [targets, model]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    placed.forEach((item, index) => {
      const y = model.heightToWorld(item.elevation) * exaggeration + item.radius * 0.6;
      matrix.makeScale(item.radius, item.radius, item.radius);
      matrix.setPosition(item.wx, y, item.wz);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.count = placed.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [placed, model, exaggeration]);

  const selected = placed.find((item) => item.target.id === selectedTargetId);
  const yOf = (item) => model.heightToWorld(item.elevation) * exaggeration;

  if (placed.length === 0) return null;

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[sphere, undefined, placed.length]}
        onClick={(event) => {
          event.stopPropagation();
          const item = placed[event.instanceId];
          if (item) onSelect?.(item.target);
        }}
        onPointerMove={(event) => {
          event.stopPropagation();
          onHoverTarget?.(placed[event.instanceId]?.target ?? null);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHoverTarget?.(null);
          document.body.style.cursor = "";
        }}
      >
        <meshStandardMaterial color={SCIENCE_COLOR} emissive={SCIENCE_COLOR} emissiveIntensity={0.35} roughness={0.6} />
      </instancedMesh>

      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[selected.wx, yOf(selected) + 0.05, selected.wz]}>
          <ringGeometry args={[selected.radius * 1.6, selected.radius * 2.2, 32]} />
          <meshBasicMaterial color={SCIENCE_COLOR} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      )}

    </>
  );
}

// ============================================================
// Camera
// ============================================================

function CameraRig({ viewRequest, model, exaggeration, frameBox }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);

  useEffect(() => {
    if (!controls || !viewRequest) return;
    const relief = model.heightToWorld(model.maxElevation) * exaggeration;
    const target = new THREE.Vector3(0, relief * 0.35, 0);

    if (viewRequest.type === "top") {
      camera.position.set(0, WORLD_SIZE * 1.6, 0.001);
    } else if (viewRequest.type === "frame" && frameBox) {
      const { cx, cz, size, height } = frameBox;
      target.set(cx, height * exaggeration, cz);
      const distance = Math.max(18, size * 1.6);
      camera.position.set(cx + distance * 0.55, height * exaggeration + distance * 0.75, cz + distance * 0.75);
    } else {
      camera.position.set(WORLD_SIZE * 0.62, WORLD_SIZE * 0.62, WORLD_SIZE * 0.88);
    }
    controls.target.copy(target);
    camera.lookAt(target);
    controls.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRequest, controls]);

  return null;
}

// ============================================================
// Scene
// ============================================================

function Scene({ model, geometries, texture, exaggeration, route, routeStale, start, goal, scienceTargets, selectedTargetId, onScienceSelect, onHoverTarget, viewRequest, onHover, onLeave }) {
  const draped = useMemo(() => drapeRoute(route?.coordinates, model), [route, model]);

  const frameBox = useMemo(() => {
    const pts = [];
    if (route?.coordinates?.length) pts.push(...route.coordinates);
    if (start) pts.push([start.x, start.y]);
    if (goal) pts.push([goal.x, goal.y]);
    const inside = pts.filter(([x, y]) => model.contains(x, y));
    if (inside.length === 0) return null;
    const xs = inside.map((p) => p[0]);
    const ys = inside.map((p) => p[1]);
    const [x0, z0] = model.toWorldXZ(Math.min(...xs), Math.min(...ys));
    const [x1, z1] = model.toWorldXZ(Math.max(...xs), Math.max(...ys));
    const heights = inside.map(([x, y]) => model.sampleElevation(x, y)).filter((z) => z !== null);
    const meanHeight = heights.length ? heights.reduce((s, z) => s + z, 0) / heights.length : model.minElevation;
    return {
      cx: (x0 + x1) / 2,
      cz: (z0 + z1) / 2,
      size: Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0), 6),
      height: model.heightToWorld(meanHeight),
    };
  }, [route, start, goal, model]);

  return (
    <>
      <color attach="background" args={[SCENE_BACKGROUND]} />
      <hemisphereLight args={["#dce7ee", "#49372b", 0.9]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[-45, 70, 35]}
        intensity={1.7}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={70}
        shadow-camera-bottom={-70}
        shadow-camera-near={1}
        shadow-camera-far={220}
        shadow-bias={-0.0002}
        shadow-normalBias={0.03}
      />

      <TerrainBlock
        model={model}
        geometries={geometries}
        texture={texture}
        exaggeration={exaggeration}
        onHover={onHover}
        onLeave={onLeave}
      />
      <RouteLine draped={draped} stale={routeStale} exaggeration={exaggeration} />
      <PointMarker point={start} type="start" model={model} exaggeration={exaggeration} />
      <PointMarker point={goal} type="goal" model={model} exaggeration={exaggeration} />
      <ScienceTargets
        targets={scienceTargets}
        model={model}
        exaggeration={exaggeration}
        selectedTargetId={selectedTargetId}
        onSelect={onScienceSelect}
        onHoverTarget={onHoverTarget}
      />

      {/* 1 km grid under the AOI (the AOI is 10 km across). */}
      <gridHelper
        args={[WORLD_SIZE * 1.4, 14, GRID_MAJOR, GRID_MINOR]}
        position={[0, geometries.base * exaggeration - 0.05, 0]}
      />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={4}
        maxDistance={WORLD_SIZE * 3}
        maxPolarAngle={Math.PI * 0.495}
        screenSpacePanning
      />
      <CameraRig viewRequest={viewRequest} model={model} exaggeration={exaggeration} frameBox={frameBox} />
    </>
  );
}

// ============================================================
// CTX texture
// ============================================================

function useCTXTexture() {
  const [texture, setTexture] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let loaded = null;

    new THREE.TextureLoader().load(
      TERRAIN_TEXTURE_URL,
      (result) => {
        if (!active) {
          result.dispose();
          return;
        }
        loaded = result;
        result.colorSpace = THREE.SRGBColorSpace;
        result.wrapS = THREE.ClampToEdgeWrapping;
        result.wrapT = THREE.ClampToEdgeWrapping;
        result.magFilter = THREE.LinearFilter;
        result.minFilter = THREE.LinearMipmapLinearFilter;
        result.anisotropy = 8;
        result.generateMipmaps = true;
        result.needsUpdate = true;
        setTexture(result);
      },
      undefined,
      (loadError) => {
        if (active) setError(loadError?.message || "CTX texture could not be loaded.");
      }
    );

    return () => {
      active = false;
      if (loaded) loaded.dispose();
    };
  }, []);

  return { texture, error };
}

// ============================================================
// Main component
// ============================================================

export default function Terrain3D({
  start = null,
  goal = null,
  route = null,
  routeStale = false,
  scienceTargets = [],
  selectedTargetId = null,
  onScienceSelect,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [exaggeration, setExaggeration] = useState(DEFAULT_EXAGGERATION);
  const [viewRequest, setViewRequest] = useState({ type: "reset", key: 0 });
  const readoutRef = useRef(null);
  const [hoveredTarget, setHoveredTarget] = useState(null);

  const { texture, error: textureError } = useCTXTexture();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    // Shared with the 2D Slope and Elevation overlays (see api/terrain.js).
    getHeightmap()
      .then((payload) => {
        if (active) setData(payload);
      })
      .catch((err) => {
        console.error("[terrain] heightmap unavailable:", err);
        if (active) setError(err?.detail || err?.message || "The processed elevation model could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const built = useMemo(() => {
    if (!data) return { model: null, geometries: null, buildError: "" };
    try {
      const model = buildModel(data);
      return { model, geometries: buildGeometries(model), buildError: "" };
    } catch (err) {
      console.error("[terrain] heightmap could not be used:", err);
      return { model: null, geometries: null, buildError: err.message };
    }
  }, [data]);

  const { model, geometries, buildError } = built;

  // Cursor readout is written straight to the DOM so moving the mouse does not
  // re-render the scene.
  const handleHover = useCallback(
    (point) => {
      const node = readoutRef.current;
      if (!node || !model) return;
      const { x, y } = model.fromWorldXZ(point.x, point.z);
      const z = model.sampleElevation(x, y);
      node.textContent =
        z === null
          ? "Cursor: outside the elevation model"
          : `Cursor X ${formatCoordinate(x)} · Y ${formatCoordinate(y)} · ${z.toFixed(1)} m`;
    },
    [model]
  );
  const handleLeave = useCallback(() => {
    if (readoutRef.current) readoutRef.current.textContent = "Cursor: move over the terrain";
  }, []);

  const requestView = (type) => setViewRequest((current) => ({ type, key: current.key + 1 }));

  const routeInside = route?.coordinates?.length >= 2;
  const reliefM = model ? model.maxElevation - model.minElevation : 0;

  if (loading) {
    return (
      <div className="terrain3d-state" role="status">
        <Spinner size={18} />
        <span>Loading Jezero elevation model…</span>
      </div>
    );
  }

  if (error || buildError) {
    return (
      <div className="terrain3d-state terrain3d-state--error" role="alert">
        <strong>3D terrain is currently unavailable.</strong>
        <span>{error || buildError}</span>
        <span>The 2D map remains accessible.</span>
      </div>
    );
  }

  return (
    <div className="terrain3d">
      <Canvas shadows camera={{ position: [62, 62, 88], fov: 42, near: 0.1, far: 1000 }} dpr={[1, 1.75]}>
        <Scene
          model={model}
          geometries={geometries}
          texture={texture}
          exaggeration={exaggeration}
          route={route}
          routeStale={routeStale}
          start={start}
          goal={goal}
          scienceTargets={scienceTargets}
          selectedTargetId={selectedTargetId}
          onScienceSelect={onScienceSelect}
          onHoverTarget={setHoveredTarget}
          viewRequest={viewRequest}
          onHover={handleHover}
          onLeave={handleLeave}
        />
      </Canvas>

      <div className="terrain3d__toolbar" role="toolbar" aria-label="3D view controls">
        <div className="terrain3d__group" role="group" aria-label="Vertical exaggeration">
          <span className="terrain3d__group-label">Vertical</span>
          {EXAGGERATIONS.map((value) => (
            <button
              key={value}
              type="button"
              className="terrain3d__button"
              aria-pressed={exaggeration === value}
              onClick={() => setExaggeration(value)}
            >
              {value}×
            </button>
          ))}
        </div>
        <div className="terrain3d__group" role="group" aria-label="Camera">
          <button type="button" className="terrain3d__button" onClick={() => requestView("reset")}>
            Reset view
          </button>
          <button type="button" className="terrain3d__button" onClick={() => requestView("top")}>
            Top view
          </button>
          <button
            type="button"
            className="terrain3d__button"
            disabled={!routeInside && !start && !goal}
            onClick={() => requestView("frame")}
          >
            Frame route
          </button>
        </div>
      </div>

      {hoveredTarget && (
        <div className="terrain3d__tooltip terrain3d__tooltip--overlay" role="status">
          <strong>{hoveredTarget.name || hoveredTarget.id}</strong>
          {typeof hoveredTarget.science_value === "number" && (
            <span>Relative ranking {hoveredTarget.science_value.toFixed(2)} · click to inspect</span>
          )}
        </div>
      )}

      <div className="terrain3d__legend">
        <strong>Jezero · 3D terrain</strong>
        <span>
          DEM {model.sourceWidth} × {model.sourceHeight} at {model.resolution} m
          {model.cols !== model.sourceWidth && ` · display ${model.cols} × ${model.rows}`}
        </span>
        <span>
          Elevation {model.minElevation.toFixed(1)} → {model.maxElevation.toFixed(1)} m · relief {reliefM.toFixed(0)} m
        </span>
        <span>
          True scale × {exaggeration} vertical · max slope {model.maxSlope.toFixed(1)}° · grid 1 km
        </span>
        <span>
          {texture
            ? "CTX orthomosaic texture"
            : textureError
              ? "CTX texture unavailable · slope shading"
              : "Loading CTX texture…"}
        </span>
        {routeInside && (
          <span className={routeStale ? "terrain3d__legend-warning" : undefined}>
            {routeStale ? "Outdated route: inputs have changed" : "Route draped on the elevation model"}
          </span>
        )}
        <span ref={readoutRef}>Cursor: move over the terrain</span>
        <span>Drag to orbit · right-drag to pan · scroll to zoom</span>
      </div>
    </div>
  );
}
