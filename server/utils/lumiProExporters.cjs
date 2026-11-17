/* ============================================================================
   V18.0 LUMISTAGE PRO EXPORTERS — SINGLE SOURCE OF TRUTH (LOCAL FILE:// & BACKEND)
   Excluded from public web bundle (lumi-studio.min.js); executed on server for PRO.
   ============================================================================ */
(function (root) {
  'use strict';

  const LUMI_EXPORTER_BRAND = {
    name: 'LumiStage',
    tagline: 'by Alpha Studio · GROUPLIFE',
    legalEntity: 'CÔNG TY TNHH MTV GROUPLIFE',
    watermarkText: 'LUMISTAGE FREE · GROUPLIFE · LUMISTAGE.VN',
    taxNote: 'KCT (Phần mềm & dịch vụ thiết kế công nghệ không chịu thuế GTGT)'
  };

  function clampNum18(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function escHtml18(v) {
    return String(v ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function escapeXml12(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function normalizeSurfaceFallback18(s) {
    if (!s || typeof s !== 'object') return s;
    const hostNorm =
      (root && typeof root.normalizeSurfaceHardware === 'function' && root.normalizeSurfaceHardware) ||
      (root?.STUDIO?.spatial && typeof root.STUDIO.spatial.normalizeSurfaceHardware === 'function' && root.STUDIO.spatial.normalizeSurfaceHardware) ||
      null;
    if (hostNorm) return hostNorm(s);

    const wM = Math.max(0.2, Number(s.physicalWidthM ?? s.widthM ?? s.physical?.[0] ?? s.physical?.width) || 4);
    const hM = Math.max(0.2, Number(s.physicalHeightM ?? s.heightM ?? s.physical?.[1] ?? s.physical?.height) || 2.5);
    if (!Array.isArray(s.physical)) s.physical = [wM, hM];
    const specIn = s.cabinetSpec && typeof s.cabinetSpec === 'object' ? s.cabinetSpec : {};
    const widthMm = Math.max(100, Number(specIn.widthMm ?? specIn.cabWmm ?? s.cabW ?? s.cabinetWidthMm) || 500);
    const heightMm = Math.max(100, Number(specIn.heightMm ?? specIn.cabHmm ?? s.cabH ?? s.cabinetHeightMm) || 500);
    const pitchMm = Math.max(0.9, Number(s.pitchMm || specIn.pitchMm) || (specIn.pxW ? +(widthMm / specIn.pxW).toFixed(2) : 2.6));
    const pxW = Math.max(16, Math.round(Number(specIn.pxW || s.pxW) || widthMm / pitchMm));
    const pxH = Math.max(16, Math.round(Number(specIn.pxH || s.pxH) || heightMm / pitchMm));
    const cols = Math.max(1, Math.round(Number(s.cabCols ?? specIn.cols) || (wM * 1000) / widthMm));
    const rows = Math.max(1, Math.round(Number(s.cabRows ?? specIn.rows) || (hM * 1000) / heightMm));
    const voidList = Array.isArray(s.virtualTiles) ? s.virtualTiles.map(String) : [];
    const voidSet = new Set(voidList);
    let voidCount = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (voidSet.has(`${c},${r}`)) voidCount++;
      }
    }
    const totalGrid = cols * rows;
    if (voidCount >= totalGrid && totalGrid > 0) voidCount = totalGrid - 1;
    const activeCabinets = Math.max(1, totalGrid - voidCount);
    const weightKg = Math.max(1, Number(specIn.weightKg) || 8.5);
    const maxPowerW = Math.max(10, Number(specIn.maxPowerW) || 160);
    const avgPowerW = Math.max(5, Number(specIn.avgPowerW) || 65);
    const nits = Math.max(100, Number(specIn.nits) || 1200);

    s.cabCols = cols;
    s.cabRows = rows;
    s.cabW = widthMm;
    s.cabH = heightMm;
    s.pxW = pxW;
    s.pxH = pxH;
    s.totalCabinetGrid = totalGrid;
    s.voidCount = voidCount;
    s.activeCabinets = activeCabinets;
    s.totalPhysicalWidthM = +((cols * widthMm) / 1000).toFixed(3);
    s.totalPhysicalHeightM = +((rows * heightMm) / 1000).toFixed(3);
    s.totalWeightKg = +(activeCabinets * weightKg).toFixed(2);
    s.cabinetSpec = {
      ...specIn,
      widthMm,
      heightMm,
      cabWmm: widthMm,
      cabHmm: heightMm,
      pxW,
      pxH,
      cols,
      rows,
      weightKg,
      maxPowerW,
      avgPowerW,
      nits
    };
    if (!Array.isArray(s.columnAnglesDeg) || s.columnAnglesDeg.length !== cols) {
      const baseDeg = clampNum18(s.panelAngleDeg || 0, -30, 30);
      s.columnAnglesDeg = Array.from({ length: cols }, (_, i) =>
        Array.isArray(s.columnAnglesDeg) && Number.isFinite(+s.columnAnglesDeg[i])
          ? clampNum18(s.columnAnglesDeg[i], -30, 30)
          : baseDeg
      );
    }
    return s;
  }

  function computeCurvedSpanFallback18(surfaceOrCols, cabWmmArg, panelAngleDegArg) {
    const hostCurve =
      (root && typeof root.computeCurvedSpanMeters === 'function' && root.computeCurvedSpanMeters) ||
      (root?.STUDIO?.spatial && typeof root.STUDIO.spatial.computeCurvedSpanMeters === 'function' && root.STUDIO.spatial.computeCurvedSpanMeters) ||
      null;
    if (hostCurve) return hostCurve(surfaceOrCols, cabWmmArg, panelAngleDegArg);

    let cols = 1;
    let cabWmm = 500;
    let angles = [0];
    if (surfaceOrCols && typeof surfaceOrCols === 'object') {
      normalizeSurfaceFallback18(surfaceOrCols);
      cols = surfaceOrCols.cabCols || 1;
      cabWmm = surfaceOrCols.cabinetSpec?.cabWmm || surfaceOrCols.cabW || 500;
      angles = Array.isArray(surfaceOrCols.columnAnglesDeg) && surfaceOrCols.columnAnglesDeg.length === cols
        ? surfaceOrCols.columnAnglesDeg
        : Array.from({ length: cols }, () => clampNum18(surfaceOrCols.panelAngleDeg || 0, -30, 30));
    } else {
      cols = Math.max(1, Math.round(+surfaceOrCols || 1));
      cabWmm = Math.max(100, +cabWmmArg || 500);
      const deg = clampNum18(panelAngleDegArg || 0, -30, 30);
      angles = Array.from({ length: cols }, () => deg);
    }
    const w = Math.max(0.1, cabWmm / 1000);
    const arcWidthM = +(cols * w).toFixed(3);
    let x = 0;
    let z = 0;
    let cumDeg = 0;
    let minZ = 0;
    let maxZ = 0;
    const coords = [];
    for (let col = 0; col < cols; col++) {
      const angleDeg = clampNum18(angles[col] || 0, -30, 30);
      cumDeg += angleDeg;
      const rad = (cumDeg * Math.PI) / 180;
      const x0 = +x.toFixed(4);
      const z0 = +z.toFixed(4);
      const x1 = +(x + w * Math.cos(rad)).toFixed(4);
      const z1 = +(z + w * Math.sin(rad)).toFixed(4);
      coords.push({ col, x0, z0, x1, z1, angleDeg });
      x = x1;
      z = z1;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const chordWidthM = +Math.hypot(x, z).toFixed(3);
    const chordAngle = chordWidthM > 1e-6 ? Math.atan2(z, x) : 0;
    let depthOffsetM = +(maxZ - minZ).toFixed(3);
    if (Math.abs(chordAngle) > 1e-6 && coords.length) {
      const ca = Math.cos(-chordAngle);
      const sa = Math.sin(-chordAngle);
      minZ = Infinity;
      maxZ = -Infinity;
      for (const cc of coords) {
        const rz0 = cc.x0 * sa + cc.z0 * ca;
        const rz1 = cc.x1 * sa + cc.z1 * ca;
        if (rz0 < minZ) minZ = rz0;
        if (rz0 > maxZ) maxZ = rz0;
        if (rz1 < minZ) minZ = rz1;
        if (rz1 > maxZ) maxZ = rz1;
      }
      if (Number.isFinite(minZ)) depthOffsetM = +(maxZ - minZ).toFixed(3);
    }
    return {
      arcWidthM,
      arcLengthM: arcWidthM,
      chordWidthM,
      chordSpanM: chordWidthM,
      depthOffsetM,
      sagittaDepthM: depthOffsetM,
      isCurved: depthOffsetM > 0.005
    };
  }

  function planSurfaceWiringFallback18(surface, options = {}) {
    const hostWire =
      (root && typeof root.planSurfaceWiring === 'function' && root.planSurfaceWiring) ||
      (root?.STUDIO?.atlas && typeof root.STUDIO.atlas.planSurfaceWiring === 'function' && root.STUDIO.atlas.planSurfaceWiring) ||
      null;
    if (hostWire) return hostWire(surface, options);

    if (!surface || typeof surface !== 'object') {
      return { cols: 0, rows: 0, activeCabinets: 0, voidCabinets: 0, dataPorts: [], powerLoops: [], warnings: [] };
    }
    normalizeSurfaceFallback18(surface);
    const spec = surface.cabinetSpec || {};
    const cfg = { ...(surface.wiringConfig || {}), ...options };
    const VALID_PATTERNS = ['H-TL', 'H-TR', 'H-BL', 'H-BR', 'V-TL', 'V-TR', 'V-BL', 'V-BR'];
    let pattern = String(cfg.pattern || surface.wiringOrder || 'H-TL').toUpperCase();
    if (!VALID_PATTERNS.includes(pattern)) pattern = 'H-TL';
    const viewMode = (options.viewMode || cfg.viewMode || surface.wiringViewMode) === 'rear' ? 'rear' : 'front';
    const rawSplit = String(options.powerSplitMode || cfg.powerSplitMode || surface.powerSplitMode || 'full').toLowerCase();
    const powerSplitMode = ['full', 'horiz_top_bot', 'vert_left_right'].includes(rawSplit) ? rawSplit : 'full';

    const cols = Math.max(1, Math.min(64, Math.round(+spec.cols || +surface.cabCols || 8)));
    const rows = Math.max(1, Math.min(48, Math.round(+spec.rows || +surface.cabRows || 4)));
    const cabPxW = Math.max(1, Math.round(+spec.pxW || +surface.pxW || 192));
    const cabPxH = Math.max(1, Math.round(+spec.pxH || +surface.pxH || 192));
    const cabWatts = Math.max(1, +spec.maxPowerW || 160);
    const maxPixelsPerPort = Math.max(1, Math.round(+options.maxPixelsPerPort || +options.portPixelLimit || +cfg.maxPixelsPerPort || 650000));
    const voltageV = +(cfg.voltageV ?? cfg.voltage) === 110 ? 110 : 220;
    const maxWattsPerLoop = Math.max(100, +cfg.maxWattsPerLoop || (voltageV === 110 ? 1320 : 2200));

    const rowLayout = Array.isArray(surface.rowLayout) && surface.rowLayout.length === rows ? surface.rowLayout : null;
    const voidSet = new Set(Array.isArray(surface.virtualTiles) ? surface.virtualTiles.map(String) : []);
    const isVertical = pattern.startsWith('V-');
    const fromBottom = pattern.endsWith('BL') || pattern.endsWith('BR');
    const fromRight = pattern.endsWith('TR') || pattern.endsWith('BR');

    const traversalOrder = [];
    if (!isVertical) {
      for (let rIdx = 0; rIdx < rows; rIdx++) {
        const row = fromBottom ? rows - 1 - rIdx : rIdx;
        const reverseRow = rIdx % 2 === 1;
        const goRightToLeft = fromRight ? !reverseRow : reverseRow;
        for (let cIdx = 0; cIdx < cols; cIdx++) {
          const col = goRightToLeft ? cols - 1 - cIdx : cIdx;
          if (voidSet.has(`${col},${row}`)) continue;
          traversalOrder.push({ col, row });
        }
      }
    } else {
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        const col = fromRight ? cols - 1 - cIdx : cIdx;
        const reverseCol = cIdx % 2 === 1;
        const goBottomToTop = fromBottom ? !reverseCol : reverseCol;
        for (let rIdx = 0; rIdx < rows; rIdx++) {
          const row = goBottomToTop ? rows - 1 - rIdx : rIdx;
          if (voidSet.has(`${col},${row}`)) continue;
          traversalOrder.push({ col, row });
        }
      }
    }

    const warnings = [];
    const dataPorts = [];
    let currentPort = null;
    traversalOrder.forEach((tile, idx) => {
      const rl = rowLayout ? rowLayout[tile.row] : null;
      const tilePxW = rl ? Math.max(1, Math.round(+rl.pxW || cabPxW)) : cabPxW;
      const tilePxH = rl ? Math.max(1, Math.round(+rl.pxH || cabPxH)) : cabPxH;
      const tilePixels = tilePxW * tilePxH;
      const displayCol = viewMode === 'rear' ? cols - 1 - tile.col : tile.col;
      if (!currentPort || (currentPort.pixels > 0 && currentPort.pixels + tilePixels > maxPixelsPerPort)) {
        const pIdx = dataPorts.length + 1;
        currentPort = { portId: 'P' + pIdx, portIndex: pIdx, pixels: 0, cabinets: [] };
        dataPorts.push(currentPort);
      }
      currentPort.cabinets.push({
        col: tile.col,
        row: tile.row,
        displayCol,
        displayRow: tile.row,
        seq: currentPort.cabinets.length + 1,
        globalIndex: idx + 1,
        pixels: tilePixels
      });
      currentPort.pixels += tilePixels;
    });

    const powerLoops = [];
    const midRow = Math.ceil(rows / 2);
    const midCol = Math.ceil(cols / 2);
    const powerZonesOrder = powerSplitMode === 'horiz_top_bot' && rows > 1
      ? [traversalOrder.filter((t) => t.row < midRow), traversalOrder.filter((t) => t.row >= midRow)]
      : powerSplitMode === 'vert_left_right' && cols > 1
        ? [traversalOrder.filter((t) => t.col < midCol), traversalOrder.filter((t) => t.col >= midCol)]
        : [traversalOrder];

    for (const zoneTiles of powerZonesOrder) {
      let currentLoop = null;
      for (const tile of zoneTiles) {
        const rl = rowLayout ? rowLayout[tile.row] : null;
        const tileWatts = rl ? Math.max(1, +rl.maxPowerW || cabWatts) : cabWatts;
        const displayCol = viewMode === 'rear' ? cols - 1 - tile.col : tile.col;
        if (!currentLoop || (currentLoop.watts > 0 && currentLoop.watts + tileWatts > maxWattsPerLoop)) {
          const lIdx = powerLoops.length + 1;
          currentLoop = { loopId: 'L' + lIdx, loopIndex: lIdx, watts: 0, amps: 0, cabinets: [] };
          powerLoops.push(currentLoop);
        }
        currentLoop.cabinets.push({ col: tile.col, row: tile.row, displayCol, displayRow: tile.row });
        currentLoop.watts += tileWatts;
        currentLoop.amps = Math.round((currentLoop.watts / voltageV) * 100) / 100;
      }
    }

    return {
      cols,
      rows,
      viewMode,
      totalCabinets: cols * rows,
      activeCabinets: traversalOrder.length,
      voidCabinets: Math.max(0, cols * rows - traversalOrder.length),
      dataPorts,
      powerLoops,
      warnings
    };
  }

  function normalizeSfxType18(rawType) {
    const t = String(rawType || '').trim();
    if (t === 'co2_cannon' || t === 'co2_cannon_jet') return 'co2_jet';
    return t;
  }

  function getSfxCatalogSpec18(type) {
    const normType = normalizeSfxType18(type);
    const cat = (root && root.SFX_CATALOG) || (root?.STUDIO && root.STUDIO.SFX_CATALOG) || {};
    const fallback = {
      cold_spark_fountain: { id: 'cold_spark_fountain', plumeHeightM: 3.5, safetyRadiusM: 1.5, safetyHeightM: 4.5, indoorAllowed: true, consumableName: 'Ti-Zr Spark Granules (200g pouch)', consumableUnit: 'g', packSize: 200, burnRatePerMin: 25 },
      co2_jet: { id: 'co2_jet', plumeHeightM: 8.0, safetyRadiusM: 2.0, safetyHeightM: 8.5, indoorAllowed: true, consumableName: 'Liquid CO2 Siphon Cylinder (20kg)', consumableUnit: 'kg', packSize: 20, burnRatePerSec: 0.45 },
      flame_jet: { id: 'flame_jet', plumeHeightM: 6.0, safetyRadiusM: 3.0, safetyHeightM: 8.0, indoorAllowed: false, consumableName: 'Isopar / LPG Pyro Fuel (5L canister)', consumableUnit: 'L', packSize: 5, burnRatePerMin: 0.25 },
      confetti_cannon: { id: 'confetti_cannon', plumeHeightM: 12.0, safetyRadiusM: 2.5, safetyHeightM: 10.0, indoorAllowed: true, consumableName: 'Flameproof Metallic Confetti (1kg bag)', consumableUnit: 'kg', packSize: 1, burnRatePerShot: 0.5 },
      haze_machine_pro: { id: 'haze_machine_pro', plumeHeightM: 2.0, safetyRadiusM: 0.5, safetyHeightM: 2.5, indoorAllowed: true, consumableName: 'Neutral Touring Haze Fluid (2.5L bottle)', consumableUnit: 'mL', packSize: 2500, burnRatePerHour: 120 }
    };
    return cat[normType] || fallback[normType] || fallback.cold_spark_fountain;
  }

  function extractStageSfxUnits18(explicitUnits) {
    if (Array.isArray(explicitUnits)) return explicitUnits;
    const items = Array.isArray(root?.STUDIO?.stageAssets16?.items) ? root.STUDIO.stageAssets16.items : [];
    const known = new Set(['cold_spark_fountain', 'co2_jet', 'flame_jet', 'confetti_cannon', 'haze_machine_pro']);
    return items.filter((it) => known.has(normalizeSfxType18(it?.type || it?.kind)));
  }

  function computeSfxSafetyZones(input = {}) {
    const venueEnv = String(input.venueEnv || 'outdoor').toLowerCase() === 'indoor' ? 'indoor' : 'outdoor';
    const ceilingHeightM = Math.max(2.5, +(input.ceilingHeightM || 12.0));
    const audienceLineZ = Number.isFinite(+input.audienceLineZ) ? +input.audienceLineZ : 4.0;
    const units = extractStageSfxUnits18(input.units ?? input.sfxUnits);

    const zones = [];
    const violations = [];
    units.forEach((u, idx) => {
      const type = normalizeSfxType18(u?.type || u?.kind || 'cold_spark_fountain') || 'cold_spark_fountain';
      const spec = getSfxCatalogSpec18(type);
      const pos = Array.isArray(u?.pos) ? u.pos : [u?.x ?? 0, u?.y ?? 0, u?.z ?? 0];
      const x = +(u?.x ?? pos[0]) || 0;
      const y = +(u?.y ?? pos[1]) || 0;
      const z = +(u?.z ?? pos[2]) || 0;
      const unitId = String(u?.id || `SFX_${idx + 1}`);
      const safetyRadiusM = +(u?.safetyRadiusM || spec.safetyRadiusM || 1.5);
      const safetyHeightM = +(u?.safetyHeightM || spec.safetyHeightM || 4.5);
      const plumeHeightM = +(u?.plumeHeightM || spec.plumeHeightM || 3.5);

      zones.push({
        unitId,
        type,
        x,
        y,
        z,
        safetyRadiusM,
        safetyHeightM,
        plumeHeightM,
        indoorAllowed: Boolean(spec.indoorAllowed)
      });

      if (venueEnv === 'indoor' && !spec.indoorAllowed) {
        violations.push({
          unitId,
          type,
          severity: 'CRITICAL',
          code: 'INDOOR_PYRO_PROHIBITED',
          message: `${unitId} (${type}) prohibited indoors per NFPA 1126 / EN 16256.`
        });
      }
      if (y + safetyHeightM > ceilingHeightM) {
        violations.push({
          unitId,
          type,
          severity: 'CRITICAL',
          code: 'CEILING_CLEARANCE_BREACH',
          message: `${unitId} safety clearance height (${(y + safetyHeightM).toFixed(1)}m) exceeds venue ceiling (${ceilingHeightM.toFixed(1)}m).`
        });
      }
      if (Math.abs(audienceLineZ - z) < safetyRadiusM) {
        violations.push({
          unitId,
          type,
          severity: 'CRITICAL',
          code: 'AUDIENCE_DISTANCE_BREACH',
          message: `${unitId} is ${Math.abs(audienceLineZ - z).toFixed(2)}m from audience line (minimum required: ${safetyRadiusM}m).`
        });
      }
    });

    return {
      venueEnv,
      ceilingHeightM,
      audienceLineZ,
      zones,
      violations,
      hasCriticalHazard: violations.some((v) => v.severity === 'CRITICAL')
    };
  }

  function computePhotometricFootprint(input = {}) {
    const lights = Array.isArray(input.lights) ? input.lights : [];
    const ledScreenNits = Math.max(100, +(input.ledScreenNits || 1200));
    const cones = lights.map((l, idx) => {
      const pos = Array.isArray(l?.pos) ? l.pos : [l?.x ?? 0, l?.y ?? 7, l?.z ?? 0];
      const x = +(l?.x ?? pos[0]) || 0;
      const y = Math.max(0.5, +(l?.y ?? pos[1]) || 7.0);
      const z = +(l?.z ?? pos[2]) || 0;
      const target = Array.isArray(l?.target) ? l.target : [l?.targetX ?? x, 0, l?.targetZ ?? z];
      const hitX = +(target[0] ?? x).toFixed(3);
      const hitZ = +(target[2] ?? z).toFixed(3);
      const throwDistanceM = +Math.max(0.5, Math.hypot(hitX - x, y - (target[1] || 0), hitZ - z)).toFixed(3);
      const type = String(l?.type || 'beam').toLowerCase();
      const beamAngleDeg = Math.max(1, Math.min(120, +(l?.beamAngleDeg || (l?.angle ? l.angle * 2 : (type === 'beam' ? 6 : 30)))));
      const halfRad = (beamAngleDeg * Math.PI) / 360;
      const spotRadiusM = +(throwDistanceM * Math.tan(halfRad)).toFixed(3);
      const spotDiameterM = +(spotRadiusM * 2).toFixed(3);
      const luminousFluxLm = Math.max(100, +(l?.luminousFluxLm || (type === 'beam' ? 18000 : type === 'strobe' ? 40000 : 22000)));
      const omegaSr = Math.max(1e-4, 2 * Math.PI * (1 - Math.cos(halfRad)));
      const candela = (luminousFluxLm / omegaSr) * 0.85;
      const cosIncidence = Math.max(0.15, y / throwDistanceM);
      const estimatedLux = Math.round((candela / (throwDistanceM * throwDistanceM)) * cosIncidence);
      return {
        id: l?.id || `LIGHT_${idx + 1}`,
        name: l?.name || `Fixture #${idx + 1}`,
        type,
        hitX,
        hitZ,
        throwDistanceM,
        beamAngleDeg,
        spotRadiusM,
        spotDiameterM,
        estimatedLux
      };
    });

    const avgFloorLux = cones.length ? Math.round(cones.reduce((acc, c) => acc + c.estimatedLux, 0) / cones.length) : 0;
    const luxToNitsRatio = +(avgFloorLux / ledScreenNits).toFixed(2);
    const exposureStatus = luxToNitsRatio < 0.8
      ? 'LED_OVEREXPOSED'
      : (luxToNitsRatio > 2.5 ? 'STAGE_HOTSPOT' : 'BALANCED_BROADCAST');

    return {
      cones,
      avgFloorLux,
      ledScreenNits,
      luxToNitsRatio,
      exposureStatus
    };
  }

  function computeEngineeringRider(eng = null, opts = {}) {
    const resolvedEng = eng || root?.STUDIO?.engine || root?.engine || null;
    const surfaces = Array.isArray(resolvedEng)
      ? resolvedEng
      : (Array.isArray(resolvedEng?.surfaces) ? resolvedEng.surfaces : []);
    const activeSurfaces = surfaces.filter((s) => !s?._deleted8);
    const baseLights = !Array.isArray(resolvedEng) && Array.isArray(resolvedEng?.lights)
      ? resolvedEng.lights.filter((l) => !l._deleted8 && l.enabled !== false)
      : [];
    const rawRigs = !Array.isArray(resolvedEng)
      ? (resolvedEng?.fixtureRigs16 ?? root?.STUDIO?.stageAssets16?.fixtureRigs16 ?? null)
      : null;
    const extraRigs = Array.isArray(rawRigs)
      ? rawRigs
      : (typeof rawRigs?.values === 'function' ? [...rawRigs.values()] : []);
    const lights = [...baseLights, ...extraRigs];

    const powerCircuits = [];
    let totalLedWeightKg = 0;
    let totalLedAvgWatts = 0;
    let totalActiveCabs = 0;
    let totalVoidCabs = 0;
    let hangingBars = 0;
    let groundStackBallastKg = 0;
    const surfaceWirings = [];
    const warnings = [];

    activeSurfaces.forEach((s) => {
      if (!s || typeof s !== 'object') return;
      if (!s.physical && (s.widthM || s.heightM)) {
        s.physical = [Number(s.widthM) || 4, Number(s.heightM) || 2.5];
      }
      normalizeSurfaceFallback18(s);
      const spec = s.cabinetSpec || {
        widthMm: Number(s.cabW) || 500,
        heightMm: Number(s.cabH) || 500,
        pxW: Number(s.pxW) || 192,
        pxH: Number(s.pxH) || 192,
        cols: Math.max(1, Number(s.cabCols) || Math.ceil((Number(s.widthM || s.physical?.[0]) || 4) / 0.5)),
        rows: Math.max(1, Number(s.cabRows) || Math.ceil((Number(s.heightM || s.physical?.[1]) || 2.5) / 0.5)),
        weightKg: 8.5,
        maxPowerW: 160,
        avgPowerW: 65,
        nits: 1200
      };
      const w = planSurfaceWiringFallback18(s);
      const curve = computeCurvedSpanFallback18(s);

      const activeCabs = w ? w.activeCabinets : Math.max(1, Number(s.activeCabinets || s.cabinets500) || (spec.cols * spec.rows));
      const voidCabs = w ? w.voidCabinets : Math.max(0, Number(s.voidCount) || 0);
      const cols = w ? w.cols : Math.max(1, Number(spec.cols) || 8);
      const rows = w ? w.rows : Math.max(1, Number(spec.rows) || 4);

      const surfaceKg = Number(s.totalWeightKg) || activeCabs * (Number(spec.weightKg) || 8.5);
      totalActiveCabs += activeCabs;
      totalVoidCabs += voidCabs;
      totalLedWeightKg += surfaceKg;
      totalLedAvgWatts += activeCabs * (Number(spec.avgPowerW) || 65);
      hangingBars += cols;

      const heightM = Number(s.totalPhysicalHeightM) || (rows * (Number(spec.heightMm) || 500)) / 1000;
      groundStackBallastKg += Math.round(surfaceKg * 1.35 + Math.pow(Math.max(0, heightM), 1.6) * 28);

      if (w && Array.isArray(w.powerLoops) && w.powerLoops.length > 0) {
        w.powerLoops.forEach((loop) => {
          powerCircuits.push({
            id: `${s.name || s.id}_${loop.loopId}`,
            watts: loop.watts,
            amps: loop.amps,
            type: 'LED'
          });
        });
        if (Array.isArray(w.warnings) && w.warnings.length) warnings.push(...w.warnings);
      } else {
        const loopWatts = activeCabs * (Number(spec.maxPowerW) || 160);
        const loopCount = Math.max(1, Math.ceil(loopWatts / 2200));
        const perLoopW = Math.round(loopWatts / loopCount);
        for (let i = 0; i < loopCount; i++) {
          powerCircuits.push({
            id: `${s.name || s.id}_L${i + 1}`,
            watts: perLoopW,
            amps: Math.round((perLoopW / 220) * 100) / 100,
            type: 'LED'
          });
        }
      }
      surfaceWirings.push({ id: s.id, name: s.name, wiring: w, curve, cabinetSpec: spec });
    });

    let currentLightCircuitW = 0;
    let lightCircuitIdx = 1;
    let totalLightWeightKg = 0;
    let totalLightWatts = 0;
    lights.forEach((l) => {
      const type = String(l.type || 'beam').toLowerCase();
      const w = Number(l.powerW ?? l.oflFixture?.powerW) || (type === 'beam' ? 380 : type === 'strobe' ? 1000 : 250);
      const kg = Number(l.weightKg ?? l.oflFixture?.weightKg) || (type === 'beam' ? 18 : type === 'strobe' ? 10 : 9);
      totalLightWeightKg += kg;
      totalLightWatts += w;
      if (currentLightCircuitW + w > 2200) {
        powerCircuits.push({ id: `LX_C${lightCircuitIdx++}`, watts: currentLightCircuitW, amps: +(currentLightCircuitW / 220).toFixed(2), type: 'LIGHT' });
        currentLightCircuitW = 0;
      }
      currentLightCircuitW += w;
    });
    if (currentLightCircuitW > 0) {
      powerCircuits.push({ id: `LX_C${lightCircuitIdx}`, watts: currentLightCircuitW, amps: +(currentLightCircuitW / 220).toFixed(2), type: 'LIGHT' });
    }

    const phases = {
      L1: { watts: 0, amps: 0, circuits: [] },
      L2: { watts: 0, amps: 0, circuits: [] },
      L3: { watts: 0, amps: 0, circuits: [] }
    };
    const sortedCircuits = [...powerCircuits].sort((a, b) => b.watts - a.watts);
    sortedCircuits.forEach((c) => {
      const target = ['L1', 'L2', 'L3'].reduce((minP, p) => (phases[p].watts < phases[minP].watts ? p : minP), 'L1');
      phases[target].watts += c.watts;
      phases[target].circuits.push(c.id);
    });
    ['L1', 'L2', 'L3'].forEach((p) => {
      phases[p].amps = Math.round((phases[p].watts / (220 * 0.9)) * 10) / 10;
    });

    const maxPhaseAmps = Math.max(phases.L1.amps, phases.L2.amps, phases.L3.amps);
    const minPhaseAmps = Math.min(phases.L1.amps, phases.L2.amps, phases.L3.amps);
    const avgPhaseAmps = (phases.L1.amps + phases.L2.amps + phases.L3.amps) / 3;
    const imbalancePercent = avgPhaseAmps > 0 ? Math.round(((maxPhaseAmps - minPhaseAmps) / avgPhaseAmps) * 1000) / 10 : 0;

    const feederLengthM = Math.max(1, +opts.feederLengthM || 50);
    const feederCrossSectionMm2 = Math.max(2.5, +opts.feederCrossSectionMm2 || 16);
    const rhoCopper = 0.0175;
    const deltaV = maxPhaseAmps > 0
      ? (Math.sqrt(3) * maxPhaseAmps * 0.85 * rhoCopper * feederLengthM) / feederCrossSectionMm2
      : 0;
    const voltageDropPercent = maxPhaseAmps > 0 ? Math.round((deltaV / 380) * 10000) / 100 : 0;
    if (voltageDropPercent > 3.0) {
      warnings.push(`Sụt áp cáp nguồn tổng (${voltageDropPercent}%) vượt ngưỡng 3%. Khuyến nghị tăng tiết diện cáp lên >= 25–35 mm².`);
    }

    const breakerSteps = [32, 63, 100, 125, 160, 250, 400];
    const requiredAmps = maxPhaseAmps * 1.25;
    const mainBreakerAmps = maxPhaseAmps > 0 ? (breakerSteps.find((b) => b >= requiredAmps) || 400) : 32;

    const trussSpanM = Math.max(2, +(opts.trussSpanM || opts.spanM || resolvedEng?.size?.width || 12));
    const cableAllowanceKg = +(totalLightWeightKg * 0.15).toFixed(2);
    const lightingWeightKg = +(totalLightWeightKg + cableAllowanceKg).toFixed(2);
    const totalRigWeightKg = totalLedWeightKg + totalLightWeightKg;
    const effectiveDeflectionLoadKg = totalLedWeightKg + lightingWeightKg;
    const udlKgPerM = Math.round((effectiveDeflectionLoadKg / trussSpanM) * 10) / 10;
    const qNPerM = (effectiveDeflectionLoadKg / trussSpanM) * 9.81;
    const E = 69e9;
    const I = 1.65e-5;
    const deflectionM = effectiveDeflectionLoadKg > 0 ? (5 * qNPerM * Math.pow(trussSpanM, 4)) / (384 * E * I) : 0;
    const deflectionMm = Math.round(deflectionM * 1000 * 100) / 100;
    const maxAllowedDeflectionMm = Math.round(((trussSpanM * 1000) / 200) * 10) / 10;
    if (deflectionMm > maxAllowedDeflectionMm) {
      warnings.push(`Độ võng Truss dự kiến (${deflectionMm} mm) vượt ngưỡng L/200 (${maxAllowedDeflectionMm} mm). Cần bổ sung điểm treo Palăng giữa nhịp.`);
    }
    const chainHoists1Ton = totalRigWeightKg > 0 ? Math.max(2, Math.ceil((totalRigWeightKg * 1.5) / 1000) + 1) : 0;
    const shackles325T = chainHoists1Ton * 2;

    const primaryPitchMm = surfaceWirings[0]?.cabinetSpec
      ? +(surfaceWirings[0].cabinetSpec.widthMm / surfaceWirings[0].cabinetSpec.pxW).toFixed(2)
      : 2.6;
    const cameraFovDeg = Math.max(15, Math.min(110, +opts.cameraFovDeg || 50));
    const minMoireDistanceM = Math.round(primaryPitchMm * 1.35 * (50 / cameraFovDeg) * 100) / 100;
    const targetNits = surfaceWirings[0]?.cabinetSpec?.nits || 1200;
    const recommendedCameraNits = Math.min(targetNits, 900);
    const recommendedKeyLightLux = Math.round(recommendedCameraNits * 1.4);

    const flightCases = Math.ceil(totalActiveCabs / 6);
    const ledVolumeM3 = flightCases * (1.15 * 0.65 * 0.78);
    const lightVolumeM3 = Math.ceil(lights.length / 2) * (0.9 * 0.55 * 0.75);
    const totalVolumeM3 = Math.round((ledVolumeM3 + lightVolumeM3) * 100) / 100;

    const powercon20ACircuits = Math.max(1, powerCircuits.filter((c) => c.type === 'LED').length);
    const phaseLoadAmps = {
      L1: Math.ceil(phases.L1.amps),
      L2: Math.ceil(phases.L2.amps),
      L3: Math.ceil(phases.L3.amps)
    };
    const recommendedBreaker = `MCCB 3P ${mainBreakerAmps}A`;
    const totalPhaseWatts = (Number(phases.L1.watts) || 0) + (Number(phases.L2.watts) || 0) + (Number(phases.L3.watts) || 0);
    const totalPowerMaxKw = +(totalPhaseWatts / 1000).toFixed(2);
    const totalPowerContinuousKw = +(((totalLedAvgWatts > 0 ? totalLedAvgWatts + totalLightWatts : totalPhaseWatts)) / 1000).toFixed(2);

    return {
      power3Phase: {
        L1: phases.L1,
        L2: phases.L2,
        L3: phases.L3,
        totalWatts: totalPhaseWatts,
        totalMaxKw: totalPowerMaxKw,
        totalContinuousKw: totalPowerContinuousKw,
        imbalancePercent,
        mainBreakerAmps,
        feederLengthM,
        feederCrossSectionMm2,
        voltageDropPercent,
        totalCircuits: powerCircuits.length
      },
      rigging: {
        totalLedWeightKg: Math.round(totalLedWeightKg * 10) / 10,
        totalLightWeightKg,
        cableAllowanceKg,
        lightingWeightKg,
        totalRigWeightKg: Math.round(totalRigWeightKg * 10) / 10,
        trussSpanM,
        udlKgPerM,
        deflectionMm,
        maxAllowedDeflectionMm,
        hangingBars,
        chainHoists1Ton,
        shackles325T,
        groundStackBallastKg
      },
      broadcastOptics: {
        primaryPitchMm,
        cameraFovDeg,
        minMoireDistanceM,
        recommendedCameraNits,
        recommendedKeyLightLux
      },
      logistics: {
        totalActiveCabs,
        totalVoidCabs,
        flightCases,
        totalVolumeM3
      },
      surfaceWirings,
      warnings,
      totalActiveCabs,
      totalVoidCabs,
      totalLedWeightKg: Math.round(totalLedWeightKg * 10) / 10,
      totalWeightKg: Math.round(totalRigWeightKg * 10) / 10,
      totalPowerContinuousKw,
      totalPowerMaxKw,
      lightingPowerW: totalLightWatts,
      phaseL1Amps: phaseLoadAmps.L1,
      phaseL2Amps: phaseLoadAmps.L2,
      phaseL3Amps: phaseLoadAmps.L3,
      hangingBars,
      shacklesCount: shackles325T,
      hoist1TonCount: chainHoists1Ton,
      ballastKg: groundStackBallastKg,
      powercon20ACircuits,
      phaseLoadAmps,
      recommendedBreaker,
      lightingWeightKg,
      cableAllowanceKg,
      trussDeflectionMm: deflectionMm,
      maxAllowableDeflectionMm: maxAllowedDeflectionMm
    };
  }

  function buildStructurePreviewSvg(surface, riggingOpts = {}) {
    const target = Array.isArray(surface) ? (surface[0] || null) : surface;
    if (!target || typeof target !== 'object') return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 260"></svg>';
    if (!target.physical && (target.widthM || target.heightM)) {
      target.physical = [Number(target.widthM) || 4, Number(target.heightM) || 2.5];
    }
    const viewMode = (riggingOpts?.viewMode || target?.wiringViewMode) === 'rear' ? 'rear' : 'front';
    const viewBanner = viewMode === 'rear' ? 'REAR VIEW (TECHNICIAN MIRROR)' : 'FRONT VIEW (AUDIENCE)';
    normalizeSurfaceFallback18(target);
    const spec = target.cabinetSpec || {
      cols: Math.max(1, Number(target.cabCols) || 8),
      rows: Math.max(1, Number(target.cabRows) || 4),
      widthMm: Number(target.cabW) || 500,
      heightMm: Number(target.cabH) || 500
    };
    const curve = computeCurvedSpanFallback18(target);
    const rows = Math.max(1, spec.rows | 0);
    const cols = Math.max(1, spec.cols | 0);
    const totalHm = Number(target.totalPhysicalHeightM) || (rows * (spec.heightMm || 500)) / 1000;
    const hMeters = totalHm.toFixed(2);
    const wMeters = ((cols * (spec.widthMm || 500)) / 1000).toFixed(2);
    const rawAngles = Array.isArray(target.columnAnglesDeg)
      ? target.columnAnglesDeg
      : Array.from({ length: cols }, () => Number(target.panelAngleDeg) || 0);
    const angles = viewMode === 'rear' ? [...rawAngles].reverse() : rawAngles;

    let sideCells = '';
    const cellH = Math.min(28, Math.floor(150 / rows));
    const rowLayout = Array.isArray(target.rowLayout) && target.rowLayout.length === rows ? target.rowLayout : null;
    const totalLayoutMm = rowLayout ? Math.max(1, rowLayout.reduce((sum, rl) => sum + (Number(rl.heightMm) || 500), 0)) : rows * (spec.heightMm || 500);
    const stackPx = rows * cellH;
    let curY = 55;
    for (let r = 0; r < rows; r++) {
      const rowMm = rowLayout ? (Number(rowLayout[r].heightMm) || 500) : (spec.heightMm || 500);
      const rH = rowLayout ? Math.max(8, Math.round((rowMm / totalLayoutMm) * stackPx)) : cellH;
      sideCells += `<rect x="95" y="${curY}" width="18" height="${Math.max(4, rH - 2)}" fill="#0ea5e9" stroke="#0284c7" stroke-width="1"/>`;
      sideCells += `<line x1="113" y1="${curY + rH / 2}" x2="155" y2="${55 + stackPx}" stroke="#64748b" stroke-dasharray="3,2"/>`;
      curY += rH;
    }

    const stepLen = Math.min(26, Math.floor(220 / cols));
    let topPath = '';
    let cx = 340;
    let cy = 150;
    let heading = 0;
    for (let c = 0; c < cols; c++) {
      heading += ((angles[c] || 0) * Math.PI) / 180;
      const nx = cx + Math.cos(heading) * stepLen;
      const ny = cy - Math.sin(heading) * stepLen;
      const colLabel = viewMode === 'rear' ? `C${cols - c}` : `C${c + 1}`;
      topPath += `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#22c55e" stroke-width="5" stroke-linecap="round"/>`;
      topPath += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.5" fill="#f8fafc"><title>${colLabel}</title></circle>`;
      cx = nx;
      cy = ny;
    }

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 280" width="100%" height="280" style="background:#0b1120;border:1px solid #1e293b;border-radius:8px;font-family:monospace">`,
      `  <text x="20" y="26" fill="#e2e8f0" font-size="13" font-weight="bold">Side View (${viewBanner}) — ${escHtml18(target.name || 'LED')} (${hMeters}m H)</text>`,
      `  <rect x="75" y="38" width="95" height="12" fill="#f59e0b" rx="2"/>`,
      `  <text x="180" y="48" fill="#fbbf24" font-size="11">Truss + Hanging Bar</text>`,
      sideCells,
      `  <line x1="40" y1="${55 + rows * cellH}" x2="230" y2="${55 + rows * cellH}" stroke="#94a3b8" stroke-width="2"/>`,
      `  <rect x="145" y="${43 + rows * cellH}" width="36" height="12" fill="#ef4444" rx="2"/>`,
      `  <text x="40" y="${74 + rows * cellH}" fill="#94a3b8" font-size="11">Rear Outrigger + Ballast</text>`,
      `  <line x1="280" y1="15" x2="280" y2="265" stroke="#1e293b" stroke-width="1"/>`,
      `  <text x="305" y="26" fill="#e2e8f0" font-size="13" font-weight="bold">Top View (Curve / Chord: ${curve.chordWidthM}m / Depth: ${curve.depthOffsetM}m)</text>`,
      topPath,
      `  <text x="305" y="245" fill="#94a3b8" font-size="11">Total Arc Width: ${wMeters}m (${cols}x${rows} cabinets · ${viewBanner})</text>`,
      `</svg>`
    ].join('\n');
  }

  function dxfLine(layer, x1, y1, x2, y2) {
    return [
      '0', 'LINE',
      '8', layer,
      '10', (+x1).toFixed(3),
      '20', (+y1).toFixed(3),
      '30', '0.0',
      '11', (+x2).toFixed(3),
      '21', (+y2).toFixed(3),
      '31', '0.0'
    ].join('\n');
  }

  function dxfRect(layer, x, y, w, h) {
    const x0 = x - w / 2;
    const x1 = x + w / 2;
    const y0 = y - h / 2;
    const y1 = y + h / 2;
    return [
      dxfLine(layer, x0, y0, x1, y0),
      dxfLine(layer, x1, y0, x1, y1),
      dxfLine(layer, x1, y1, x0, y1),
      dxfLine(layer, x0, y1, x0, y0)
    ].join('\n');
  }

  function dxfText(layer, x, y, height, text) {
    const safe = String(text || '').replace(/[\r\n]+/g, ' ');
    return [
      '0', 'TEXT',
      '8', layer,
      '10', (+x).toFixed(3),
      '20', (+y).toFixed(3),
      '30', '0.0',
      '40', (+height).toFixed(3),
      '1', safe
    ].join('\n');
  }

  function generateStageDxf(opts = {}) {
    const eng = opts?.eng || root?.STUDIO?.engine || root?.engine || null;
    const w = Math.max(2, Number(opts?.stageW || eng?.size?.width || 16));
    const d = Math.max(2, Number(opts?.stageD || eng?.size?.depth || 8));
    const viewMode = opts?.viewMode === 'rear' ? 'rear' : 'front';
    const surfaceList = Array.isArray(opts?.surfaces) ? opts.surfaces : (Array.isArray(eng?.surfaces) ? eng.surfaces : []);
    const lightList = Array.isArray(opts?.lights) ? opts.lights : (Array.isArray(eng?.lights) ? eng.lights : []);
    const sfxList = extractStageSfxUnits18(opts?.sfxUnits);
    const entities = [];

    // 1. MẶT BẰNG (TOP VIEW — gốc tại (0, 0))
    entities.push(dxfText('DIMENSIONS', -w / 2, d / 2 + 1.8, 0.45, `MAT BANG SAN KHAU (TOP VIEW) - ${w}m x ${d}m`));
    entities.push(dxfRect('STAGE_PLATFORM', 0, 0, w, d));
    if (opts?.watermark) {
      entities.push(dxfText('WATERMARK', -w / 2, -d / 2 - 1.2, 0.35, LUMI_EXPORTER_BRAND.watermarkText));
    }

    for (const s of surfaceList) {
      if (!s || s._deleted8) continue;
      const c = s.pos || s.center || s.mesh?.bounds?.center || [0, 2.5, -2];
      const sw = Number(s.physicalWidthM || s.physical?.[0] || s.physical?.width || s.totalPhysicalWidthM || 4);
      entities.push(dxfRect('LED_SCREENS', c[0] || 0, -(c[2] ?? -2), sw, 0.25));
      entities.push(dxfText('LED_SCREENS', (c[0] || 0) - sw * 0.4, -(c[2] ?? -2) + 0.3, 0.25, `${s.name || s.id || 'LED'} (${sw}m P${s.pitchMm || 3.91})`));
    }

    for (const l of lightList) {
      if (!l || l.enabled === false) continue;
      const px = l.pos?.[0] ?? l.x ?? 0;
      const pz = -(l.pos?.[2] ?? l.z ?? 0);
      entities.push(dxfRect('LIGHT_FIXTURES', px, pz, 0.3, 0.3));
    }

    if (lightList.length > 0) {
      const photo = computePhotometricFootprint({ lights: lightList });
      for (const cone of photo.cones) {
        entities.push(dxfRect('LUX_FOOTPRINT', cone.hitX, -cone.hitZ, cone.spotDiameterM, cone.spotDiameterM));
        entities.push(dxfText('LUX_FOOTPRINT', cone.hitX - 0.3, -cone.hitZ, 0.18, `${cone.estimatedLux} lx`));
      }
    }

    if (sfxList.length > 0) {
      const safety = computeSfxSafetyZones({ units: sfxList });
      for (const zZone of safety.zones) {
        const diam = zZone.safetyRadiusM * 2;
        entities.push(dxfRect('SAFETY_CLEARANCE', zZone.x, -zZone.z, diam, diam));
        entities.push(dxfText('SAFETY_CLEARANCE', zZone.x - 0.4, -zZone.z, 0.2, `CLEARANCE R=${zZone.safetyRadiusM}m`));
      }
    }

    // 2. MẶT ĐỨNG (FRONT ELEVATION / REAR VIEW TECHNICIAN MIRROR — dịch sang phải (w + 10, 0))
    const ox = w + 10;
    const elevHeader = viewMode === 'rear'
      ? 'MAT DUNG PHIA SAU - REAR VIEW (TECHNICIAN MIRROR)'
      : 'MAT DUNG CHINH DIEN (FRONT ELEVATION)';
    entities.push(dxfText('DIMENSIONS', ox - w / 2, 7.5, 0.45, elevHeader));
    entities.push(dxfRect('STAGE_PLATFORM', ox, 0.45, w, 0.9));

    for (const s of surfaceList) {
      if (!s || s._deleted8) continue;
      const c = s.pos || s.center || s.mesh?.bounds?.center || [0, 2.8, -2];
      const sw = Number(s.physicalWidthM || s.physical?.[0] || s.physical?.width || s.totalPhysicalWidthM || 4);
      const sh = Number(s.physicalHeightM || s.physical?.[1] || s.physical?.height || s.totalPhysicalHeightM || 3);
      const cx = ox + (c[0] || 0);
      const cy = c[1] ?? 2.8;
      const pxLabel = (s.w && s.h) ? `${s.w}x${s.h}px` : `P${s.pitchMm || 3.91}`;
      entities.push(dxfRect('LED_SCREENS', cx, cy, sw, sh));
      entities.push(dxfText('LED_SCREENS', cx - sw * 0.42, cy + sh * 0.5 + 0.18, 0.22, `${s.name || s.id || 'LED'} ${sw}x${sh}m (${pxLabel}) [${viewMode.toUpperCase()} VIEW]`));

      const cols = Math.max(1, Math.min(48, Number(s.cabCols) || Math.ceil(sw / 0.5)));
      const rows = Math.max(1, Math.min(32, Number(s.cabRows) || Math.ceil(sh / 0.5)));
      const cw = sw / cols;
      const ch = sh / rows;
      const left = cx - sw * 0.5;
      const top = cy + sh * 0.5;
      const rowLayout = Array.isArray(s.rowLayout) && s.rowLayout.length === rows ? s.rowLayout : null;
      const totalLayoutM = rowLayout ? Math.max(0.1, rowLayout.reduce((sum, rl) => sum + ((Number(rl.heightMm) || 500) / 1000), 0)) : sh;
      const rowHeights = [];
      const rowCenterY = [];
      for (let r = 0, accY = top; r < rows; r++) {
        const rh = rowLayout ? sh * (((Number(rowLayout[r].heightMm) || 500) / 1000) / totalLayoutM) : ch;
        rowHeights.push(rh);
        rowCenterY.push(accY - rh * 0.5);
        accY -= rh;
      }
      const voidSet = new Set(Array.isArray(s.virtualTiles) ? s.virtualTiles.map(String) : []);

      for (let r = 0; r < rows; r++) {
        const rh = rowHeights[r] ?? ch;
        const tileCy = rowCenterY[r] ?? (top - (r + 0.5) * ch);
        for (let col = 0; col < cols; col++) {
          const dispCol = viewMode === 'rear' ? (cols - 1 - col) : col;
          const tileCx = left + (dispCol + 0.5) * cw;
          if (voidSet.has(`${col},${r}`)) {
            entities.push(dxfRect('VIRTUAL_VOID', tileCx, tileCy, cw * 0.92, rh * 0.92));
          } else {
            entities.push(dxfRect('PANEL_OUTLINE', tileCx, tileCy, cw, rh));
          }
        }
      }

      const wPlan = planSurfaceWiringFallback18(s, { viewMode });
      if (wPlan && Array.isArray(wPlan.dataPorts)) {
        for (const port of wPlan.dataPorts) {
          for (let idx = 0; idx + 1 < port.cabinets.length; idx++) {
            const a = port.cabinets[idx];
            const b = port.cabinets[idx + 1];
            const colA = a.displayCol ?? a.col;
            const colB = b.displayCol ?? b.col;
            const x1 = left + (colA + 0.5) * cw;
            const y1 = rowCenterY[a.row] ?? (top - (a.row + 0.5) * ch);
            const x2 = left + (colB + 0.5) * cw;
            const y2 = rowCenterY[b.row] ?? (top - (b.row + 0.5) * ch);
            entities.push(dxfLine('WIRING_DATA', x1, y1, x2, y2));
          }
          const first = port.cabinets[0];
          if (first) {
            const colF = first.displayCol ?? first.col;
            const rhF = rowHeights[first.row] ?? ch;
            const fx = left + (colF + 0.25) * cw;
            const fy = rowCenterY[first.row] ?? (top - (first.row + 0.5) * ch);
            entities.push(dxfText('WIRING_DATA', fx, fy, Math.min(0.14, rhF * 0.28), port.portId));
          }
        }
      }
      if (wPlan && Array.isArray(wPlan.powerLoops)) {
        for (const loop of wPlan.powerLoops) {
          for (let idx = 0; idx + 1 < loop.cabinets.length; idx++) {
            const a = loop.cabinets[idx];
            const b = loop.cabinets[idx + 1];
            const colA = a.displayCol ?? a.col;
            const colB = b.displayCol ?? b.col;
            const x1 = left + (colA + 0.5) * cw;
            const y1 = (rowCenterY[a.row] ?? (top - (a.row + 0.5) * ch)) - 0.04;
            const x2 = left + (colB + 0.5) * cw;
            const y2 = (rowCenterY[b.row] ?? (top - (b.row + 0.5) * ch)) - 0.04;
            entities.push(dxfLine('WIRING_POWER', x1, y1, x2, y2));
          }
          const first = loop.cabinets[0];
          if (first) {
            const colF = first.displayCol ?? first.col;
            const rhF = rowHeights[first.row] ?? ch;
            const fx = left + (colF + 0.25) * cw;
            const fy = (rowCenterY[first.row] ?? (top - (first.row + 0.5) * ch)) - 0.08;
            entities.push(dxfText('WIRING_POWER', fx, fy, Math.min(0.12, rhF * 0.24), loop.loopId));
          }
        }
      }
      entities.push(dxfLine('WIRING_POWER', left, top + 0.08, left + sw, top + 0.08));
    }

    return [
      '0', 'SECTION',
      '2', 'HEADER',
      '9', '$INSUNITS',
      '70', '6',
      '0', 'ENDSEC',
      '0', 'SECTION',
      '2', 'ENTITIES',
      entities.join('\n'),
      '0', 'ENDSEC',
      '0', 'EOF'
    ].join('\n');
  }

  function crc32Bytes18(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function encodeUtf8Bytes18(str) {
    const raw = String(str ?? '');
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(raw);
    const wellFormed = typeof raw.toWellFormed === 'function'
      ? raw.toWellFormed()
      : raw.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
    const utf8 = unescape(encodeURIComponent(wellFormed));
    const out = new Uint8Array(utf8.length);
    for (let i = 0; i < utf8.length; i++) out[i] = utf8.charCodeAt(i);
    return out;
  }

  function buildStoreZipArchive18(fileName, contentBytes) {
    const nameBytes = encodeUtf8Bytes18(fileName);
    const crc = crc32Bytes18(contentBytes);
    const size = contentBytes.length;
    const localHeaderLen = 30 + nameBytes.length;
    const centralHeaderLen = 46 + nameBytes.length;
    const endRecordLen = 22;
    const out = new Uint8Array(localHeaderLen + size + centralHeaderLen + endRecordLen);
    const dv = new DataView(out.buffer);

    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, size, true);
    dv.setUint32(22, size, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    out.set(nameBytes, 30);
    out.set(contentBytes, localHeaderLen);

    const cdOffset = localHeaderLen + size;
    dv.setUint32(cdOffset + 0, 0x02014b50, true);
    dv.setUint16(cdOffset + 4, 20, true);
    dv.setUint16(cdOffset + 6, 20, true);
    dv.setUint16(cdOffset + 8, 0, true);
    dv.setUint16(cdOffset + 10, 0, true);
    dv.setUint16(cdOffset + 12, 0, true);
    dv.setUint16(cdOffset + 14, 0, true);
    dv.setUint32(cdOffset + 16, crc, true);
    dv.setUint32(cdOffset + 20, size, true);
    dv.setUint32(cdOffset + 24, size, true);
    dv.setUint16(cdOffset + 28, nameBytes.length, true);
    dv.setUint16(cdOffset + 30, 0, true);
    dv.setUint16(cdOffset + 32, 0, true);
    dv.setUint16(cdOffset + 34, 0, true);
    dv.setUint16(cdOffset + 36, 0, true);
    dv.setUint32(cdOffset + 38, 0, true);
    dv.setUint32(cdOffset + 42, 0, true);
    out.set(nameBytes, cdOffset + 46);

    const eocdOffset = cdOffset + centralHeaderLen;
    dv.setUint32(eocdOffset + 0, 0x06054b50, true);
    dv.setUint16(eocdOffset + 4, 0, true);
    dv.setUint16(eocdOffset + 6, 0, true);
    dv.setUint16(eocdOffset + 8, 1, true);
    dv.setUint16(eocdOffset + 10, 1, true);
    dv.setUint32(eocdOffset + 12, centralHeaderLen, true);
    dv.setUint32(eocdOffset + 16, cdOffset, true);
    dv.setUint16(eocdOffset + 20, 0, true);
    return out;
  }

  function resolveDmxChannels18(l) {
    const raw =
      +l?.dmxChannelCount ||
      (Array.isArray(l?.dmxChannels) ? l.dmxChannels.length : +l?.dmxChannels) ||
      +l?.channels ||
      16;
    return Math.max(1, Math.min(512, Math.round(raw)));
  }

  function exportLightingMvr18(opts = {}) {
    const eng = opts?.eng || root?.STUDIO?.engine || root?.engine || null;
    const rawLights = Array.isArray(opts?.lights) ? opts.lights : (Array.isArray(eng?.lights) ? eng.lights : []);
    const rawSurfaces = Array.isArray(opts?.surfaces) ? opts.surfaces : (Array.isArray(eng?.surfaces) ? eng.surfaces : []);
    const lights = rawLights.filter((l) => l && !l._deleted8);
    const surfaces = rawSurfaces.filter((s) => s && !s._deleted8);

    const fixtureXml = lights
      .map((l, idx) => {
        const xMm = Math.round((Number(l.pos?.[0] ?? l.x) || 0) * 1000);
        const yMm = Math.round(-(Number(l.pos?.[2] ?? l.z) || 0) * 1000);
        const zMm = Math.round((Number(l.pos?.[1] ?? l.y) || 0) * 1000);
        const uni = Number(l.dmxUniverse ?? l.universe) || (Math.floor(idx / 32) + 1);
        const addr = Number(l.dmxAddress ?? l.address) || ((idx % 32) * 16 + 1);
        const chCount = resolveDmxChannels18(l);
        const gdtfName = escapeXml12(l.fixtureModel18 || l.oflModel || l.name || `Fixture_${idx + 1}`);
        const uuid = `00000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`;
        return (
          `        <Fixture name="${escapeXml12(l.name || `L${idx + 1}`)}" uuid="${uuid}">\n` +
          `          <Matrix>{1,0,0}{0,1,0}{0,0,1}{${xMm},${yMm},${zMm}}</Matrix>\n` +
          `          <GDTFSpec>${gdtfName}.gdtf</GDTFSpec>\n` +
          `          <GDTFMode>Standard ${chCount}ch</GDTFMode>\n` +
          `          <Addresses><Address break="0">${(uni - 1) * 512 + addr}</Address></Addresses>\n` +
          `          <FixtureID>${idx + 1}</FixtureID>\n` +
          `          <UnitNumber>${idx + 1}</UnitNumber>\n` +
          `        </Fixture>`
        );
      })
      .join('\n');

    const videoScreenXml = surfaces
      .map((s, idx) => {
        const pos = s.pos || s.center || s.mesh?.bounds?.center || [0, 0, 0];
        const xMm = Math.round((Number(pos[0]) || 0) * 1000);
        const yMm = Math.round(-(Number(pos[2]) || 0) * 1000);
        const zMm = Math.round((Number(pos[1]) || 0) * 1000);
        const uuid = `00000000-0000-4000-9000-${String(idx + 1).padStart(12, '0')}`;
        return (
          `        <SceneObject name="${escapeXml12(s.name || `LED_${idx + 1}`)}" uuid="${uuid}">\n` +
          `          <Matrix>{1,0,0}{0,1,0}{0,0,1}{${xMm},${yMm},${zMm}}</Matrix>\n` +
          `        </SceneObject>`
        );
      })
      .join('\n');

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<GeneralSceneDescription verMajor="1" verMinor="6" provider="Alpha LED Studio" providerVersion="1.8">\n` +
      `  <Scene>\n` +
      `    <Layers>\n` +
      `      <Layer name="LumiStage_Rigging_And_Lighting" uuid="00000000-0000-4000-7000-000000000001">\n` +
      `        <ChildList>\n` +
      `${fixtureXml}\n` +
      `${videoScreenXml}\n` +
      `        </ChildList>\n` +
      `      </Layer>\n` +
      `    </Layers>\n` +
      `  </Scene>\n` +
      `</GeneralSceneDescription>`;
    const xmlBytes = encodeUtf8Bytes18(xml);
    const zipBytes = buildStoreZipArchive18('GeneralSceneDescription.xml', xmlBytes);
    return { xml, bytes: zipBytes, fixtureCount: lights.length, screenCount: surfaces.length };
  }

  function buildGrandMaFixtureXml(lights = [], opts = {}) {
    const list = Array.isArray(lights) ? lights.filter((l) => !l?._deleted8) : [];
    const version = String(opts.version || 'ma3').toLowerCase() === 'ma2' ? 'ma2' : 'ma3';
    const layerName = escapeXml12(opts.layerName || 'ALPHA_Stage_Rig');

    let cursorUni = 1;
    let cursorAddr = 1;
    const patched = list.map((l, idx) => {
      const chCount = resolveDmxChannels18(l);
      let reqUni = Math.max(1, Math.round(+(l?.dmxUniverse || l?.universe || cursorUni)));
      let reqAddr = Math.max(1, Math.round(+(l?.dmxAddress || l?.address || cursorAddr)));
      if (reqAddr + chCount - 1 > 512) {
        reqUni += 1;
        reqAddr = 1;
      }
      if (reqUni < cursorUni || (reqUni === cursorUni && reqAddr < cursorAddr)) {
        reqUni = cursorUni;
        reqAddr = cursorAddr;
        if (reqAddr + chCount - 1 > 512) {
          reqUni += 1;
          reqAddr = 1;
        }
      }
      cursorUni = reqUni;
      cursorAddr = reqAddr + chCount;
      if (cursorAddr > 512) {
        cursorUni += 1;
        cursorAddr = 1;
      }

      const rawPos = Array.isArray(l?.pos) ? l.pos : [l?.x ?? 0, l?.y ?? 0, l?.z ?? 0];
      const posX = (+(l?.x ?? rawPos[0]) || 0).toFixed(3);
      const posY = (+(l?.z ?? rawPos[2]) || 0).toFixed(3);
      const posZ = (+(l?.y ?? rawPos[1]) || 0).toFixed(3);
      const rotX = (+(l?.rx ?? 0) || 0).toFixed(1);
      const rotY = (+(l?.ry ?? 0) || 0).toFixed(1);
      const rotZ = (+(l?.rz ?? 0) || 0).toFixed(1);
      const fixId = Math.max(1, Math.round(+(l?.fixId || (101 + idx))));
      const name = escapeXml12(l?.name || `Fixture_${idx + 1}`);
      const fixtureType = escapeXml12(l?.oflModel || l?.type || 'Moving Head Beam');
      const patchDot = `${reqUni}.${String(reqAddr).padStart(3, '0')}`;
      return { idx, fixId, name, fixtureType, chCount, reqUni, reqAddr, patchDot, posX, posY, posZ, rotX, rotY, rotZ };
    });

    if (version === 'ma2') {
      const ma2Fixtures = patched.map((f) => [
        `      <Fixture index="${f.idx}" name="${f.name}" fixture_id="${f.fixId}" channel_id="${f.fixId}">`,
        `        <FixtureType name="${f.fixtureType}" />`,
        `        <SubFixture index="0" react_to_grandmaster="true" color="ffffff">`,
        `          <Patch><Address>${f.patchDot}</Address></Patch>`,
        `          <AbsolutePosition><Location x="${f.posX}" y="${f.posY}" z="${f.posZ}" /><Rotation x="${f.rotX}" y="${f.rotY}" z="${f.rotZ}" /></AbsolutePosition>`,
        `        </SubFixture>`,
        `      </Fixture>`
      ].join('\n')).join('\n');
      const ma2Macros = patched.map((f, i) =>
        `    <Macroline index="${i}"><text>Assign Fixture ${f.fixId} /x=${f.posX} /y=${f.posY} /z=${f.posZ} /dmx=${f.patchDot}</text></Macroline>`
      ).join('\n');
      return [
        `<?xml version="1.0" encoding="utf-8"?>`,
        `<MA xmlns="http://schemas.malighting.de/grandma2/xml/MA" major_vers="3" minor_vers="9" stream_vers="60">`,
        `  <Info datetime="${new Date().toISOString()}" showfile="Alpha_LED_Studio" />`,
        `  <FixtureLayer index="0" name="${layerName}">`,
        ma2Fixtures,
        `  </FixtureLayer>`,
        `  <Macro index="0" name="ALPHA Auto-Position 3D">`,
        ma2Macros,
        `  </Macro>`,
        `</MA>`
      ].join('\n');
    }

    const ma3Fixtures = patched.map((f) =>
      `      <Fixture Name="${f.name}" FixId="${f.fixId}" Patch="${f.patchDot}" FixtureType="${f.fixtureType}" Channels="${f.chCount}" PosX="${f.posX}" PosY="${f.posY}" PosZ="${f.posZ}" RotX="${f.rotX}" RotY="${f.rotY}" RotZ="${f.rotZ}" />`
    ).join('\n');
    const ma3MacroLines = patched.map((f, i) =>
      `      <MacroLine Index="${i + 1}" Command="Set Fixture ${f.fixId} Property &quot;PosX&quot; &quot;${f.posX}&quot; &quot;PosY&quot; &quot;${f.posY}&quot; &quot;PosZ&quot; &quot;${f.posZ}&quot; &quot;Patch&quot; &quot;${f.patchDot}&quot;" />`
    ).join('\n');
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<GMA3 DataVersion="1.9.7.0">`,
      `  <Patch>`,
      `    <FixtureLayer Name="${layerName}">`,
      ma3Fixtures,
      `    </FixtureLayer>`,
      `  </Patch>`,
      `  <MacroPool>`,
      `    <Macro Name="ALPHA_3D_Stage_Setup">`,
      ma3MacroLines,
      `    </Macro>`,
      `  </MacroPool>`,
      `</GMA3>`
    ].join('\n');
  }

  function generateCrewSplitDossier18(role = 'CREW_1_STAGE_RIGGING', opts = {}) {
    const lang = String(opts.lang || 'vi').toLowerCase() === 'en' ? 'en' : 'vi';
    const cp = opts.companyProfile || {};
    const struct = opts.struct || {
      totalDeckModules: 56,
      legCount: 140,
      clampCount: 168,
      stairUnits: 2,
      stepsPerStair: 6,
      layherBayStandard: '2.07m',
      standardsCount: 24,
      ledgersCount: 48,
      diagonalsCount: 16
    };
    const rider = opts.rider || computeEngineeringRider({ surfaces: opts.surfaces || [], lights: opts.lights || [] });
    const audioDiag = opts.audioDiag || {
      lineArray: { brandName: 'L-Acoustics K2', boxesPerSide: 12, bumperHeightM: 8.5, terrainSlopeDeg: 0 },
      subwoofer: { topology: 'cardioid_csa', rearRejectionDb: 15 },
      fohSplDba: 102,
      stiScore: 0.68
    };
    const unifilar = opts.unifilar || {
      totalFixtures: Array.isArray(opts.lights) ? opts.lights.length : 0,
      socapex19PinCount: 1,
      cableRunM: 45,
      voltageDropPct: 1.4,
      phaseAmps: { L1: rider.phaseL1Amps || 0, L2: rider.phaseL2Amps || 0, L3: rider.phaseL3Amps || 0 }
    };

    const roleMeta = {
      CREW_1_STAGE_RIGGING: {
        titleVi: 'TỔ 1 — SÂN KHẤU, GIÀN GIÁO LAYHER & TREO MOTOR (CREW 1: STAGE & RIGGING)',
        titleEn: 'CREW 1 — STAGE DECK, LAYHER SCAFFOLDING & RIGGING MOTORS',
        summary: `Deck 2x1m: ${struct.totalDeckModules} tấm (${struct.legCount} chân, ${struct.clampCount} khóa) · Cầu thang EN 13814: ${struct.stairUnits} cụm × ${struct.stepsPerStair} bậc · Layher ${struct.layherBayStandard}: ${struct.standardsCount} trụ, ${struct.ledgersCount} giằng ngang, ${struct.diagonalsCount} giằng chéo · Tổng tải treo: ${rider.rigging?.totalLedWeightKg ?? rider.totalLedWeightKg ?? 0} kg`
      },
      CREW_2_LED_POWER: {
        titleVi: 'TỔ 2 — MÀN HÌNH LED, ĐI DÂY RJ45 & TỦ ĐIỆN NGUỒN (CREW 2: LED & POWER)',
        titleEn: 'CREW 2 — LED CABINETS, RJ45 SIGNAL TOPOLOGY & POWER DISTRO',
        summary: (() => {
          const phaseWatts = (Number(rider.power3Phase?.L1?.watts) || 0) + (Number(rider.power3Phase?.L2?.watts) || 0) + (Number(rider.power3Phase?.L3?.watts) || 0);
          const maxKw = +(phaseWatts / 1000).toFixed(2);
          const contKw = +(Number(rider.totalPowerContinuousKw ?? maxKw)).toFixed(2);
          return `Active Cabinets: ${rider.totalActiveCabs} cab (Void: ${rider.totalVoidCabs}) · Công suất liên tục: ${contKw} kW (Đỉnh: ${maxKw} kW) · Pha L1/L2/L3: ${rider.phaseLoadAmps?.L1 ?? 0}A / ${rider.phaseLoadAmps?.L2 ?? 0}A / ${rider.phaseLoadAmps?.L3 ?? 0}A`;
        })()
      },
      CREW_3_AUDIO_PA: {
        titleVi: 'TỔ 3 — ÂM THANH LINE ARRAY, GÓC SPLAY & SUB CARDIOID (CREW 3: AUDIO & PA)',
        titleEn: 'CREW 3 — LINE ARRAY SPLAY ANGLES, CARDIOID SUBS & DELAY TOWERS',
        summary: `Hệ loa: ${audioDiag.lineArray?.brandName || 'Line Array'} (${audioDiag.lineArray?.boxesPerSide || 12} thùng/bên, cao ${audioDiag.lineArray?.bumperHeightM || 8.5}m, dốc ${audioDiag.lineArray?.terrainSlopeDeg || 0}°) · Sub ${audioDiag.subwoofer?.topology || 'cardioid_csa'} (${audioDiag.subwoofer?.rearRejectionDb || 15} dB) · FOH ${audioDiag.fohSplDba || 102} dBA · STI ${audioDiag.stiScore || 0.68}`
      },
      CREW_4_LIGHTING_DMX: {
        titleVi: 'TỔ 4 — ÁNH SÁNG DMX, ĐỊA CHỈ PATCH, SOCAPEX 19-PIN & PYRO (CREW 4: LIGHTING & SFX)',
        titleEn: 'CREW 4 — DMX PATCH, TRUSS CLAMP TAPE, 19-PIN SOCAPEX & PYRO SAFETY',
        summary: `Tổng đèn DMX: ${unifilar.totalFixtures} đèn · Cáp chính 19-Pin Socapex (6 lộ): ${unifilar.socapex19PinCount} sợi · Sụt áp cáp ${unifilar.cableRunM}m: ${unifilar.voltageDropPct}% · Pha L1/L2/L3: ${unifilar.phaseAmps?.L1 ?? 0}A / ${unifilar.phaseAmps?.L2 ?? 0}A / ${unifilar.phaseAmps?.L3 ?? 0}A`
      }
    };
    const picked = roleMeta[role] || roleMeta.CREW_1_STAGE_RIGGING;
    const title = lang === 'en' ? picked.titleEn : picked.titleVi;
    const html =
      `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${escHtml18(title)}</title></head><body>` +
      `<header><h1>${escHtml18(cp.companyName || 'GROUPLIFE EVENT')}</h1>` +
      `<p>${escHtml18(cp.slogan || '')} · Client: <b>${escHtml18(cp.clientName || 'STAGE PRODUCTION')}</b></p>` +
      `<p>Prepared By: ${escHtml18(cp.preparedBy || 'ALPHA LED Studio')} | Reviewed By: ${escHtml18(cp.reviewedBy || 'Tech Lead')}</p></header>` +
      `<main><h2>${escHtml18(title)}</h2><p>${escHtml18(picked.summary)}</p></main>` +
      `</body></html>`;
    return { role, title, summary: picked.summary, html, companyProfile: cp };
  }

  function buildPrintableStageDocumentHtml18(opts = {}) {
    const mode = opts.mode === 'tech' ? 'tech' : 'quote';
    const watermark = Boolean(opts.watermark);
    const modelName = String(opts.modelName || 'LumiStage').slice(0, 120);
    const cp = opts.companyProfile || {};
    const q = opts.quoteConfig || {};
    const bomRows = Array.isArray(opts.bomRows) ? opts.bomRows : [];
    const s = opts.summary && typeof opts.summary === 'object' ? opts.summary : {};
    const rider = s.engineeringRider || computeEngineeringRider({ surfaces: opts.surfaces || [], lights: opts.lights || [], size: { width: s.stageW || 16, depth: s.stageD || 8 } });
    const structureSvg = s.structureSvg || (Array.isArray(opts.surfaces) && opts.surfaces[0] ? buildStructurePreviewSvg(opts.surfaces[0]) : '');
    const days = Math.max(1, Number(q.rentalDays) || 1);
    const subTotal = bomRows.reduce((acc, r) => acc + Math.round((Number(r.qty) || 0) * (Number(r.unitPriceVnd) || 0) * days), 0);
    const gross = subTotal + Number(q.transportFeeVnd || 0) + Number(q.setupFeeVnd || 0);
    const discount = Math.round((gross * (Number(q.discountPercent) || 0)) / 100);
    const afterDiscount = gross - discount;
    const vatRate = q.vatMode === '10' ? 0.1 : q.vatMode === '8' ? 0.08 : 0;
    const vatAmount = Math.round(afterDiscount * vatRate);
    const grandTotal = afterDiscount + vatAmount;
    const title = mode === 'tech'
      ? `HỒ SƠ KỸ THUẬT SÂN KHẤU 3D & PIXEL MAP — ${modelName}`
      : `BÁO GIÁ THIẾT KẾ & THI CÔNG SÂN KHẤU 3D — ${modelName}`;
    const entityHeading = cp.companyName && !watermark ? cp.companyName : LUMI_EXPORTER_BRAND.legalEntity;
    const previewHtml = opts.previewDataUrl
      ? `<img class="shot" src="${escHtml18(opts.previewDataUrl)}" alt="3D Stage Preview">`
      : '<!--LUMI_STAGE_PREVIEW_SLOT-->';
    const wmBanner = watermark
      ? `<div style="padding:8px 12px;margin-bottom:14px;background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;color:#92400e;font-weight:700;text-align:center">${escHtml18(LUMI_EXPORTER_BRAND.watermarkText)}</div>`
      : '';

    return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${escHtml18(title)}</title>
      <style>
        body{font-family:Segoe UI,Arial,sans-serif;color:#0f172a;margin:28px;line-height:1.45}
        .head{display:flex;justify-content:space-between;border-bottom:2px solid #0284c7;padding-bottom:12px;margin-bottom:18px}
        h1{font-size:20px;margin:0 0 4px;color:#0369a1}
        table{width:100%;border-collapse:collapse;margin:14px 0;font-size:13px}
        th,td{border:1px solid #cbd5e1;padding:7px 9px;text-align:left}
        th{background:#f1f5f9;font-weight:700}
        .num{text-align:right}
        .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:12px 0}
        .card{border:1px solid #cbd5e1;border-radius:6px;padding:10px;background:#f8fafc}
        .shot{width:100%;max-height:340px;object-fit:contain;border-radius:6px;border:1px solid #cbd5e1;background:#080b13;margin:10px 0}
        @media print{.no-print{display:none}}
      </style></head><body>
      <div class="no-print" style="margin-bottom:14px;text-align:right">
        <button onclick="window.print()" style="padding:8px 16px;background:#0284c7;color:#fff;border:0;border-radius:6px;cursor:pointer;font-weight:600">In / Lưu thành PDF (Chuẩn A4)</button>
      </div>
      ${wmBanner}
      <div class="head">
        <div>
          <!--LUMI_COMPANY_LOGO_SLOT-->
          <h1>${escHtml18(entityHeading)}</h1>
          <div>Nền tảng Thiết kế Sân khấu 3D <strong>${escHtml18(LUMI_EXPORTER_BRAND.name)}</strong> (${escHtml18(cp.slogan || LUMI_EXPORTER_BRAND.tagline)})</div>
          <small>${escHtml18(LUMI_EXPORTER_BRAND.taxNote)}</small>
        </div>
        <div style="text-align:right">
          <strong>${escHtml18(title)}</strong><br>
          <span>Khách hàng: ${escHtml18(q.clientName || cp.clientName || 'Quý Khách hàng')}</span><br>
          <small>Ngày lập: ${escHtml18(q.eventDate || new Date().toISOString().slice(0, 10))} · Số ngày: ${days} ngày</small>
        </div>
      </div>
      ${previewHtml}
      <div class="grid">
        <div class="card"><strong>Kích thước sàn</strong><br>${Number(s.stageW) || 16}m × ${Number(s.stageD) || 8}m (${Number(s.stageAreaM2) || 128} m²)</div>
        <div class="card"><strong>Tổng diện tích LED</strong><br>${Number(s.totalLedAreaM2) || 0} m² (${Number(s.totalCabinets500) || rider.totalActiveCabs || 0} cab 500×500)</div>
        <div class="card"><strong>Xử lý điểm ảnh</strong><br>${Number(s.totalPixels || 0).toLocaleString('vi-VN')} px (${Number(s.rj45PortsNeeded) || 1} cổng RJ45)</div>
        <div class="card"><strong>Nguồn điện 3 pha & Tải treo</strong><br>${Number(s.totalMaxKw ?? rider.totalPowerMaxKw) || 0} kW (L1:${rider?.phaseLoadAmps?.L1 ?? s.currentPerPhaseAmps ?? 0}A · L2:${rider?.phaseLoadAmps?.L2 ?? s.currentPerPhaseAmps ?? 0}A · L3:${rider?.phaseLoadAmps?.L3 ?? s.currentPerPhaseAmps ?? 0}A · ${rider?.powercon20ACircuits || 1} lộ PowerCON 20A) · Treo ${Number(s.totalRiggingWeightKg ?? rider.totalWeightKg) || 0} kg (${rider?.hangingBars || 0} thanh treo · Đối trọng ${rider?.ballastKg || 0} kg)</div>
      </div>
      ${mode === 'tech' && structureSvg ? `<div style="margin:12px 0"><strong>Sơ đồ Kết cấu & Khung treo LED (Structure & Rigging Preview)</strong>${structureSvg}</div>` : ''}
      <table>
        <thead>
          <tr>
            <th>STT</th><th>Hạng mục</th><th>Thiết bị & Quy cách</th><th>Thông số kỹ thuật</th><th>ĐVT</th><th class="num">SL</th>
            ${mode === 'quote' ? `<th class="num">Đơn giá (đ)</th><th class="num">Ngày</th><th class="num">Thành tiền (đ)</th>` : ''}
          </tr>
        </thead>
        <tbody>
          ${bomRows.map((r, i) => `<tr>
            <td>${i + 1}</td>
            <td>${escHtml18(r.category)}</td>
            <td>${escHtml18(r.name)}</td>
            <td>${escHtml18(r.spec)}</td>
            <td>${escHtml18(r.unit)}</td>
            <td class="num">${Number(r.qty) || 0}</td>
            ${mode === 'quote' ? `<td class="num">${Number(r.unitPriceVnd || 0).toLocaleString('vi-VN')}</td><td class="num">${days}</td><td class="num">${Math.round((Number(r.qty) || 0) * (Number(r.unitPriceVnd) || 0) * days).toLocaleString('vi-VN')}</td>` : ''}
          </tr>`).join('')}
        </tbody>
      </table>
      ${mode === 'quote' ? `
      <div style="margin-left:auto;max-width:420px">
        <table>
          <tr><td>Chi phí vận chuyển 2 chiều</td><td class="num">${Number(q.transportFeeVnd || 0).toLocaleString('vi-VN')} đ</td></tr>
          <tr><td>Chi phí lắp đặt & vận hành kỹ thuật</td><td class="num">${Number(q.setupFeeVnd || 0).toLocaleString('vi-VN')} đ</td></tr>
          ${discount > 0 ? `<tr><td>Chiết khấu (${Number(q.discountPercent) || 0}%)</td><td class="num">-${discount.toLocaleString('vi-VN')} đ</td></tr>` : ''}
          <tr><td>Thuế GTGT (${q.vatMode === 'KCT' ? 'KCT — Không chịu thuế GTGT' : escHtml18(q.vatMode) + '%'})</td><td class="num">${vatAmount.toLocaleString('vi-VN')} đ</td></tr>
          <tr><th>TỔNG THANH TOÁN</th><th class="num" style="font-size:15px;color:#0369a1">${grandTotal.toLocaleString('vi-VN')} VNĐ</th></tr>
        </table>
      </div>` : `<pre style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;white-space:pre-wrap;font-size:12px">${escHtml18(opts.proposalText || '')}</pre>`}
      </body></html>`;
  }

  const api = {
    LUMI_EXPORTER_BRAND,
    escHtml18,
    escapeXml12,
    dxfLine,
    dxfRect,
    dxfText,
    generateStageDxf,
    crc32Bytes18,
    encodeUtf8Bytes18,
    buildStoreZipArchive18,
    exportLightingMvr18,
    buildGrandMaFixtureXml,
    computeSfxSafetyZones,
    computePhotometricFootprint,
    computeEngineeringRider,
    buildStructurePreviewSvg,
    generateCrewSplitDossier18,
    buildPrintableStageDocumentHtml18
  };

  if (root && typeof root === 'object') {
    root.__LUMI_PRO_EXPORTERS_18__ = api;
    const S = (root.STUDIO = root.STUDIO || {});
    S.proExporters18 = api;
  }
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
