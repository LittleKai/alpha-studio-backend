import express from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import {
    generatePresignedUploadUrl, generatePresignedDownloadUrl, deleteFile,
    initMultipartUpload, generatePresignedPartUrl, finishMultipartUpload,
} from '../utils/b2Storage.js';

const router = express.Router();

// Normalise content type: fall back to octet-stream for empty or unknown types
function normaliseContentType(contentType) {
    return (contentType && contentType.trim()) ? contentType.trim() : 'application/octet-stream';
}

function sanitizeFilename(filename) {
    return filename
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .replace(/-+/g, '-')
        .toLowerCase();
}

/**
 * Extract the B2 object key from either:
 *  - Custom CDN URL:  https://cdn.example.com/file/bucket/key
 *  - Direct B2 URL:   https://f004.backblazeb2.com/file/bucket/key
 * Returns null if the URL is not a recognised B2 URL.
 */
function extractB2Key(url) {
    const bucket = process.env.B2_BUCKET_NAME;

    // 1. Try CDN_BASE_URL prefix first
    const cdnBase = process.env.CDN_BASE_URL; // e.g. https://cdn.../file/bucket
    if (cdnBase && url.startsWith(cdnBase)) {
        return url.slice(cdnBase.endsWith('/') ? cdnBase.length : cdnBase.length + 1);
    }

    // 2. Fallback: direct backblazeb2.com URL  (f001–f005 regions)
    const b2Pattern = `.backblazeb2.com/file/${bucket}/`;
    const idx = url.indexOf(b2Pattern);
    if (idx !== -1) {
        return url.slice(idx + b2Pattern.length);
    }

    return null;
}

// POST /api/upload/presign - Generate presigned upload URL
router.post('/presign', authMiddleware, async (req, res) => {
    try {
        const { filename, contentType, folder } = req.body;

        if (!filename || !folder) {
            return res.status(400).json({
                success: false,
                message: 'filename và folder là bắt buộc'
            });
        }

        const resolvedType = normaliseContentType(contentType);
        const sanitized = sanitizeFilename(filename);
        const key = `${folder}/${Date.now()}-${sanitized}`;

        const { presignedUrl, publicUrl } = await generatePresignedUploadUrl(key, resolvedType);

        res.json({
            success: true,
            data: {
                presignedUrl,
                publicUrl,
                fileKey: key
            }
        });
    } catch (error) {
        console.error('Presign error:', error);
        res.status(500).json({
            success: false,
            message: process.env.NODE_ENV !== 'production'
                ? `Presign failed: ${error.message}`
                : 'Không thể tạo URL upload'
        });
    }
});

// POST /api/upload/signed-url - Generate presigned GET URL for video streaming / file download
router.post('/signed-url', authMiddleware, async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, message: 'url là bắt buộc' });
        }

        const key = extractB2Key(url);
        if (!key) {
            return res.status(400).json({ success: false, message: 'URL không hợp lệ' });
        }

        const signedUrl = await generatePresignedDownloadUrl(key);

        res.json({ success: true, data: { signedUrl } });
    } catch (error) {
        console.error('Signed URL error:', error);
        res.status(500).json({
            success: false,
            message: process.env.NODE_ENV !== 'production'
                ? `Signed URL failed: ${error.message}`
                : 'Không thể tạo URL tải xuống'
        });
    }
});

// DELETE /api/upload/file - Delete a file from B2 (admin only)
router.delete('/file', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { fileKey } = req.body;

        if (!fileKey) {
            return res.status(400).json({
                success: false,
                message: 'fileKey là bắt buộc'
            });
        }

        await deleteFile(fileKey);

        res.json({
            success: true,
            message: 'File đã được xóa'
        });
    } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({
            success: false,
            message: 'Không thể xóa file'
        });
    }
});

// POST /api/upload/multipart-init — start a multipart upload, get per-part presigned PUT URLs
router.post('/multipart-init', authMiddleware, async (req, res) => {
    try {
        const { filename, contentType, folder, numParts } = req.body;
        if (!filename || !folder || !numParts) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin bắt buộc' });
        }
        if (numParts < 1 || numParts > 10000) {
            return res.status(400).json({ success: false, message: 'Số lượng phần không hợp lệ' });
        }

        const resolvedType = normaliseContentType(contentType);
        const sanitized = sanitizeFilename(filename);
        const key = `${folder}/${Date.now()}-${sanitized}`;

        const uploadId = await initMultipartUpload(key, resolvedType);

        // Generate one presigned URL per part (1-hour expiry each)
        const partUrls = await Promise.all(
            Array.from({ length: numParts }, (_, i) =>
                generatePresignedPartUrl(key, uploadId, i + 1, 3600)
            )
        );

        res.json({
            success: true,
            data: { uploadId, key, partUrls, publicUrl: `${process.env.CDN_BASE_URL}/${key}` },
        });
    } catch (error) {
        console.error('Multipart init error:', error);
        res.status(500).json({ success: false, message: 'Không thể khởi tạo upload' });
    }
});

// POST /api/upload/multipart-complete — assemble parts and finalise the upload
router.post('/multipart-complete', authMiddleware, async (req, res) => {
    try {
        const { key, uploadId, parts } = req.body;
        if (!key || !uploadId || !Array.isArray(parts) || parts.length === 0) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin bắt buộc' });
        }

        await finishMultipartUpload(key, uploadId, parts);

        res.json({
            success: true,
            data: { publicUrl: `${process.env.CDN_BASE_URL}/${key}` },
        });
    } catch (error) {
        console.error('Multipart complete error:', error);
        res.status(500).json({ success: false, message: 'Không thể hoàn thành upload' });
    }
});

export default router;
