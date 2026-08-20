// GÉNÉRÉ par `npm run build:player` — NE PAS ÉDITER À LA MAIN.
// Sources : src/shared.ts, src/presentation-content.ts, src/cadence.ts
//
// Contrats partagés entre le navigateur et les fonctions serverless. Un seul exemplaire :
// deux implémentations d'un même contrat finissent toujours par diverger en silence.
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/shared.ts
var shared_exports = {};
__export(shared_exports, {
  DEFAULT_CENTER: () => DEFAULT_CENTER,
  DEFAULT_ZOOM: () => DEFAULT_ZOOM,
  MAP_TYPES: () => MAP_TYPES,
  PRESENTER_ACTIONS_PER_HOUR: () => PRESENTER_ACTIONS_PER_HOUR,
  PRESENT_CACHE_MS: () => PRESENT_CACHE_MS,
  PRESENT_QUOTA_MARGIN: () => PRESENT_QUOTA_MARGIN,
  PRESENT_QUOTA_PER_HOUR: () => PRESENT_QUOTA_PER_HOUR,
  PRESENT_READS_PER_HOUR: () => PRESENT_READS_PER_HOUR,
  PRESENT_READ_BURST: () => PRESENT_READ_BURST,
  PRESENT_READ_COALESCE_MS: () => PRESENT_READ_COALESCE_MS,
  PRESENT_RESYNC_MS: () => PRESENT_RESYNC_MS,
  PRESENT_SIGNAL_BUDGET_PER_HOUR: () => PRESENT_SIGNAL_BUDGET_PER_HOUR,
  PRESENT_WRITE_TIMEOUT_MS: () => PRESENT_WRITE_TIMEOUT_MS,
  READERS_PER_EGRESS: () => READERS_PER_EGRESS,
  RESYNC_READS_PER_HOUR: () => RESYNC_READS_PER_HOUR,
  SESSION_IDLE_MS: () => SESSION_IDLE_MS,
  SESSION_INTERVAL_MS: () => SESSION_INTERVAL_MS,
  SESSION_QUOTA_PER_HOUR: () => SESSION_QUOTA_PER_HOUR,
  SESSION_WRITES_PER_HOUR: () => SESSION_WRITES_PER_HOUR,
  VIEW_EVENTS_PER_READER_HOUR: () => VIEW_EVENTS_PER_READER_HOUR,
  VIEW_QUOTA_PER_HOUR: () => VIEW_QUOTA_PER_HOUR,
  cycleMapType: () => cycleMapType,
  initialMapContent: () => initialMapContent,
  mapTypeLabel: () => mapTypeLabel,
  sanitizeContent: () => sanitizeContent
});
module.exports = __toCommonJS(shared_exports);

// src/presentation-content.ts
var MAP_TYPES = ["roadmap", "satellite", "hybrid"];
var DEFAULT_CENTER = [46.6, 2.5];
var DEFAULT_ZOOM = 6;
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function pair(value) {
  if (!Array.isArray(value)) return null;
  const a = num(value[0]);
  const b = num(value[1]);
  return a != null && b != null ? [a, b] : null;
}
var clamp = (v, min, max) => Math.max(min, Math.min(max, v));
function sanitizeContent(input) {
  if (!input || typeof input !== "object") return null;
  const c = input;
  if (c.kind === "pdf" || c.kind == null) return null;
  if (c.kind === "streetview") {
    const position = pair(c.position);
    if (!position) return null;
    const rawPov = c.pov && typeof c.pov === "object" ? c.pov : null;
    const pov = rawPov ? { heading: num(rawPov.heading) || 0, pitch: clamp(num(rawPov.pitch) || 0, -90, 90) } : { heading: 0, pitch: 0 };
    return { kind: "streetview", position, pov, zoom: clamp(num(c.zoom) || 1, 0, 5) };
  }
  if (c.kind !== "map") return null;
  return {
    kind: "map",
    center: pair(c.center) || [...DEFAULT_CENTER],
    zoom: clamp(Math.trunc(num(c.zoom) || DEFAULT_ZOOM), 1, 21),
    marker: pair(c.marker),
    mapType: MAP_TYPES.includes(c.mapType) ? c.mapType : null,
    label: String(c.label || "").slice(0, 160) || null
  };
}
function cycleMapType(current) {
  const index = MAP_TYPES.indexOf(current);
  return MAP_TYPES[(index + 1) % MAP_TYPES.length];
}
function mapTypeLabel(current) {
  if (current === "roadmap") return "\u{1F6F0} Satellite";
  if (current === "satellite") return "\u{1F5FA} Hybride";
  return "\u{1F5FA} Plan";
}
function initialMapContent() {
  return { kind: "map", center: [...DEFAULT_CENTER], zoom: DEFAULT_ZOOM, marker: null, mapType: null, label: null };
}

// src/cadence.ts
var SESSION_INTERVAL_MS = 3e4;
var SESSION_WRITES_PER_HOUR = Math.ceil(36e5 / SESSION_INTERVAL_MS);
var READERS_PER_EGRESS = 25;
var SESSION_QUOTA_PER_HOUR = SESSION_WRITES_PER_HOUR * READERS_PER_EGRESS;
var VIEW_EVENTS_PER_READER_HOUR = 720;
var VIEW_QUOTA_PER_HOUR = VIEW_EVENTS_PER_READER_HOUR * READERS_PER_EGRESS;
var SESSION_IDLE_MS = 18e4;
var PRESENT_RESYNC_MS = 25e3;
var RESYNC_READS_PER_HOUR = Math.ceil(36e5 / PRESENT_RESYNC_MS);
var PRESENTER_ACTIONS_PER_HOUR = 720;
var PRESENT_READS_PER_HOUR = RESYNC_READS_PER_HOUR + PRESENTER_ACTIONS_PER_HOUR;
var PRESENT_SIGNAL_BUDGET_PER_HOUR = PRESENTER_ACTIONS_PER_HOUR;
var PRESENT_READ_BURST = 20;
var PRESENT_WRITE_TIMEOUT_MS = 1e4;
var PRESENT_READ_COALESCE_MS = 400;
var PRESENT_CACHE_MS = PRESENT_READ_COALESCE_MS;
var PRESENT_QUOTA_MARGIN = 4;
var PRESENT_QUOTA_PER_HOUR = (PRESENT_READS_PER_HOUR + PRESENT_READ_BURST) * READERS_PER_EGRESS * PRESENT_QUOTA_MARGIN;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  MAP_TYPES,
  PRESENTER_ACTIONS_PER_HOUR,
  PRESENT_CACHE_MS,
  PRESENT_QUOTA_MARGIN,
  PRESENT_QUOTA_PER_HOUR,
  PRESENT_READS_PER_HOUR,
  PRESENT_READ_BURST,
  PRESENT_READ_COALESCE_MS,
  PRESENT_RESYNC_MS,
  PRESENT_SIGNAL_BUDGET_PER_HOUR,
  PRESENT_WRITE_TIMEOUT_MS,
  READERS_PER_EGRESS,
  RESYNC_READS_PER_HOUR,
  SESSION_IDLE_MS,
  SESSION_INTERVAL_MS,
  SESSION_QUOTA_PER_HOUR,
  SESSION_WRITES_PER_HOUR,
  VIEW_EVENTS_PER_READER_HOUR,
  VIEW_QUOTA_PER_HOUR,
  cycleMapType,
  initialMapContent,
  mapTypeLabel,
  sanitizeContent
});
