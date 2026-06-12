import test from 'node:test';
import assert from 'node:assert/strict';
import {
    InlineMediaError,
    assertNoInlineMedia
} from '../server/validation/inlineMedia.js';

test('accepts URLs, object keys, and ordinary long text', () => {
    assert.doesNotThrow(() => assertNoInlineMedia({
        avatar: 'https://cdn.example/avatar.png',
        fileKey: 'resources/file.zip',
        content: 'A'.repeat(100_000)
    }));
});

test('rejects nested data URLs', () => {
    assert.throws(
        () => assertNoInlineMedia({
            attachments: [{ url: 'data:image/png;base64,AAAA' }]
        }),
        (error) => error instanceof InlineMediaError
            && error.path === 'attachments.0.url'
    );
});

test('rejects buffers and BSON-like binary values', () => {
    assert.throws(
        () => assertNoInlineMedia({ image: Buffer.from('x') }),
        InlineMediaError
    );
    assert.throws(
        () => assertNoInlineMedia({
            audio: { _bsontype: 'Binary', buffer: Buffer.from('x') }
        }),
        InlineMediaError
    );
});

test('rejects large base64-looking strings only on media paths', () => {
    const encoded = Buffer.alloc(20_000, 1).toString('base64');
    assert.throws(
        () => assertNoInlineMedia({ imageData: encoded }),
        InlineMediaError
    );
    assert.doesNotThrow(() => assertNoInlineMedia({ articleContent: encoded }));
});

test('handles cyclic objects without infinite recursion', () => {
    const value = { avatar: 'https://cdn.example/avatar.png' };
    value.self = value;
    assert.doesNotThrow(() => assertNoInlineMedia(value));
});
