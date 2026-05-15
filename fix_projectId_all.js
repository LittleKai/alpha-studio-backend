const fs = require('fs');

// 1. studioService.ts
let ss = fs.readFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio/src/services/studioService.ts', 'utf8');
if (!ss.includes('projectId?: string;')) {
    ss = ss.replace(
        /referenceImageUrls\?\: string\[\];    \/\/ multi-image \(preferred\), max 2\n}/,
        `referenceImageUrls?: string[];    // multi-image (preferred), max 2
    projectId?: string;
}`
    );
    ss = ss.replace(
        /referenceImageUrls\?\: string\[\];\n}/,
        `referenceImageUrls?: string[];
    projectId?: string;
}`
    );
    fs.writeFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio/src/services/studioService.ts', ss);
}

// 2. route studio.js
let be = fs.readFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio-backend/server/routes/studio.js', 'utf8');

// Image extract
be = be.replace(
    /const { prompt, model, ratio, count = 1, seed, referenceImage, referenceImageUrl, referenceImageUrls } = req\.body;/,
    "const { prompt, model, ratio, count = 1, seed, referenceImage, referenceImageUrl, referenceImageUrls, projectId } = req.body;"
);

// Video extract
be = be.replace(
    /subtype, duration, count = 1,\n    } = req\.body;/,
    "subtype, duration, count = 1, projectId,\n    } = req.body;"
);

// Patch agent body injection inside agentBody
// We look for the line ...(pickProjectIdFallback(server)
const patternFallback = /\.\.\.\(pickProjectIdFallback\(server\) \? \{ projectId\: pickProjectIdFallback\(server\) \} \: \{\}\),/g;
be = be.replace(patternFallback, `...(projectId ? { projectId } : (pickProjectIdFallback(server) ? { projectId: pickProjectIdFallback(server) } : {})),`);

fs.writeFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio-backend/server/routes/studio.js', be);


// 3. StudioFlowGen.tsx UI
let ui = fs.readFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio/src/components/studio/StudioFlowGen.tsx', 'utf8');

// Add projectId to Config interfaces
if (!ui.includes('projectId?: string;')) {
    ui = ui.replace(
        /refImages: \{ file: File; dataUrl: string \}...;   \/\/ up to MAX_REF_IMAGES\n}/,
        `refImages: { file: File; dataUrl: string }[];   // up to MAX_REF_IMAGES
  projectId?: string;
}`
    );
    
    ui = ui.replace(
        /refImages: \{ file: File; dataUrl: string \}...;\n}/,
        `refImages: { file: File; dataUrl: string }[];
  projectId?: string;
}`
    );
}

// Add input layout inside Settings Popover
const uiInputReplacement = `
              {/* Project ID Input */}
              <div className="flex flex-col gap-1 pb-2 border-b border-[var(--border-primary)]">
                <label className="text-xs font-semibold text-[var(--text-secondary)]">Google Flow Project ID</label>
                <input 
                  type="text" 
                  placeholder="Optional (Auto via pool if empty)"
                  className="w-full bg-transparent border border-[var(--border-primary)] focus:border-[var(--accent-primary)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none"
                  value={mode === 'image' ? (imageCfg.projectId || '') : (videoCfg.projectId || '')}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (mode === 'image') setImageCfg(c => ({...c, projectId: val}));
                    else setVideoCfg(c => ({...c, projectId: val}));
                  }}
                />
              </div>
`;

if (!ui.includes('Google Flow Project ID')) {
    ui = ui.replace(
        /{\/\* Aspect ratio \*\/}/,
        uiInputReplacement + "\n              {/* Aspect ratio */}"
    );
}

// Add projectId passing into generateImage / generateVideo inputs
ui = ui.replace(
    /model: imageCfg\.model,\n\s*ratio: imageCfg\.ratio,\n\s*\};/,
    `model: imageCfg.model,
          ratio: imageCfg.ratio,
          projectId: imageCfg.projectId,
        };`
);

ui = ui.replace(
    /subtype: videoCfg\.subtype,\n\s*duration: videoCfg\.duration,\n\s*\};/,
    `subtype: videoCfg.subtype,
          duration: videoCfg.duration,
          projectId: videoCfg.projectId,
        };`
);

fs.writeFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio/src/components/studio/StudioFlowGen.tsx', ui);


console.log("Patched Service, Backend, and Frontend Component.");
