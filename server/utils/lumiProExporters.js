import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rawExporters = require('./lumiProExporters.cjs');

const MAX_CAB_COLS = 64;
const MAX_CAB_ROWS = 48;
const MAX_PHYS_W_M = 64;
const MAX_PHYS_H_M = 48;

function clampInt(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampFloat(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeSurfaceInput(s) {
  if (!s || typeof s !== 'object') return s;
  const specIn = s.cabinetSpec && typeof s.cabinetSpec === 'object' ? { ...s.cabinetSpec } : undefined;
  const widthMm = clampFloat(specIn?.widthMm ?? specIn?.cabWmm ?? s.cabW ?? s.cabinetWidthMm, 100, 4000, 500);
  const heightMm = clampFloat(specIn?.heightMm ?? specIn?.cabHmm ?? s.cabH ?? s.cabinetHeightMm, 100, 4000, 500);
  const wM = clampFloat(
    s.physicalWidthM ?? s.widthM ?? (Array.isArray(s.physical) ? s.physical[0] : s.physical?.width),
    0.2,
    MAX_PHYS_W_M,
    4
  );
  const hM = clampFloat(
    s.physicalHeightM ?? s.heightM ?? (Array.isArray(s.physical) ? s.physical[1] : s.physical?.height),
    0.2,
    MAX_PHYS_H_M,
    2.5
  );
  const defaultCols = clampInt((wM * 1000) / widthMm, 1, MAX_CAB_COLS, 8);
  const defaultRows = clampInt((hM * 1000) / heightMm, 1, MAX_CAB_ROWS, 5);
  const cabCols = clampInt(s.cabCols ?? specIn?.cols, 1, MAX_CAB_COLS, defaultCols);
  const cabRows = clampInt(s.cabRows ?? specIn?.rows, 1, MAX_CAB_ROWS, defaultRows);
  const virtualTiles = Array.isArray(s.virtualTiles)
    ? s.virtualTiles.slice(0, MAX_CAB_COLS * MAX_CAB_ROWS)
    : undefined;
  const columnAnglesDeg = Array.isArray(s.columnAnglesDeg)
    ? s.columnAnglesDeg.slice(0, cabCols)
    : undefined;

  return {
    ...s,
    physicalWidthM: wM,
    physicalHeightM: hM,
    physical: [wM, hM],
    cabCols,
    cabRows,
    ...(virtualTiles ? { virtualTiles } : {}),
    ...(columnAnglesDeg ? { columnAnglesDeg } : {}),
    ...(specIn ? { cabinetSpec: { ...specIn, cols: cabCols, rows: cabRows, widthMm, heightMm } } : {})
  };
}

function sanitizeLightInput(l, idx = 0) {
  if (!l || typeof l !== 'object') return l;
  const fallbackUni = Math.floor(idx / 32) + 1;
  const fallbackAddr = (idx % 32) * 16 + 1;
  const dmxUniverse = clampInt(l.dmxUniverse ?? l.universe, 1, 1024, fallbackUni);
  const dmxAddress = clampInt(l.dmxAddress ?? l.address, 1, 512, fallbackAddr);
  const dmxChannels = clampInt(l.dmxChannels ?? l.dmxChannelCount ?? l.channels, 1, 512, 16);
  return {
    ...l,
    dmxUniverse,
    dmxAddress,
    dmxChannels
  };
}

function sanitizeSurfaceArray(list) {
  return Array.isArray(list) ? list.slice(0, 128).map(sanitizeSurfaceInput) : [];
}

function sanitizeLightArray(list) {
  return Array.isArray(list) ? list.slice(0, 512).map((l, i) => sanitizeLightInput(l, i)) : [];
}

export const {
  LUMI_EXPORTER_BRAND,
  escHtml18,
  escapeXml12,
  dxfLine,
  dxfRect,
  dxfText,
  crc32Bytes18,
  encodeUtf8Bytes18,
  buildStoreZipArchive18,
  computeSfxSafetyZones,
  computePhotometricFootprint
} = rawExporters;

export function buildStructurePreviewSvg(surface, riggingOpts = {}) {
  const safeTarget = Array.isArray(surface)
    ? sanitizeSurfaceArray(surface)
    : sanitizeSurfaceInput(surface);
  return rawExporters.buildStructurePreviewSvg(safeTarget, riggingOpts);
}

export function generateStageDxf(opts = {}) {
  return rawExporters.generateStageDxf({
    ...opts,
    surfaces: sanitizeSurfaceArray(opts?.surfaces ?? opts?.eng?.surfaces),
    lights: sanitizeLightArray(opts?.lights ?? opts?.eng?.lights)
  });
}

export function exportLightingMvr18(opts = {}) {
  return rawExporters.exportLightingMvr18({
    ...opts,
    surfaces: sanitizeSurfaceArray(opts?.surfaces ?? opts?.eng?.surfaces),
    lights: sanitizeLightArray(opts?.lights ?? opts?.eng?.lights)
  });
}

export function buildGrandMaFixtureXml(lights = [], opts = {}) {
  return rawExporters.buildGrandMaFixtureXml(sanitizeLightArray(lights), opts);
}

export function computeEngineeringRider(eng = null, opts = {}) {
  if (Array.isArray(eng)) {
    return rawExporters.computeEngineeringRider(sanitizeSurfaceArray(eng), opts);
  }
  if (eng && typeof eng === 'object') {
    return rawExporters.computeEngineeringRider(
      {
        ...eng,
        surfaces: sanitizeSurfaceArray(eng.surfaces),
        lights: sanitizeLightArray(eng.lights)
      },
      opts
    );
  }
  return rawExporters.computeEngineeringRider(eng, opts);
}

export function generateCrewSplitDossier18(role = 'CREW_1_STAGE_RIGGING', opts = {}) {
  return rawExporters.generateCrewSplitDossier18(role, {
    ...opts,
    surfaces: sanitizeSurfaceArray(opts?.surfaces),
    lights: sanitizeLightArray(opts?.lights)
  });
}

export function buildPrintableStageDocumentHtml18(opts = {}) {
  const rawSummary = opts?.summary && typeof opts.summary === 'object' ? { ...opts.summary } : {};
  delete rawSummary.structureSvg;
  return rawExporters.buildPrintableStageDocumentHtml18({
    ...opts,
    summary: rawSummary,
    surfaces: sanitizeSurfaceArray(opts?.surfaces),
    lights: sanitizeLightArray(opts?.lights)
  });
}

const exporters = {
  ...rawExporters,
  buildStructurePreviewSvg,
  generateStageDxf,
  exportLightingMvr18,
  buildGrandMaFixtureXml,
  computeEngineeringRider,
  generateCrewSplitDossier18,
  buildPrintableStageDocumentHtml18
};

export default exporters;
