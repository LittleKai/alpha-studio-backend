const fs = require('fs');
let code = fs.readFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio/src/components/studio/StudioFlowGen.tsx', 'utf8');

const triggerBlobOld = `  const triggerBlobDownload = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(\`Download failed (\${res.status})\`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = \`alpha-studio-\${item.index}-\${Date.now()}.\${item.ext || (isVideo ? 'mp4' : 'png')}\`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  };`;

const triggerBlobNew = `  const triggerBlobDownload = async (url: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(\`Download failed (\${res.status})\`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = \`alpha-studio-\${item.index}-\${Date.now()}.\${item.ext || (isVideo ? 'mp4' : 'png')}\`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.warn('CORS or fetch error, falling back to direct navigation:', err);
      // Fallback if fetch is blocked by CORS: Open in new tab or download directly
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.download = \`alpha-studio-\${item.index}-\${Date.now()}.\${item.ext || (isVideo ? 'mp4' : 'png')}\`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };`;

code = code.replace(triggerBlobOld, triggerBlobNew);
fs.writeFileSync('D:/Dev/NodeJS/alpha-studio/alpha-studio/src/components/studio/StudioFlowGen.tsx', code);
console.log('Fixed StudioFlowGen.tsx');
