const fs = require('fs');

// 1. studioService.ts
let ss = fs.readFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio/src/services/studioService.ts', 'utf8');
ss = ss.replace(
    /referenceImageUrls\?\: string\[\];.*?\/\/[^\n]*\n}/s,
    `referenceImageUrls?: string[];    // multi-image (preferred), max 2
    projectId?: string;
}`
);
ss = ss.replace(
    /duration\?\: VideoDuration;\n}$/m,
    `duration?: VideoDuration;
    projectId?: string;
}`
);
fs.writeFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio/src/services/studioService.ts', ss);

// 2. backend studio.js (Image)
let be = fs.readFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio-backend/server/routes/studio.js', 'utf8');
be = be.replace(
    /const { prompt, model, ratio, count = 1, seed, referenceImage, referenceImageUrl, referenceImageUrls } = req\.body;/,
    "const { prompt, model, ratio, count = 1, seed, referenceImage, referenceImageUrl, referenceImageUrls, projectId } = req.body;"
);
// In image generator
be = be.replace(
    /\.\.\.\(pickProjectIdFallback\(server\) \? \{ projectId\: pickProjectIdFallback\(server\) \} \: \{\}\),/,
    `...(projectId ? { projectId } : (pickProjectIdFallback(server) ? { projectId: pickProjectIdFallback(server) } : {})),`
);

// backend studio.js (Video)
be = be.replace(
    /subtype, duration, count = 1,\n    } = req\.body;/,
    `subtype, duration, count = 1, projectId,\n    } = req.body;`
);
be = be.replace(
    /\.\.\.\(pickProjectIdFallback\(server\) \? \{ projectId\: pickProjectIdFallback\(server\) \} \: \{\}\),\n        \};/g,
    `...(projectId ? { projectId } : (pickProjectIdFallback(server) ? { projectId: pickProjectIdFallback(server) } : {})),
        };`
);
fs.writeFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio-backend/server/routes/studio.js', be);

console.log('Patched backend and service.');
