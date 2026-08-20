import test from 'node:test';
import assert from 'node:assert/strict';

test('landingVideoQuality setting options and defaults', () => {
    const LANDING_VIDEO_QUALITIES = ['high', 'standard'];
    const LANDING_VIDEO_DEFAULT_QUALITY = 'high';

    assert.equal(LANDING_VIDEO_QUALITIES.includes('high'), true);
    assert.equal(LANDING_VIDEO_QUALITIES.includes('standard'), true);
    assert.equal(LANDING_VIDEO_QUALITIES.includes('invalid'), false);
    assert.equal(LANDING_VIDEO_DEFAULT_QUALITY, 'high');
});
