/* ============================================================================
   V18.0 ALPHA LED STUDIO PRO EXPORTERS — SINGLE SOURCE OF TRUTH (LOCAL FILE:// & BACKEND)
   Excluded from public web bundle (lumi-studio.min.js); executed on server for PRO.
   ============================================================================ */
(function (root) {
  'use strict';

  const LUMI_EXPORTER_BRAND = {
    name: 'Alpha LED Studio',
    tagline: 'by Alpha Studio · GROUPLIFE',
    legalEntity: 'CÔNG TY TNHH MTV GROUPLIFE',
    watermarkText: 'ALPHA LED STUDIO FREE · GROUPLIFE · ALPHASTUDIO.VN',
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

  function distToSegment2D(px, pz, ax, az, bx, bz) {
    const vx = bx - ax, vz = bz - az;
    const len2 = vx * vx + vz * vz;
    if (len2 <= 1e-12) return Math.hypot(px - ax, pz - az);
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len2));
    return Math.hypot(px - (ax + t * vx), pz - (az + t * vz));
  }

  function distToRect2D(px, pz, minX, maxX, minZ, maxZ) {
    const dx = px < minX ? minX - px : (px > maxX ? px - maxX : 0);
    const dz = pz < minZ ? minZ - pz : (pz > maxZ ? pz - maxZ : 0);
    return Math.hypot(dx, dz);
  }

  function distToPolygon2D(px, pz, poly) {
    if (!Array.isArray(poly) || poly.length < 3) return Infinity;
    const pts = poly.map((pt) => (Array.isArray(pt) ? [+pt[0] || 0, +pt[1] || 0] : [+pt?.x || 0, +pt?.z || 0]));
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, zi] = pts[i], [xj, zj] = pts[j];
      if (((zi > pz) !== (zj > pz)) && (px < ((xj - xi) * (pz - zi)) / ((zj - zi) || 1e-12) + xi)) {
        inside = !inside;
      }
    }
    if (inside) return 0;
    let best = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      best = Math.min(best, distToSegment2D(px, pz, pts[j][0], pts[j][1], pts[i][0], pts[i][1]));
    }
    return best;
  }

  function isFiniteSafetyNum(v) {
    return v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(+v);
  }

  function computeAudienceDist2D(x, z, input = {}, peopleList = null, hasExplicitLineZ = false, audienceLineZ = 4.0) {
    let best = Infinity;
    let usedExplicit2D = false;
    if (Array.isArray(input.audiencePoints) && input.audiencePoints.length) {
      usedExplicit2D = true;
      for (const pt of input.audiencePoints) {
        if (!pt) continue;
        const ax = Array.isArray(pt) ? (+pt[0] || 0) : (+pt.x || 0);
        const az = Array.isArray(pt) ? (+pt[1] || 0) : (+pt.z || 0);
        best = Math.min(best, Math.hypot(x - ax, z - az));
      }
    }
    if (Array.isArray(input.audiencePolygon) && input.audiencePolygon.length >= 3) {
      usedExplicit2D = true;
      best = Math.min(best, distToPolygon2D(x, z, input.audiencePolygon));
    }
    if (Array.isArray(input.audienceZones) && input.audienceZones.length) {
      usedExplicit2D = true;
      for (const zn of input.audienceZones) {
        if (!zn) continue;
        const minX = isFiniteSafetyNum(zn.minX) ? +zn.minX : ((+zn.x || 0) - Math.max(0, +zn.halfW || 0));
        const maxX = isFiniteSafetyNum(zn.maxX) ? +zn.maxX : ((+zn.x || 0) + Math.max(0, +zn.halfW || 0));
        const minZ = isFiniteSafetyNum(zn.minZ) ? +zn.minZ : ((+zn.z || 0) - Math.max(0, +zn.halfD || 0));
        const maxZ = isFiniteSafetyNum(zn.maxZ) ? +zn.maxZ : ((+zn.z || 0) + Math.max(0, +zn.halfD || 0));
        best = Math.min(best, distToRect2D(x, z, minX, maxX, minZ, maxZ));
      }
    }
    if (usedExplicit2D && Number.isFinite(best)) return best;

    if (!hasExplicitLineZ && Array.isArray(peopleList)) {
      const audList = peopleList.filter((p) => p && p.type === 'audience' && !p.hidden);
      if (audList.length) {
        for (const p of audList) {
          const px = +(p.pos?.[0] ?? p.x ?? 0) || 0;
          const pz = +(p.pos?.[2] ?? p.z ?? 0) || 0;
          const rad = ((Number(p.yaw) || 0) * Math.PI) / 180;
          const cs = Math.cos(rad), sn = Math.sin(rad);
          const rawSc = (Number(p.height) > 0 ? Number(p.height) : 1.75) / 1.75;
          const sc = Array.isArray(input.audience) ? Math.max(0.3, rawSc) : rawSc;
          const isSeated = p.posture === 'seated' || p.seated === true;
          const maxSx = isSeated ? 1.18 : 1.22;
          const occPad = (isSeated ? 0.55 : 0.80) * maxSx;
          if (Array.isArray(p.seats) && p.seats.length) {
            const occR = occPad * sc;
            if (Array.isArray(input.audience)) {
              for (const st of p.seats) {
                if (!st) continue;
                const slx = (Array.isArray(st) ? (+st[0] || 0) : (+st.x || 0)) * sc;
                const slz = (Array.isArray(st) ? (+st[1] || 0) : (+st.z || 0)) * sc;
                const wx = px + slx * cs + slz * sn;
                const wz = pz - slx * sn + slz * cs;
                best = Math.min(best, Math.max(0, Math.hypot(x - wx, z - wz) - occR));
              }
            } else {
              const seatCount = Math.max(1, Math.min(2400, Math.round(Number(p.count) || 24)));
              const lim = Math.min(seatCount, p.seats.length);
              for (let si = 0; si < lim; si++) {
                const st = p.seats[si];
                if (!Array.isArray(st) || st.length < 3) continue;
                const slx = (+st[0] || 0) * sc;
                const slz = (+st[1] || 0) * sc;
                const wx = px + slx * cs + slz * sn;
                const wz = pz - slx * sn + slz * cs;
                best = Math.min(best, Math.max(0, Math.hypot(x - wx, z - wz) - occR));
              }
            }
          } else {
            const count = Math.max(1, Math.min(2400, Math.round(Number(p.count) || 24)));
            const cols = Math.max(1, Math.min(count, Math.round(Number(p.columns) || 12)));
            const rows = Math.ceil(count / cols);
            const sp = Math.max(0.3, Math.min(2, Number(p.spacing) || 0.65));
            const rowSp = sp * (isSeated ? 1.16 : 0.866);
            const halfW = ((cols - 1) * sp) * 0.5;
            const maxD = (rows - 1) * rowSp;
            const padX = (isSeated ? 0.0125 * sp : ((rows > 1 ? 0.25 * sp : 0) + 0.14 * sp)) + occPad;
            const padZMin = (isSeated ? 0.01 * sp : 0.12 * sp) + occPad;
            const padZMax = (isSeated ? 0.15 * sp : 0.34 * sp) + occPad;
            const dx = (x - px) / sc, dz = (z - pz) / sc;
            const lx = dx * cs - dz * sn;
            const lz = dx * sn + dz * cs;
            best = Math.min(best, distToRect2D(lx, lz, -halfW - padX, halfW + padX, -padZMin, maxD + padZMax) * sc);
          }
        }
        if (Number.isFinite(best)) return best;
      }
    }
    return Math.max(0, audienceLineZ - z);
  }

  function resolveOverheadCeilingM(x, y, z, safetyRadiusM, safetyHeightM, sc, eng, hasExplicitCeiling, venueEnv, ceilingHeightM) {
    let limit = (venueEnv === 'indoor' || hasExplicitCeiling) ? ceilingHeightM : Infinity;
    if (!hasExplicitCeiling) {
      const stageMeshes = Array.isArray(eng?.stage) ? eng.stage : [];
      let matchedCanopyMesh = false;
      for (const m of stageMeshes) {
        if (!m || m.hidden || !m._venueArch18 || !m.bounds) continue;
        if (!/canopy|roof|ceiling/i.test(String(m.name || ''))) continue;
        const b = m.bounds;
        if (distToRect2D(x, z, b.min[0], b.max[0], b.min[2], b.max[2]) < safetyRadiusM && y <= b.max[1] && (y + safetyHeightM) > b.min[1]) {
          limit = Math.min(limit, b.min[1]);
          matchedCanopyMesh = true;
        }
      }
      if (!matchedCanopyMesh && sc?.venueEnabled && sc?.venueType === 'outdoor_roof') {
        const roofW = (Number(sc.deckWidthM) || 14) + 3.0;
        const roofD = (Number(sc.deckDepthM) || 8) + 2.0;
        const canopyMinY = 9.2 - 0.85 * 0.5;
        const canopyMaxY = 9.2 + 0.85 * 0.5;
        if (distToRect2D(x, z, -roofW * 0.5, roofW * 0.5, -0.5 - roofD * 0.5, -0.5 + roofD * 0.5) < safetyRadiusM && y <= canopyMaxY && (y + safetyHeightM) > canopyMinY) {
          limit = Math.min(limit, canopyMinY);
        }
      }
    }
    return limit;
  }

  function computeSfxSafetyZones(input = {}) {
    const sc = root?.STUDIO?.lumi18?.state?.structureConfig18;
    const eng = root?.STUDIO?.engine;
    const rawEnv = input.venueEnv !== undefined && input.venueEnv !== null ? String(input.venueEnv).trim() : '';
    const venueEnv = rawEnv
      ? (rawEnv.toLowerCase() === 'indoor' ? 'indoor' : 'outdoor')
      : (sc?.venueEnabled && sc?.venueType === 'indoor_hall' ? 'indoor' : 'outdoor');
    const hasExplicitCeiling = isFiniteSafetyNum(input.ceilingHeightM);
    const ceilingHeightM = Math.max(2.5, hasExplicitCeiling ? +input.ceilingHeightM : (isFiniteSafetyNum(sc?.venueHeight) ? +sc.venueHeight : 12.0));
    const hasExplicitLineZ = isFiniteSafetyNum(input.audienceLineZ);
    const audienceLineZ = hasExplicitLineZ ? +input.audienceLineZ : 4.0;
    const peopleList = Array.isArray(input.audience)
      ? input.audience
      : (Array.isArray(root?.STUDIO?.seq?.people) ? root.STUDIO.seq.people : null);
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
          blocking: true,
          code: 'INDOOR_PYRO_PROHIBITED',
          message: `${unitId} (${type}) prohibited indoors per NFPA 1126 / EN 16256.`
        });
      }
      const unitCeilingM = resolveOverheadCeilingM(x, y, z, safetyRadiusM, safetyHeightM, sc, eng, hasExplicitCeiling, venueEnv, ceilingHeightM);
      if (Number.isFinite(unitCeilingM) && y + safetyHeightM > unitCeilingM) {
        violations.push({
          unitId,
          type,
          severity: 'CRITICAL',
          blocking: true,
          code: 'CEILING_CLEARANCE_BREACH',
          message: `${unitId} safety clearance height (${(y + safetyHeightM).toFixed(1)}m) exceeds venue ceiling (${unitCeilingM.toFixed(1)}m).`
        });
      }
      const audienceDistM = computeAudienceDist2D(x, z, input, peopleList, hasExplicitLineZ, audienceLineZ);
      if (audienceDistM < safetyRadiusM) {
        violations.push({
          unitId,
          type,
          severity: 'CRITICAL',
          blocking: true,
          code: 'AUDIENCE_DISTANCE_BREACH',
          distanceM: +audienceDistM.toFixed(2),
          message: `${unitId} is ${audienceDistM.toFixed(2)}m from audience (minimum required: ${safetyRadiusM}m).`
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
    const coreFn = [root?.STUDIO?.computePhotometricFootprint, root?.computePhotometricFootprint]
      .find((fn) => typeof fn === 'function' && fn._isCorePhoto22);
    if (coreFn) {
      return coreFn(input);
    }
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

  function buildStoreZipEntries18(entries = []) {
    const cleanEntries = (Array.isArray(entries) ? entries : [])
      .filter((e) => e && e.name && e.bytes)
      .map((e) => {
        const nameBytes = encodeUtf8Bytes18(e.name);
        const contentBytes = e.bytes instanceof Uint8Array ? e.bytes : new Uint8Array(e.bytes);
        return {
          nameBytes,
          contentBytes,
          crc: crc32Bytes18(contentBytes),
          size: contentBytes.length,
          localOffset: 0
        };
      });

    let localTotal = 0;
    let cdTotal = 0;
    for (const item of cleanEntries) {
      item.localOffset = localTotal;
      localTotal += 30 + item.nameBytes.length + item.size;
      cdTotal += 46 + item.nameBytes.length;
    }
    const endRecordLen = 22;
    const out = new Uint8Array(localTotal + cdTotal + endRecordLen);
    const dv = new DataView(out.buffer);

    for (const item of cleanEntries) {
      const off = item.localOffset;
      dv.setUint32(off + 0, 0x04034b50, true);
      dv.setUint16(off + 4, 20, true);
      dv.setUint16(off + 6, 0, true);
      dv.setUint16(off + 8, 0, true);
      dv.setUint16(off + 10, 0, true);
      dv.setUint16(off + 12, 0, true);
      dv.setUint32(off + 14, item.crc, true);
      dv.setUint32(off + 18, item.size, true);
      dv.setUint32(off + 22, item.size, true);
      dv.setUint16(off + 26, item.nameBytes.length, true);
      dv.setUint16(off + 28, 0, true);
      out.set(item.nameBytes, off + 30);
      out.set(item.contentBytes, off + 30 + item.nameBytes.length);
    }

    let cdCursor = localTotal;
    for (const item of cleanEntries) {
      dv.setUint32(cdCursor + 0, 0x02014b50, true);
      dv.setUint16(cdCursor + 4, 20, true);
      dv.setUint16(cdCursor + 6, 20, true);
      dv.setUint16(cdCursor + 8, 0, true);
      dv.setUint16(cdCursor + 10, 0, true);
      dv.setUint16(cdCursor + 12, 0, true);
      dv.setUint16(cdCursor + 14, 0, true);
      dv.setUint32(cdCursor + 16, item.crc, true);
      dv.setUint32(cdCursor + 20, item.size, true);
      dv.setUint32(cdCursor + 24, item.size, true);
      dv.setUint16(cdCursor + 28, item.nameBytes.length, true);
      dv.setUint16(cdCursor + 30, 0, true);
      dv.setUint16(cdCursor + 32, 0, true);
      dv.setUint16(cdCursor + 34, 0, true);
      dv.setUint16(cdCursor + 36, 0, true);
      dv.setUint32(cdCursor + 38, 0, true);
      dv.setUint32(cdCursor + 42, item.localOffset, true);
      out.set(item.nameBytes, cdCursor + 46);
      cdCursor += 46 + item.nameBytes.length;
    }

    const eocdOffset = localTotal + cdTotal;
    dv.setUint32(eocdOffset + 0, 0x06054b50, true);
    dv.setUint16(eocdOffset + 4, 0, true);
    dv.setUint16(eocdOffset + 6, 0, true);
    dv.setUint16(eocdOffset + 8, cleanEntries.length, true);
    dv.setUint16(eocdOffset + 10, cleanEntries.length, true);
    dv.setUint32(eocdOffset + 12, cdTotal, true);
    dv.setUint32(eocdOffset + 16, localTotal, true);
    dv.setUint16(eocdOffset + 20, 0, true);
    return out;
  }

  function buildStoreZipArchive18(fileName, contentBytes) {
    return buildStoreZipEntries18([{ name: fileName, bytes: contentBytes }]);
  }

  function resolveDmxChannels18(l) {
    const profMod = root?.STUDIO?.profileIR22 || root?.profileIR22;
    const cachedFootprint = l?.profileKey && profMod?.GDTFStore22?.getSync
      ? Number(profMod.GDTFStore22.getSync(l.profileKey)?.footprint)
      : 0;
    const raw =
      +l?.dmxChannelCount ||
      (Array.isArray(l?.dmxChannels) ? l.dmxChannels.length : +l?.dmxChannels) ||
      +l?.channels ||
      (Number.isFinite(cachedFootprint) && cachedFootprint > 0 ? cachedFootprint : 0) ||
      +l?.profileIr?.footprint ||
      16;
    return Math.max(1, Math.min(512, Math.round(raw)));
  }

  // Basis change C = [[1,0,0],[0,0,1],[0,-1,0]] mapping Y-up (x,y,z) -> Z-up (x,-z,y)
  // Computes R_zup = C^T * R_yup * C so rotated lights & screens share exact right-handed MVR 1.6 orientation
  function basisMatrixMvrFromYup(rotDeg = [0, 0, 0], posM = [0, 0, 0]) {
    const rx = ((Number(rotDeg?.[0]) || 0) * Math.PI) / 180;
    const ry = ((Number(rotDeg?.[1]) || 0) * Math.PI) / 180;
    const rz = ((Number(rotDeg?.[2]) || 0) * Math.PI) / 180;
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    // R_yup = Rz * Ry * Rx (3x3 row-major)
    const r00 = cz * cy;
    const r01 = cz * sy * sx - sz * cx;
    const r02 = cz * sy * cx + sz * sx;
    const r10 = sz * cy;
    const r11 = sz * sy * sx + cz * cx;
    const r12 = sz * sy * cx - cz * sx;
    const r20 = -sy;
    const r21 = cy * sx;
    const r22 = cy * cx;

    // Conjugation C^T * R_yup * C where C maps Z-up columns (X, -Z_y, Y_y) -> Y-up
    // col 0 = [1,0,0], col 1 = [0,0,-1], col 2 = [0,1,0]; rows of C^T swap & negate rows 1,2
    const m00 = r00,  m01 = -r02,  m02 = r01;
    const m10 = -r20, m11 = r22,   m12 = -r21;
    const m20 = r10,  m21 = -r12,  m22 = r11;

    const f = (n) => {
      const v = Math.abs(n) < 1e-6 ? 0 : +n.toFixed(6);
      return Number.isFinite(v) ? v : 0;
    };
    const tx = Math.round((Number(posM?.[0]) || 0) * 1000);
    const ty = Math.round(-(Number(posM?.[2]) || 0) * 1000);
    const tz = Math.round((Number(posM?.[1]) || 0) * 1000);
    // MVR 4x3 format writes basis columns u, v, w then translation t
    return `{${f(m00)},${f(m10)},${f(m20)}}{${f(m01)},${f(m11)},${f(m21)}}{${f(m02)},${f(m12)},${f(m22)}}{${tx},${ty},${tz}}`;
  }

  function resolveLightEulerYup18(l) {
    if (Array.isArray(l?.rotDeg) && l.rotDeg.length === 3) return l.rotDeg;
    if (Number.isFinite(+l?.rx) || Number.isFinite(+l?.ry) || Number.isFinite(+l?.rz)) {
      return [+l.rx || 0, +l.ry || 0, +l.rz || 0];
    }
    if (Array.isArray(l?.pos) && Array.isArray(l?.target)) {
      const dx = (Number(l.target[0]) || 0) - (Number(l.pos[0]) || 0);
      const dy = (Number(l.target[1]) || 0) - (Number(l.pos[1]) || 0);
      const dz = (Number(l.target[2]) || 0) - (Number(l.pos[2]) || 0);
      if (Math.hypot(dx, dy, dz) > 1e-4) {
        const horiz = Math.max(1e-6, Math.hypot(dx, dz));
        const yawDeg = (Math.atan2(-dx, -dz) * 180) / Math.PI;
        const pitchDeg = (Math.atan2(dy, horiz) * 180) / Math.PI;
        return [pitchDeg, yawDeg, 0];
      }
    }
    return [0, 0, 0];
  }

  function exportLightingMvr18(opts = {}) {
    const eng = opts?.eng || root?.STUDIO?.engine || root?.engine || null;
    const rawLights = Array.isArray(opts?.lights) ? opts.lights : (Array.isArray(eng?.lights) ? eng.lights : []);
    const rawSurfaces = Array.isArray(opts?.surfaces) ? opts.surfaces : (Array.isArray(eng?.surfaces) ? eng.surfaces : []);
    const lights = rawLights.filter((l) => l && !l._deleted8);
    const surfaces = rawSurfaces.filter((s) => s && !s._deleted8);
    const store = root?.STUDIO?.profileIR22?.GDTFStore22 || root?.profileIR22?.GDTFStore22 || null;

    const gdtfEntries = new Map();
    const gdtfFileByProfileKey = new Map();
    const warnings = [];
    const fixtureXml = lights
      .map((l, idx) => {
        const posM = [Number(l.pos?.[0] ?? l.x) || 0, Number(l.pos?.[1] ?? l.y) || 0, Number(l.pos?.[2] ?? l.z) || 0];
        const matrixStr = basisMatrixMvrFromYup(resolveLightEulerYup18(l), posM);
        const rawUni = Number(l.dmxUniverse ?? l.universe);
        const rawAddr = Number(l.dmxAddress ?? l.address);
        const uni = Number.isFinite(rawUni) && rawUni > 0 ? Math.max(1, Math.round(rawUni)) : (Math.floor(idx / 32) + 1);
        const addr = Number.isFinite(rawAddr) && rawAddr > 0 ? Math.max(1, Math.min(512, Math.round(rawAddr))) : ((idx % 32) * 16 + 1);
        const chCount = resolveDmxChannels18(l);
        const uuid = `00000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`;

        const rawGdtf = l.profileKey && store?.getRawBytesSync ? store.getRawBytesSync(l.profileKey) : null;
        const gdtfBase = String(l.fixtureModel18 || l.oflModel || l.name || `Fixture_${idx + 1}`)
          .replace(/\.gdtf$/i, '')
          .replace(/[^A-Za-z0-9._-]+/g, '_');
        let gdtfSpecLine = '';
        if (rawGdtf && rawGdtf.byteLength > 0) {
          let gdtfFile = gdtfFileByProfileKey.get(l.profileKey);
          if (!gdtfFile) {
            gdtfFile = `${gdtfBase}.gdtf`;
            if (gdtfEntries.has(gdtfFile)) {
              let h = 0x811c9dc5;
              const pk = String(l.profileKey);
              for (let hi = 0; hi < pk.length; hi++) { h ^= pk.charCodeAt(hi); h = Math.imul(h, 0x01000193); }
              gdtfFile = `${gdtfBase}_${(h >>> 0).toString(16).slice(0, 6)}.gdtf`;
            }
            gdtfFileByProfileKey.set(l.profileKey, gdtfFile);
            gdtfEntries.set(gdtfFile, rawGdtf);
          }
          gdtfSpecLine = `\n          <GDTFSpec>${escapeXml12(gdtfFile)}</GDTFSpec>`;
        } else {
          warnings.push(`Fixture "${l.name || l.id || idx + 1}": omitted missing <GDTFSpec> (no cached .gdtf binary).`);
        }

        return (
          `        <Fixture name="${escapeXml12(l.name || `L${idx + 1}`)}" uuid="${uuid}">\n` +
          `          <Matrix>${matrixStr}</Matrix>${gdtfSpecLine}\n` +
          `          <GDTFMode>${escapeXml12(l.dmxMode || l.oflModeName || `Standard ${chCount}ch`)}</GDTFMode>\n` +
          `          <Addresses><Address break="0">${(uni - 1) * 512 + addr}</Address></Addresses>\n` +
          `          <FixtureID>${Math.max(1, Math.round(+(l.fixId || (idx + 1))))}</FixtureID>\n` +
          `          <UnitNumber>${idx + 1}</UnitNumber>\n` +
          `        </Fixture>`
        );
      })
      .join('\n');

    const videoScreenXml = surfaces
      .map((s, idx) => {
        const pos = s.pos || s.center || s.mesh?.bounds?.center || [0, 0, 0];
        const rot = Array.isArray(s.rotDeg) ? s.rotDeg : [Number(s.pitchDeg) || 0, Number(s.yawDeg ?? s.rotation) || 0, Number(s.rollDeg) || 0];
        const matrixStr = basisMatrixMvrFromYup(rot, pos);
        const uuid = `00000000-0000-4000-9000-${String(idx + 1).padStart(12, '0')}`;
        return (
          `        <SceneObject name="${escapeXml12(s.name || `LED_${idx + 1}`)}" uuid="${uuid}">\n` +
          `          <Matrix>${matrixStr}</Matrix>\n` +
          `        </SceneObject>`
        );
      })
      .join('\n');

    // DIN SPEC 15801 (MVR 1.6)
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<GeneralSceneDescription verMajor="1" verMinor="6" provider="Alpha LED Studio" providerVersion="22.0">\n` +
      `  <Scene>\n` +
      `    <Layers>\n` +
      `      <Layer name="Alpha_LED_Studio_Rigging_And_Lighting" uuid="00000000-0000-4000-7000-000000000001">\n` +
      `        <ChildList>\n` +
      `${fixtureXml}\n` +
      `${videoScreenXml}\n` +
      `        </ChildList>\n` +
      `      </Layer>\n` +
      `    </Layers>\n` +
      `  </Scene>\n` +
      `</GeneralSceneDescription>`;
    const xmlBytes = encodeUtf8Bytes18(xml);
    const zipEntries = [{ name: 'GeneralSceneDescription.xml', bytes: xmlBytes }];
    for (const [name, bytes] of gdtfEntries.entries()) {
      zipEntries.push({ name, bytes });
    }
    const zipBytes = buildStoreZipEntries18(zipEntries);
    return {
      xml,
      bytes: zipBytes,
      fixtureCount: lights.length,
      screenCount: surfaces.length,
      embeddedGdtfCount: gdtfEntries.size,
      warnings
    };
  }

  function normalizePatchedLights18(lights) {
    const list = Array.isArray(lights) ? lights.filter((l) => !l?._deleted8) : [];
    let cursorUni = 1;
    let cursorAddr = 1;
    const normalized = list.map((l, idx) => {
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
      const posY = (-(+(l?.z ?? rawPos[2]) || 0)).toFixed(3);
      const posZ = (+(l?.y ?? rawPos[1]) || 0).toFixed(3);
      const ma3PosY = (+(l?.z ?? rawPos[2]) || 0).toFixed(3);
      const rotX = (+(l?.rx ?? l?.rotDeg?.[0] ?? 0) || 0).toFixed(1);
      const rotY = (+(l?.ry ?? l?.rotDeg?.[1] ?? 0) || 0).toFixed(1);
      const rotZ = (+(l?.rz ?? l?.rotDeg?.[2] ?? 0) || 0).toFixed(1);
      const fixId = Math.max(1, Math.round(+(l?.fixId || (101 + idx))));
      const name = escapeXml12(l?.name || `Fixture_${idx + 1}`);
      const ir = resolveProfileIr18(l);
      const baseRawFtName = String(ir?.model || l?.oflModel || l?.type || 'Moving Head Beam');
      const irPhys = ir?.physical || {};
      const irPhysSig = [
        isFiniteSafetyNum(irPhys.lumens) && Number(irPhys.lumens) >= 0 ? Number(irPhys.lumens) : '',
        isFiniteSafetyNum(irPhys.powerW) ? Number(irPhys.powerW) : '',
        isFiniteSafetyNum(irPhys.beamAngleMin) ? Number(irPhys.beamAngleMin) : '',
        isFiniteSafetyNum(irPhys.weightKg) ? Number(irPhys.weightKg) : ''
      ].join(',');
      const irCapSig = (caps) => Array.isArray(caps)
        ? caps.map((c) => `${c?.dmxFrom ?? ''}-${c?.dmxTo ?? ''}:${c?.name || ''}:${c?.label || ''}:${c?.physFrom ?? ''}:${c?.physTo ?? ''}:${c?.colorHex || c?.hex || ''}:${c?.slotIndex ?? ''}:${c?.goboName || ''}`).join(',')
        : '';
      const irSlotsSigFn = (sl) => Array.isArray(sl)
        ? sl.map((s) => `${s?.offset || ''}:${s?.fineOffset || ''}:${s?.role || ''}:${s?.name || ''}:${s?.defaultDmx ?? ''}:${s?.highlightDmx ?? ''}:${irCapSig(s?.capabilities)}`).join(';')
        : '';
      const irSlotsSig = irSlotsSigFn(ir?.slots);
      const irCellsSig = Array.isArray(ir?.cells)
        ? ir.cells.map((c) => `${c?.cellIndex ?? c?.index ?? ''}:${c?.key || c?.name || ''}:${c?.moduleIndex ?? ''}:${c?.patch ?? ''}:${Array.isArray(c?.pos) ? c.pos.join(',') : ''}:${irSlotsSigFn(c?.slots)}`).join(';')
        : '';
      const irWheelsSig = ir?.wheelColors ? JSON.stringify(ir.wheelColors) : '';
      const irSig = `${String(ir?.profileKey || `${ir?.id || baseRawFtName}:${ir?.mode || chCount}:${chCount}`)}|${ir?.manufacturer || ''}|${ir?.category || ''}|${irPhysSig}|${irWheelsSig}|${irCellsSig}|${irSlotsSig}`;
      const patchDot = `${reqUni}.${String(reqAddr).padStart(3, '0')}`;
      const absDmxAddr = (reqUni - 1) * 512 + reqAddr;
      return { idx, fixId, name, baseRawFtName, irSig, ir, chCount, reqUni, reqAddr, absDmxAddr, patchDot, posX, posY, ma3PosY, posZ, rotX, rotY, rotZ };
    });
    const sigsByName = new Map();
    for (const item of normalized) {
      if (!sigsByName.has(item.baseRawFtName)) sigsByName.set(item.baseRawFtName, new Set());
      sigsByName.get(item.baseRawFtName).add(item.irSig);
    }
    const slugToSig = new Map();
    const sigToSlug = new Map();
    const ftNameToSig = new Map();
    const sigToFtName = new Map();
    return normalized.map((item) => {
      const needsModeSuffix = (sigsByName.get(item.baseRawFtName)?.size || 0) > 1;
      const modeTag = String(item.ir?.mode || `${item.chCount}ch`);
      const candFtName = needsModeSuffix ? `${item.baseRawFtName} (${modeTag})` : item.baseRawFtName;
      let rawFtName = sigToFtName.get(item.irSig);
      if (!rawFtName) {
        rawFtName = candFtName;
        let nameIdx = 2;
        while (ftNameToSig.has(rawFtName) && ftNameToSig.get(rawFtName) !== item.irSig) {
          rawFtName = `${candFtName} #${nameIdx++}`;
        }
        sigToFtName.set(item.irSig, rawFtName);
        ftNameToSig.set(rawFtName, item.irSig);
      }
      let fixtureSlug = sigToSlug.get(item.irSig);
      if (!fixtureSlug) {
        const baseSlug = slugifyMa2FileName18(`${item.ir?.id || item.baseRawFtName}_${modeTag}`, item.idx);
        fixtureSlug = baseSlug;
        let suffix = 2;
        while (slugToSig.has(fixtureSlug) && slugToSig.get(fixtureSlug) !== item.irSig) {
          fixtureSlug = `${baseSlug}_${suffix++}`;
        }
        sigToSlug.set(item.irSig, fixtureSlug);
        slugToSig.set(fixtureSlug, item.irSig);
      }
      const fixtureType = escapeXml12(rawFtName);
      return { ...item, rawFtName, fixtureType, fixtureSlug };
    });
  }

  function slugifyMa2FileName18(raw, fallbackIdx = 0) {
    const clean = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return clean || `fixture_type_${fallbackIdx + 1}`;
  }

  function sanitizeProfileCap18(c) {
    if (!c || typeof c !== 'object') return null;
    const d0 = Number(c.dmxFrom ?? 0);
    const d1 = Number(c.dmxTo ?? 255);
    const dmxFrom = Math.max(0, Math.min(255, Math.round(Number.isFinite(d0) ? d0 : 0)));
    const dmxTo = Math.max(dmxFrom, Math.min(255, Math.round(Number.isFinite(d1) ? d1 : 255)));
    const out = {
      name: String(c.name || '').slice(0, 80),
      dmxFrom,
      dmxTo
    };
    if (c.label != null && c.label !== '') out.label = String(c.label).slice(0, 80);
    if (c.subattribute != null && c.subattribute !== '') out.subattribute = String(c.subattribute).slice(0, 64);
    if (isFiniteSafetyNum(c.physFrom)) out.physFrom = Number(c.physFrom);
    if (isFiniteSafetyNum(c.physTo)) out.physTo = Number(c.physTo);
    const hex = c.colorHex || c.hex;
    if (typeof hex === 'string' && hex.trim()) out.colorHex = hex.trim().slice(0, 32);
    if (isFiniteSafetyNum(c.slotIndex)) out.slotIndex = Math.round(Number(c.slotIndex));
    if (c.goboName != null && c.goboName !== '') out.goboName = String(c.goboName).slice(0, 80);
    return out;
  }

  function sanitizeProfileSlot18(s, idx) {
    if (!s || typeof s !== 'object') return null;
    const rawOff = Number(s.offset ?? (idx + 1));
    if (!Number.isFinite(rawOff) || rawOff < 1 || rawOff > 512) return null;
    const rawFine = s.fineOffset != null && s.fineOffset !== '' ? Number(s.fineOffset) : NaN;
    const fineOffset = Number.isFinite(rawFine) && rawFine >= 1 && rawFine <= 512 ? Math.round(rawFine) : null;
    const rawDef = Number(s.defaultDmx ?? s.defaultValue ?? 0);
    const rawHi = Number(s.highlightDmx ?? 255);
    return {
      offset: Math.round(rawOff),
      fineOffset,
      name: String(s.name || `Ch${idx + 1}`).slice(0, 80),
      role: String(s.role || 'other').slice(0, 40),
      defaultDmx: Math.max(0, Math.min(255, Math.round(Number.isFinite(rawDef) ? rawDef : 0))),
      highlightDmx: Math.max(0, Math.min(255, Math.round(Number.isFinite(rawHi) ? rawHi : 255))),
      capabilities: Array.isArray(s.capabilities)
        ? s.capabilities.slice(0, 128).map(sanitizeProfileCap18).filter(Boolean)
        : []
    };
  }

  function sanitizeProfileIr18(rawIr, fallbackChCount = 16) {
    if (!rawIr || typeof rawIr !== 'object') return null;
    const slots = Array.isArray(rawIr.slots)
      ? rawIr.slots.slice(0, 512).map((s, i) => sanitizeProfileSlot18(s, i)).filter(Boolean)
      : [];
    const cells = Array.isArray(rawIr.cells)
      ? rawIr.cells.slice(0, 256).map((c, ci) => {
          if (!c || typeof c !== 'object') return null;
          const cellSlots = Array.isArray(c.slots)
            ? c.slots.slice(0, 64).map((s, si) => sanitizeProfileSlot18(s, si)).filter(Boolean)
            : [];
          const patchRaw = Number(c.patch);
          const pos = Array.isArray(c.pos)
            ? [Number(c.pos[0]) || 0, Number(c.pos[1]) || 0, Number(c.pos[2]) || 0]
            : undefined;
          const cellOut = {
            cellIndex: isFiniteSafetyNum(c.cellIndex ?? c.index) ? Math.round(Number(c.cellIndex ?? c.index)) : ci,
            key: String(c.key || c.name || `Instance_${ci + 1}`).slice(0, 80),
            slots: cellSlots
          };
          if (isFiniteSafetyNum(c.moduleIndex)) cellOut.moduleIndex = Math.round(Number(c.moduleIndex));
          if (Number.isFinite(patchRaw) && patchRaw >= 1 && patchRaw <= 512) cellOut.patch = Math.round(patchRaw);
          if (pos) cellOut.pos = pos;
          return cellOut;
        }).filter(Boolean)
      : [];
    if (!slots.length && !cells.length && !rawIr.profileKey) return null;

    let maxOff = Number(rawIr.footprint) || 0;
    for (const s of slots) maxOff = Math.max(maxOff, s.offset, s.fineOffset || 0);
    for (const c of cells) {
      for (const s of c.slots) maxOff = Math.max(maxOff, s.offset, s.fineOffset || 0);
    }
    const footprint = Math.max(1, Math.min(512, Math.round(maxOff || fallbackChCount || 16)));
    const pIn = rawIr.physical && typeof rawIr.physical === 'object' ? rawIr.physical : {};
    const physical = {};
    if (isFiniteSafetyNum(pIn.lumens) && Number(pIn.lumens) >= 0) physical.lumens = Number(pIn.lumens);
    if (isFiniteSafetyNum(pIn.beamAngleMin) && Number(pIn.beamAngleMin) > 0) physical.beamAngleMin = Number(pIn.beamAngleMin);
    if (isFiniteSafetyNum(pIn.beamAngleMax) && Number(pIn.beamAngleMax) > 0) physical.beamAngleMax = Number(pIn.beamAngleMax);
    if (isFiniteSafetyNum(pIn.powerW) && Number(pIn.powerW) >= 0) physical.powerW = Number(pIn.powerW);
    if (isFiniteSafetyNum(pIn.weightKg) && Number(pIn.weightKg) >= 0) physical.weightKg = Number(pIn.weightKg);
    if (isFiniteSafetyNum(pIn.colorTempK) && Number(pIn.colorTempK) > 0) physical.colorTempK = Number(pIn.colorTempK);
    if (isFiniteSafetyNum(pIn.panMaxDeg) && Number(pIn.panMaxDeg) >= 0) physical.panMaxDeg = Number(pIn.panMaxDeg);
    if (isFiniteSafetyNum(pIn.tiltMaxDeg) && Number(pIn.tiltMaxDeg) >= 0) physical.tiltMaxDeg = Number(pIn.tiltMaxDeg);

    let wheelColors;
    if (rawIr.wheelColors && typeof rawIr.wheelColors === 'object' && !Array.isArray(rawIr.wheelColors)) {
      const wc = {};
      let wCount = 0;
      for (const [wName, wList] of Object.entries(rawIr.wheelColors)) {
        if (wCount >= 16) break;
        if (!Array.isArray(wList)) continue;
        wc[String(wName).slice(0, 64)] = wList.slice(0, 64).map((ws, wi) => ({
          index: isFiniteSafetyNum(ws?.index) ? Math.round(Number(ws.index)) : (wi + 1),
          name: String(ws?.name || `Slot ${wi + 1}`).slice(0, 64),
          colorHex: typeof (ws?.colorHex || ws?.hex) === 'string' ? String(ws.colorHex || ws.hex).slice(0, 32) : null
        }));
        wCount++;
      }
      if (wCount > 0) wheelColors = wc;
    }

    const out = {
      id: String(rawIr.id || rawIr.model || 'custom').slice(0, 120),
      manufacturer: String(rawIr.manufacturer || 'Generic').slice(0, 120),
      model: String(rawIr.model || 'Custom Fixture').slice(0, 120),
      mode: String(rawIr.mode || `${footprint}ch`).slice(0, 80),
      footprint,
      slots,
      cells,
      physical
    };
    if (typeof rawIr.profileKey === 'string' && rawIr.profileKey.trim()) out.profileKey = rawIr.profileKey.trim().slice(0, 180);
    if (typeof rawIr.category === 'string' && rawIr.category.trim()) out.category = rawIr.category.trim().slice(0, 40);
    if (wheelColors) out.wheelColors = wheelColors;
    return out;
  }

  function resolveProfileIr18(light) {
    const profMod = root?.STUDIO?.profileIR22 || root?.profileIR22;
    if (light?.profileKey && profMod?.GDTFStore22?.getSync) {
      const cached = profMod.GDTFStore22.getSync(light.profileKey);
      if (cached) return cached;
    }
    if (light?.profileIr && typeof light.profileIr === 'object') {
      const sanitized = sanitizeProfileIr18(light.profileIr, resolveDmxChannels18(light));
      if (sanitized) return sanitized;
    }
    const oflKey = light?.oflProfileId || light?.oflId || light?.oflModel || light?.model;
    if (oflKey && typeof root?.resolveOflFixture === 'function' && profMod?.compileOflProfile) {
      const fx = root.resolveOflFixture(oflKey);
      if (fx) return profMod.compileOflProfile(fx, light?.oflModeIndex || 0);
    }
    if (Array.isArray(light?.dmxChannels) && light.dmxChannels.length > 0) {
      return {
        id: light.oflProfileId || light.model || 'custom',
        manufacturer: light.oflManufacturer || 'Generic',
        model: light.oflModel || light.model || light.type || 'Custom Fixture',
        mode: light.dmxMode || `${resolveDmxChannels18(light)}ch`,
        footprint: resolveDmxChannels18(light),
        slots: light.dmxChannels.map((ch, i) => ({
          offset: ch.offset || i + 1,
          fineOffset: ch.fineOffset || null,
          name: ch.name || `Ch${i + 1}`,
          role: ch.role || 'other',
          defaultDmx: ch.defaultDmx ?? ch.defaultValue ?? 0,
          highlightDmx: ch.highlightDmx ?? 255,
          capabilities: Array.isArray(ch.capabilities) ? ch.capabilities : []
        })),
        cells: [],
        physical: {
          beamAngleMin: light.beamAngleDeg || 12,
          lumens: (light.luminousFluxLm !== null && light.luminousFluxLm !== undefined && light.luminousFluxLm !== '' && typeof light.luminousFluxLm !== 'boolean' && Number.isFinite(Number(light.luminousFluxLm)) && Number(light.luminousFluxLm) >= 0)
            ? Number(light.luminousFluxLm)
            : 10000
        }
      };
    }
    if (profMod?.buildPlaceholderProfile) {
      return profMod.buildPlaceholderProfile(light?.oflModel || light?.type || 'Generic Fixture', resolveDmxChannels18(light));
    }
    return null;
  }

  const MA2_ROLE_META_18 = Object.assign(Object.create(null), {
    dimmer: ['DIM', 'DIMMER', 'DIMMER'],
    pan: ['PAN', 'POSITION', 'POSITION'],
    tilt: ['TILT', 'POSITION', 'POSITION'],
    shutter: ['SHUTTER', 'SHUTTER', 'BEAM'],
    red: ['COLORRGB1', 'COLORRGB', 'COLOR'],
    green: ['COLORRGB2', 'COLORRGB', 'COLOR'],
    blue: ['COLORRGB3', 'COLORRGB', 'COLOR'],
    white: ['COLORRGB4', 'COLORRGB', 'COLOR'],
    amber: ['COLORRGB5', 'COLORRGB', 'COLOR'],
    uv: ['COLORRGB6', 'COLORRGB', 'COLOR'],
    cyan: ['COLORRGB_C', 'COLORRGB', 'COLOR'],
    magenta: ['COLORRGB_M', 'COLORRGB', 'COLOR'],
    yellow: ['COLORRGB_Y', 'COLORRGB', 'COLOR'],
    colorWheel: ['COLOR1', 'COLOR1', 'COLOR'],
    gobo: ['GOBO1', 'GOBO1', 'GOBO'],
    goboRot: ['GOBO1_POS', 'GOBO1', 'GOBO'],
    prism: ['PRISMA1', 'BEAM', 'BEAM'],
    prismRot: ['PRISMA1_POS', 'BEAM', 'BEAM'],
    zoom: ['ZOOM', 'FOCUS', 'FOCUS'],
    focus: ['FOCUS', 'FOCUS', 'FOCUS'],
    frost: ['FROST', 'BEAM', 'BEAM'],
    iris: ['IRIS', 'BEAM', 'BEAM'],
    speed: ['SPEED', 'CONTROL', 'CONTROL'],
    cto: ['CTO', 'COLORRGB', 'COLOR'],
    effect: ['EFFECT', 'CONTROL', 'CONTROL'],
    dummy: ['DUMMY', 'CONTROL', 'CONTROL'],
    control: ['CONTROL', 'CONTROL', 'CONTROL']
  });

  function hexToMa2RgbAttr18(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim());
    if (!m) return '';
    return `${(parseInt(m[1], 16) / 255).toFixed(3)} ${(parseInt(m[2], 16) / 255).toFixed(3)} ${(parseInt(m[3], 16) / 255).toFixed(3)}`;
  }

  function buildGrandMa2FixtureTypeXml(profileIr, opts = {}) {
    const ir = profileIr || {};
    const ftName = escapeXml12(opts.name || ir.model || 'Alpha Moving Light');
    const shortName = escapeXml12(String(opts.shortName || ir.model || 'AlphaFix').slice(0, 16));
    const manufacturer = escapeXml12(opts.manufacturer || ir.manufacturer || 'Generic');
    const modeName = escapeXml12(opts.mode || ir.mode || `${ir.footprint || 16}ch`);
    const slots = Array.isArray(ir.slots) ? ir.slots : [];
    const cells = Array.isArray(ir.cells) ? ir.cells : [];

    // Separate main module slots from sub-cell slots so module coarse/fine remain clean
    const cellOffsetSet = new Set();
    for (const c of cells) {
      for (const s of (c?.slots || [])) {
        if (s?.offset) cellOffsetSet.add(s.offset);
        if (s?.fineOffset) cellOffsetSet.add(s.fineOffset);
      }
    }
    const mainSlots = slots.filter((s) => s && s.offset >= 1 && !cellOffsetSet.has(s.offset));

    const wheelsXmlEntries = [];
    let colorWheelSlotMap = new Map();
    const cwSlot = mainSlots.find((s) => s.role === 'colorWheel' && Array.isArray(s.capabilities) && s.capabilities.length > 0);
    if (cwSlot) {
      const coloredCaps = cwSlot.capabilities.filter((c) => c.colorHex || c.hex);
      if (coloredCaps.length > 0) {
        const wSlotXml = coloredCaps.map((c, idx) => {
          const hex = c.colorHex || c.hex;
          colorWheelSlotMap.set(c, idx + 1);
          const colAttr = hexToMa2RgbAttr18(hex);
          return `        <Slot index="${idx}" name="${escapeXml12(c.name || `Color ${idx + 1}`)}" color="${colAttr}" />`;
        }).join('\n');
        wheelsXmlEntries.push(`      <Wheel index="0" name="Color Wheel">\n${wSlotXml}\n      </Wheel>`);
      }
    }

    const renderChannelTypes = (modSlots, baseOffset = 0) => {
      const seenOffsets = new Set();
      const lines = [];
      let ctIdx = 0;
      for (const s of modSlots) {
        const cOff = (Number(s.offset) || 1) - baseOffset;
        if (cOff < 1 || seenOffsets.has(cOff)) continue;
        seenOffsets.add(cOff);
        let fOff = s.fineOffset ? (Number(s.fineOffset) - baseOffset) : null;
        if (fOff !== null && (fOff < 1 || seenOffsets.has(fOff))) fOff = null;
        if (fOff !== null) seenOffsets.add(fOff);

        const meta = MA2_ROLE_META_18[s.role] || [escapeXml12(String(s.name || `CH${cOff}`).toUpperCase().replace(/[^A-Z0-9_]/g, '_')), 'CONTROL', 'CONTROL'];
        const rawDef = Number(s.defaultDmx ?? 0);
        const rawHi = Number(s.highlightDmx ?? 255);
        const defVal = Math.max(0, Math.min(255, Math.round(Number.isFinite(rawDef) ? rawDef : 0)));
        const hiVal = Math.max(0, Math.min(255, Math.round(Number.isFinite(rawHi) ? rawHi : 255)));
        const fineAttr = fOff ? ` fine="${fOff}"` : '';
        const wheelAttr = s.role === 'colorWheel' && wheelsXmlEntries.length ? ` wheel="0"` : '';

        const caps = Array.isArray(s.capabilities) && s.capabilities.length
          ? s.capabilities
          : [{ name: s.name || meta[0], dmxFrom: 0, dmxTo: 255, physFrom: 0, physTo: 100 }];

        // Group capabilities into separate <ChannelFunction> elements whenever explicit finite physical bounds differ
        const cfGroups = [];
        for (const c of caps) {
          const rawP0 = c?.physFrom;
          const rawP1 = c?.physTo;
          const p0 = (rawP0 !== undefined && rawP0 !== null && rawP0 !== '') ? Number(rawP0) : NaN;
          const p1 = (rawP1 !== undefined && rawP1 !== null && rawP1 !== '') ? Number(rawP1) : NaN;
          const hasPhys = Number.isFinite(p0) && Number.isFinite(p1);
          const physKey = hasPhys ? `${p0}:${p1}` : 'none';
          const last = cfGroups[cfGroups.length - 1];
          if (last && last.physKey === physKey) {
            last.caps.push(c);
          } else {
            cfGroups.push({ physKey, hasPhys, physFrom: hasPhys ? p0 : null, physTo: hasPhys ? p1 : null, caps: [c] });
          }
        }
        const cfXml = cfGroups.map((grp, fi) => {
          const gCaps = grp.caps;
          const d0First = Number(gCaps[0]?.dmxFrom ?? 0);
          const d1Last = Number(gCaps[gCaps.length - 1]?.dmxTo ?? 255);
          const gf0 = cfGroups.length === 1 ? 0 : Math.max(0, Math.min(255, Math.round(Number.isFinite(d0First) ? d0First : 0)));
          const gf1 = cfGroups.length === 1 ? 255 : Math.max(gf0, Math.min(255, Math.round(Number.isFinite(d1Last) ? d1Last : 255)));
          const csXml = gCaps.map((c, ci) => {
            const rawD0 = Number(c.dmxFrom ?? gf0);
            const rawD1 = Number(c.dmxTo ?? gf1);
            const d0 = Math.max(0, Math.min(255, Math.round(Number.isFinite(rawD0) ? rawD0 : gf0)));
            const d1 = Math.max(d0, Math.min(255, Math.round(Number.isFinite(rawD1) ? rawD1 : gf1)));
            const slotRef = colorWheelSlotMap.has(c) ? ` slot_from="${colorWheelSlotMap.get(c)}" slot_to="${colorWheelSlotMap.get(c)}"` : '';
            const colAttr = (c.colorHex || c.hex) ? ` color="${escapeXml12(c.colorHex || c.hex)}"` : '';
            return `            <ChannelSet index="${ci}" name="${escapeXml12(c.name || `Set ${ci + 1}`)}" from_dmx="${d0}" to_dmx="${d1}"${slotRef}${colAttr} />`;
          }).join('\n');
          const cfFrom = grp.hasPhys ? grp.physFrom : 0;
          const cfTo = grp.hasPhys ? grp.physTo : (s.role === 'shutter' ? 0 : 100);
          return (
            `          <ChannelFunction index="${fi}" name="${escapeXml12(s.name || meta[0])}" subattribute="${meta[0]}" from="${cfFrom}" to="${cfTo}" from_dmx="${gf0}" to_dmx="${gf1}"${wheelAttr}>\n` +
            `${csXml}\n` +
            `          </ChannelFunction>`
          );
        }).join('\n');
        lines.push(
          `        <ChannelType index="${ctIdx++}" attribute="${meta[0]}" feature="${meta[1]}" preset="${meta[2]}" coarse="${cOff}"${fineAttr} default="${defVal}" highlight="${hiVal}">\n` +
          `${cfXml}\n` +
          `        </ChannelType>`
        );
      }
      return lines.join('\n');
    };

    const beamDeg = Number(ir.physical?.beamAngleMax || ir.physical?.beamAngleMin || 12);
    const rawLumens = ir.physical?.lumens;
    const lumens = (rawLumens !== null && rawLumens !== undefined && rawLumens !== '' && typeof rawLumens !== 'boolean' && Number.isFinite(Number(rawLumens)) && Number(rawLumens) >= 0)
      ? Number(rawLumens)
      : 10000;
    const cat = String(ir.category || '').toLowerCase();
    const irId = String(ir.id || ir.model || '').toLowerCase();
    const hasPanTilt = mainSlots.some((s) => s.role === 'pan' || s.role === 'tilt');
    let modClass = 'Headmover';
    let beamType = 'Spot';
    if (cat === 'other' || irId.includes('hazer') || irId.includes('sparkular')) {
      modClass = 'None';
      beamType = 'None';
    } else if (cat === 'laser') {
      modClass = 'Laser';
      beamType = 'Spot';
    } else if (cat === 'strobe' || cat === 'blinder') {
      modClass = hasPanTilt ? 'Headmover' : 'LED';
      beamType = 'Strobe';
    } else if (cat === 'par') {
      modClass = irId.includes('dimmer') ? 'Conventional' : 'LED';
      beamType = 'Wash';
    } else if (cat === 'wash') {
      modClass = hasPanTilt ? 'Headmover' : 'Conventional';
      beamType = hasPanTilt ? 'Wash' : 'Fresnel';
    } else if (cat === 'pixel' || cat === 'bar') {
      modClass = 'Headmover';
      beamType = 'Wash';
    }

    const coveredMain = new Set();
    for (const s of mainSlots) {
      if (s.offset >= 1) coveredMain.add(Math.round(Number(s.offset)));
      if (s.fineOffset >= 1) coveredMain.add(Math.round(Number(s.fineOffset)));
    }
    const paddedMainSlots = [...mainSlots];
    const totalFootprint = Math.max(1, Math.min(512, Math.round(Number(ir.footprint) || 0)));
    for (let off = 1; off <= totalFootprint; off++) {
      if (!coveredMain.has(off) && !cellOffsetSet.has(off)) {
        paddedMainSlots.push({
          offset: off,
          fineOffset: null,
          name: 'Dummy',
          role: 'dummy',
          defaultDmx: 0,
          highlightDmx: 0,
          capabilities: [{ name: 'Dummy', dmxFrom: 0, dmxTo: 255, physFrom: 0, physTo: 100 }]
        });
      }
    }
    paddedMainSlots.sort((a, b) => (Number(a.offset) || 0) - (Number(b.offset) || 0));

    const moduleXmlParts = [
      `      <Module index="0" name="Main Module" class="${modClass}" beamtype="${beamType}" beam_angle="${beamDeg}" beam_intensity="${lumens}">\n${renderChannelTypes(paddedMainSlots, 0)}\n      </Module>`
    ];

    const instanceXmlParts = [`      <Instance index="0" module_index="0" patch="1" x="0.000" y="0.000" z="0.000" />`];
    const activeCells = cells.filter((cell) => Array.isArray(cell?.slots) && cell.slots.length > 0);
    if (activeCells.length > 0) {
      const cellModMap = new Map();
      let nextCellModIdx = 1;
      const cellLumens = Math.round(lumens / Math.max(1, activeCells.length));
      activeCells.forEach((cell, ci) => {
        const slotOffsets = cell.slots.map((s) => Number(s?.offset)).filter((n) => Number.isFinite(n) && n >= 1);
        const minSlotOff = slotOffsets.length ? Math.min(...slotOffsets) : 1;
        const explicitPatch = Number.isFinite(Number(cell.patch)) && Number(cell.patch) >= 1 ? Math.round(Number(cell.patch)) : null;
        const cellBase = explicitPatch !== null && explicitPatch <= minSlotOff ? explicitPatch : minSlotOff;
        const patchStart = Math.max(1, Math.min(512, cellBase));
        const relCellSlots = cell.slots
          .filter((s) => s && Number.isFinite(Number(s.offset)) && Number(s.offset) >= 1)
          .map((s) => {
            const relOff = Math.max(1, Math.round(Number(s.offset)) - patchStart + 1);
            const rawFine = s.fineOffset != null && s.fineOffset !== '' ? Number(s.fineOffset) : NaN;
            const relFine = Number.isFinite(rawFine) && rawFine >= patchStart ? (Math.round(rawFine) - patchStart + 1) : null;
            return {
              ...s,
              offset: relOff,
              fineOffset: relFine
            };
          })
          .sort((a, b) => (Number(a.offset) || 0) - (Number(b.offset) || 0));
        const cellChXml = renderChannelTypes(relCellSlots, 0);
        let modIdx = cellModMap.get(cellChXml);
        if (modIdx === undefined) {
          modIdx = nextCellModIdx++;
          cellModMap.set(cellChXml, modIdx);
          const modName = modIdx === 1 ? 'LED Cell' : `LED Cell ${modIdx}`;
          moduleXmlParts.push(
            `      <Module index="${modIdx}" name="${modName}" class="LED" beamtype="Wash" beam_angle="${beamDeg}" beam_intensity="${cellLumens}">\n${cellChXml}\n      </Module>`
          );
        }
        const pos = Array.isArray(cell.pos) ? cell.pos : [((ci - (activeCells.length - 1) * 0.5) * 0.08), 0, 0];
        instanceXmlParts.push(
          `      <Instance index="${ci + 1}" module_index="${modIdx}" patch="${patchStart}" x="${Number(pos[0] || 0).toFixed(3)}" y="${(-Number(pos[2] || 0)).toFixed(3)}" z="${Number(pos[1] || 0).toFixed(3)}" />`
        );
      });
    }

    return [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<MA xmlns="http://schemas.malighting.de/grandma2/xml/MA" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://schemas.malighting.de/grandma2/xml/MA http://schemas.malighting.de/grandma2/xml/3.9.60/MA.xsd" major_vers="3" minor_vers="9" stream_vers="60">`,
      `  <Info datetime="${new Date().toISOString()}" showfile="Alpha_LED_Studio" />`,
      `  <FixtureType index="0" name="${ftName}" short_name="${shortName}" manufacturer="${manufacturer}" mode="${modeName}">`,
      `    <Modules>`,
      moduleXmlParts.join('\n'),
      `    </Modules>`,
      `    <Instances>`,
      instanceXmlParts.join('\n'),
      `    </Instances>`,
      wheelsXmlEntries.length ? `    <Wheels>\n${wheelsXmlEntries.join('\n')}\n    </Wheels>` : `    <Wheels />`,
      `  </FixtureType>`,
      `</MA>`
    ].join('\n');
  }

  function buildGrandMaFixtureXml(lights = [], opts = {}) {
    const version = String(opts.version || 'ma3').toLowerCase() === 'ma2' ? 'ma2' : 'ma3';
    const layerName = escapeXml12(opts.layerName || 'ALPHA_Stage_Rig');
    const patched = normalizePatchedLights18(lights);

    if (version === 'ma2') {
      // MA2 3.9.60 FixtureLayer XML only (1-based integer <Address>, plus <SubFixture> for multi-cell fixtures)
      const ma2Fixtures = patched.map((f) => {
        const subCells = Array.isArray(f.ir?.cells) && f.ir.cells.length > 0
          ? f.ir.cells.map((_, ci) => `      <SubFixture index="${ci + 1}" react_to_grandmaster="true" color="ffffff" />`).join('\n') + '\n'
          : '';
        return [
          `    <Fixture index="${f.idx}" name="${f.name}" fixture_id="${f.fixId}" channel_id="${f.fixId}">`,
          `      <FixtureType name="${f.fixtureType}" />`,
          `      <SubFixture index="0" react_to_grandmaster="true" color="ffffff">`,
          `        <Patch><Address>${f.absDmxAddr}</Address></Patch>`,
          `        <AbsolutePosition><Location x="${f.posX}" y="${f.posY}" z="${f.posZ}" /><Rotation x="${f.rotX}" y="${f.rotY}" z="${f.rotZ}" /></AbsolutePosition>`,
          `      </SubFixture>`,
          subCells ? subCells.trimEnd() : null,
          `    </Fixture>`
        ].filter(Boolean).join('\n');
      }).join('\n');
      return [
        `<?xml version="1.0" encoding="utf-8"?>`,
        `<MA xmlns="http://schemas.malighting.de/grandma2/xml/MA" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://schemas.malighting.de/grandma2/xml/MA http://schemas.malighting.de/grandma2/xml/3.9.60/MA.xsd" major_vers="3" minor_vers="9" stream_vers="60">`,
        `  <Info datetime="${new Date().toISOString()}" showfile="Alpha_LED_Studio" />`,
        `  <FixtureLayer index="0" name="${layerName}">`,
        ma2Fixtures,
        `  </FixtureLayer>`,
        `</MA>`
      ].join('\n');
    }

    const ma3Fixtures = patched.map((f) =>
      `      <Fixture Name="${f.name}" FixId="${f.fixId}" Patch="${f.patchDot}" FixtureType="${f.fixtureType}" Channels="${f.chCount}" PosX="${f.posX}" PosY="${f.ma3PosY}" PosZ="${f.posZ}" RotX="${f.rotX}" RotY="${f.rotY}" RotZ="${f.rotZ}" />`
    ).join('\n');
    const ma3MacroLines = patched.map((f, i) =>
      `      <MacroLine Index="${i + 1}" Command="Set Fixture ${f.fixId} Property &quot;PosX&quot; &quot;${f.posX}&quot; &quot;PosY&quot; &quot;${f.ma3PosY}&quot; &quot;PosZ&quot; &quot;${f.posZ}&quot; &quot;Patch&quot; &quot;${f.patchDot}&quot;" />`
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

  function buildGrandMaMacroXml(lights = [], opts = {}) {
    const patched = normalizePatchedLights18(lights);
    const macroName = escapeXml12(opts.macroName || 'ALPHA Auto-Patch & Stage 3D');
    const clearFirst = opts.clearFirst !== false;
    const lines = [];
    for (const f of patched) {
      if (clearFirst) {
        lines.push(`Delete Dmx ${f.patchDot} /nc`);
      }
      lines.push(`Assign Fixture ${f.fixId} At Dmx ${f.patchDot}`);
      lines.push(`Move3D Fixture ${f.fixId} At ${f.posX} ${f.posY} ${f.posZ}`);
      if (+f.rotX !== 0 || +f.rotY !== 0 || +f.rotZ !== 0) {
        lines.push(`Rotate3D Fixture ${f.fixId} At ${f.rotX} ${f.rotY} ${f.rotZ}`);
      }
    }
    if (opts.pageId && opts.execId) {
      lines.push(`Go Executor ${Math.max(1, Number(opts.pageId) | 0)}.${Math.max(1, Number(opts.execId) | 0)}`);
    }
    const macroLines = lines.map((cmd, idx) => `    <Macroline index="${idx}"><text>${escapeXml12(cmd)}</text></Macroline>`).join('\n');
    return [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<MA xmlns="http://schemas.malighting.de/grandma2/xml/MA" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://schemas.malighting.de/grandma2/xml/MA http://schemas.malighting.de/grandma2/xml/3.9.60/MA.xsd" major_vers="3" minor_vers="9" stream_vers="60">`,
      `  <Info datetime="${new Date().toISOString()}" showfile="Alpha_LED_Studio" />`,
      `  <Macro index="0" name="${macroName}">`,
      macroLines,
      `  </Macro>`,
      `</MA>`
    ].join('\n');
  }

  function buildMaTimecodeXml(cues = [], opts = {}) {
    const fps = Math.max(1, Number(opts.fps) || 30);
    const name = escapeXml12(opts.name || 'AlphaShow_TC');
    const list = Array.isArray(cues) ? cues : [];
    const maxTimeSec = list.reduce((m, c) => Math.max(m, Number(c?.timeSec ?? c?.start ?? 0)), 0);
    const totalFrames = Math.max(1, Math.round((Number(opts.lengthSec) || (maxTimeSec + 5)) * fps));
    const eventsXml = list.map((c, idx) => {
      const f = Number.isFinite(+c?.frame) ? Math.max(0, Math.round(+c.frame)) : Math.max(0, Math.round((Number(c?.timeSec ?? c?.start ?? 0)) * fps));
      const cmd = escapeXml12(c?.cmd || c?.name || `Goto Cue ${idx + 1}`);
      return `        <Event index="${idx}" time="${f}" step="${idx + 1}" command="${cmd}" />`;
    }).join('\n');
    return [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<MA xmlns="http://schemas.malighting.de/grandma2/xml/MA" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://schemas.malighting.de/grandma2/xml/MA http://schemas.malighting.de/grandma2/xml/3.9.60/MA.xsd" major_vers="3" minor_vers="9" stream_vers="60">`,
      `  <Timecode index="0" name="${name}" length="${totalFrames}" slot="0" frame_readout="${Math.round(fps)}fps">`,
      `    <Track index="0" name="Main">`,
      `      <SubTrack index="0">`,
      eventsXml,
      `      </SubTrack>`,
      `    </Track>`,
      `  </Timecode>`,
      `</MA>`
    ].join('\n');
  }

  function cutMaTimecodeXml(xmlText, opts = {}) {
    const hadBom = String(xmlText || '').startsWith('\uFEFF');
    let text = String(xmlText || '').replace(/^\uFEFF/, '');
    const cutStart = Math.max(0, Math.round(Number(opts.cutStartFrames ?? opts.startFrame ?? 0)));
    const cutEnd = Math.max(cutStart, Math.round(Number(opts.cutEndFrames ?? opts.endFrame ?? cutStart)));
    const span = cutEnd - cutStart;
    if (span <= 0) {
      return {
        xml: (hadBom ? '\uFEFF' : '') + text,
        removedCount: 0,
        shiftedCount: 0,
        cutSpanFrames: 0
      };
    }

    let removedCount = 0;
    let shiftedCount = 0;
    let eventIdx = 0;
    text = text.replace(/<Event\b([^>]*?)\/>/g, (full, attrs) => {
      const m = /\btime\s*=\s*"(-?\d+(?:\.\d+)?)"/.exec(attrs);
      if (!m) return full;
      const t = Math.round(Number(m[1]));
      if (t >= cutStart && t < cutEnd) {
        removedCount++;
        return '';
      }
      const nextT = t >= cutEnd ? (t - span) : t;
      if (t >= cutEnd) shiftedCount++;
      let updatedAttrs = attrs.replace(/\btime\s*=\s*"[^"]*"/, `time="${nextT}"`);
      updatedAttrs = updatedAttrs.replace(/\bindex\s*=\s*"[^"]*"/, `index="${eventIdx++}"`);
      return `<Event${updatedAttrs}/>`;
    });
    text = text.replace(/(<Timecode\b[^>]*\blength\s*=\s*")(\d+)(")/, (_, pre, lenStr, post) => {
      const newLen = Math.max(0, Number(lenStr) - span);
      return `${pre}${newLen}${post}`;
    });
    text = text.replace(/\n{3,}/g, '\n');
    return {
      xml: (hadBom ? '\uFEFF' : '') + text,
      removedCount,
      shiftedCount,
      cutSpanFrames: span
    };
  }

  function parseReaperRpp(rppText) {
    const lines = String(rppText || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    let projectOffsetSec = 0;
    const markers = [];
    const tracks = [];
    const stack = [];
    let currentTrack = null;
    let currentItem = null;

    const unquote = (s) => {
      const t = String(s || '').trim();
      if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
      return t;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('<')) {
        const tag = line.slice(1).split(/\s+/)[0];
        stack.push(tag);
        if (tag === 'TRACK') {
          currentTrack = { name: '', items: [] };
          tracks.push(currentTrack);
        } else if (tag === 'ITEM' && currentTrack) {
          currentItem = { trackName: currentTrack.name, name: '', positionSec: 0, lengthSec: 0 };
          currentTrack.items.push(currentItem);
        }
        continue;
      }
      if (line === '>') {
        const closed = stack.pop();
        if (closed === 'ITEM') currentItem = null;
        if (closed === 'TRACK') currentTrack = null;
        continue;
      }
      if (line.startsWith('PROJOFFS ')) {
        projectOffsetSec = Number(line.slice(9).trim().split(/\s+/)[0]) || 0;
      } else if (line.startsWith('MARKER ')) {
        const m = /^MARKER\s+(\d+)\s+([-+\d.eE]+)\s+(?:"([^"]*)"|(\S+))(?:\s+(\d+))?/.exec(line);
        if (m) {
          markers.push({
            id: Number(m[1]),
            timeSec: Number(m[2]) || 0,
            name: m[3] !== undefined ? m[3] : (m[4] || ''),
            color: m[5] ? Number(m[5]) : 0
          });
        }
      } else if (currentItem && line.startsWith('NAME ')) {
        currentItem.name = unquote(line.slice(5));
      } else if (currentItem && line.startsWith('POSITION ')) {
        currentItem.positionSec = Number(line.slice(9).trim()) || 0;
      } else if (currentItem && line.startsWith('LENGTH ')) {
        currentItem.lengthSec = Number(line.slice(7).trim()) || 0;
      } else if (currentTrack && !currentItem && line.startsWith('NAME ')) {
        currentTrack.name = unquote(line.slice(5));
      }
    }
    return { projectOffsetSec, markers, tracks };
  }

  function exportGrandMaPackage(lights = [], opts = {}) {
    const version = String(opts.version || 'ma2').toLowerCase() === 'ma3' ? 'ma3' : 'ma2';
    const fixtureXml = buildGrandMaFixtureXml(lights, { ...opts, version });
    const macroXml = version === 'ma2' ? buildGrandMaMacroXml(lights, opts) : null;
    const timecodeXml = Array.isArray(opts.cues) && opts.cues.length
      ? buildMaTimecodeXml(opts.cues, { fps: opts.fps || 30, name: opts.showName || 'AlphaShow_TC' })
      : null;

    const entries = [
      { name: version === 'ma2' ? 'ALPHA_MA2_FixtureLayer.xml' : 'ALPHA_MA3_FixtureLayer.xml', bytes: encodeUtf8Bytes18(fixtureXml) }
    ];
    if (macroXml) entries.push({ name: 'ALPHA_MA2_PatchMacro.xml', bytes: encodeUtf8Bytes18(macroXml) });
    if (timecodeXml) entries.push({ name: 'ALPHA_MA_Timecode.xml', bytes: encodeUtf8Bytes18(timecodeXml) });

    const fixtureTypeXmls = {};
    if (version === 'ma2') {
      const patched = normalizePatchedLights18(lights);
      const seenSlugs = new Set();
      for (const f of patched) {
        if (!f.ir || seenSlugs.has(f.fixtureSlug)) continue;
        seenSlugs.add(f.fixtureSlug);
        const ftXml = buildGrandMa2FixtureTypeXml(f.ir, { name: f.rawFtName });
        const relPath = `fixture_types/${f.fixtureSlug}.xml`;
        fixtureTypeXmls[relPath] = ftXml;
        entries.push({ name: relPath, bytes: encodeUtf8Bytes18(ftXml) });
      }
    }

    const linter = root?.STUDIO?.showLinter22 || root?.showLinter22;
    const lintReport = linter?.lintShowForExport22
      ? linter.lintShowForExport22({ lights, fixtureXml, macroXml: macroXml || '', timecodeXml: timecodeXml || '', fixtureTypeXmls })
      : { ok: true, errors: [], warnings: [], rulesChecked: [] };

    return {
      version,
      fixtureXml,
      fixtureTypeXmls,
      macroXml,
      timecodeXml,
      lintReport,
      zipBytes: buildStoreZipEntries18(entries)
    };
  }

  function writeMidiVlq(val) {
    let v = Math.max(0, Math.round(Number(val) || 0));
    const out = [v & 0x7f];
    while ((v >>= 7) > 0) out.unshift((v & 0x7f) | 0x80);
    return out;
  }

  function buildMidiTrackChunk(rawBytes) {
    const chunk = new Uint8Array(8 + rawBytes.length);
    chunk[0] = 0x4d; chunk[1] = 0x54; chunk[2] = 0x72; chunk[3] = 0x6b; // "MTrk"
    const len = rawBytes.length;
    chunk[4] = (len >>> 24) & 0xff;
    chunk[5] = (len >>> 16) & 0xff;
    chunk[6] = (len >>> 8) & 0xff;
    chunk[7] = len & 0xff;
    chunk.set(rawBytes, 8);
    return chunk;
  }

  function exportMidiCueTrack18(events = [], opts = {}) {
    const ppq = 480;
    const bpm = Math.max(20, Math.min(300, Number(opts.bpm) || 120));
    const usPerBeat = Math.round(60000000 / bpm);

    // Track 0: Tempo & Time Signature meta track
    const t0 = [
      0x00, 0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff,
      0x00, 0xff, 0x58, 0x04, 4, 2, 24, 8,
      0x00, 0xff, 0x2f, 0x00
    ];

    // Track 1: Sorted Cue markers + optional MIDI note triggers scheduled on absolute ticks
    const sorted = (Array.isArray(events) ? events : [])
      .map((e, i) => {
        const rawT = Number(e?.timeSec ?? e?.start ?? e?.time ?? 0);
        const hasNote = e?.note != null && e.note !== '' && Number.isFinite(Number(e.note));
        const rawVel = Number(e?.velocity ?? 100);
        return {
          timeSec: Number.isFinite(rawT) ? Math.max(0, rawT) : 0,
          label: String(e?.label || e?.name || `Cue ${i + 1}`).slice(0, 80),
          note: hasNote ? Math.max(0, Math.min(127, Math.round(Number(e.note)))) : null,
          velocity: Number.isFinite(rawVel) ? Math.max(1, Math.min(127, Math.round(rawVel))) : 100
        };
      })
      .sort((a, b) => a.timeSec - b.timeSec);

    const ticksPerSec = (bpm / 60) * ppq;
    const noteLenTicks = Math.max(1, Math.round(ppq / 4));
    const scheduled = [];
    for (const ev of sorted) {
      const tick = Math.max(0, Math.round(ev.timeSec * ticksPerSec));
      const textBytes = encodeUtf8Bytes18(ev.label);
      scheduled.push({ tick, order: 1, bytes: [0xff, 0x07, ...writeMidiVlq(textBytes.length), ...textBytes] });
      if (ev.note !== null) {
        scheduled.push({ tick, order: 2, bytes: [0x90, ev.note, ev.velocity] });
        scheduled.push({ tick: tick + noteLenTicks, order: 0, bytes: [0x80, ev.note, 0x00] });
      }
    }
    scheduled.sort((a, b) => (a.tick - b.tick) || (a.order - b.order));

    const t1 = [];
    let lastTick = 0;
    for (const msg of scheduled) {
      const delta = Math.max(0, msg.tick - lastTick);
      lastTick = msg.tick;
      t1.push(...writeMidiVlq(delta), ...msg.bytes);
    }
    t1.push(0x00, 0xff, 0x2f, 0x00);

    const header = new Uint8Array([
      0x4d, 0x54, 0x68, 0x64, // "MThd"
      0x00, 0x00, 0x00, 0x06, // header length = 6
      0x00, 0x01,             // Format 1 (multi-track sync)
      0x00, 0x02,             // 2 tracks
      (ppq >> 8) & 0xff, ppq & 0xff
    ]);
    const trk0 = buildMidiTrackChunk(t0);
    const trk1 = buildMidiTrackChunk(t1);
    const bytes = new Uint8Array(header.length + trk0.length + trk1.length);
    bytes.set(header, 0);
    bytes.set(trk0, header.length);
    bytes.set(trk1, header.length + trk0.length);
    return { bytes, format: 1, tracks: 2, ppq, bpm, eventCount: sorted.length };
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
    const modelName = String(opts.modelName || 'Alpha LED Studio').slice(0, 120);
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
    buildStoreZipEntries18,
    buildStoreZipArchive18,
    basisMatrixMvrFromYup,
    exportLightingMvr18,
    buildGrandMa2FixtureTypeXml,
    buildGrandMaFixtureXml,
    buildGrandMaMacroXml,
    buildMaTimecodeXml,
    cutMaTimecodeXml,
    parseReaperRpp,
    exportGrandMaPackage,
    exportMidiCueTrack18,
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
