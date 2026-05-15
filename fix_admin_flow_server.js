const fs = require('fs');

// 1. Revert StudioFlowGen.tsx
let ui = fs.readFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio/src/components/studio/StudioFlowGen.tsx', 'utf8');
ui = ui.replace(`  projectId?: string;
}`, `}`);
ui = ui.replace(`  projectId?: string;
}`, `}`);
ui = ui.replace(/              \{\/\* Project ID Input \*\/\}.*?\{\/\* Aspect ratio \*\/\}/s, '              {/* Aspect ratio */}');
ui = ui.replace(/projectId: imageCfg\.projectId,/, '');
ui = ui.replace(/projectId: videoCfg\.projectId,/, '');
fs.writeFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio/src/components/studio/StudioFlowGen.tsx', ui);

// 2. Revert studioService.ts
let ss = fs.readFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio/src/services/studioService.ts', 'utf8');
ss = ss.replace(/    projectId\?\: string;\n\}/g, '}');
fs.writeFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio/src/services/studioService.ts', ss);

// 3. Revert studio.js
let be = fs.readFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio-backend/server/routes/studio.js', 'utf8');
be = be.replace('referenceImageUrls, projectId', 'referenceImageUrls');
be = be.replace('count = 1, projectId,', 'count = 1,');
be = be.replace(/\.\.\.\(projectId \? \{ projectId \} \: \(pickProjectIdFallback\(server\) \? \{ projectId: pickProjectIdFallback\(server\) \} \: \{\}\)\),/g,
    `...(pickProjectIdFallback(server) ? { projectId: pickProjectIdFallback(server) } : {}),`);
fs.writeFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio-backend/server/routes/studio.js', be);

console.log("Reverted UI and payload patches.");
