import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../server/routes/vocab.js';
import { VocabPrivateDeck, VocabPrivateFlashcard } from '../server/models/Vocab.js';

const userId = '507f1f77bcf86cd799439011';
const fields = { lapses: 2, stability: 3.2, difficulty: 5.1, fsrs_state: 0, fsrs_step: 1 };
const stored = { lapses: 2, stability: 3.2, difficulty: 5.1, fsrsState: 0, fsrsStep: 1 };
async function request(method, path, body) {
    const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
    let status = 200, response;
    const res = { status(code) { status = code; return this; }, json(value) { response = value; return this; } };
    await layer.route.stack.at(-1).handle({ user: { _id: userId }, params: { deckId: 'DECK', cardId: 'card' }, body }, res);
    return { status, body: response };
}

test('private card create, batch, PUT and read preserve FSRS fields without a database', async t => {
    let card;
    t.mock.method(VocabPrivateDeck, 'findOne', async () => ({ deckId: 'DECK' }));
    t.mock.method(VocabPrivateFlashcard, 'findOne', async () => card ?? null);
    t.mock.method(VocabPrivateFlashcard, 'create', async data => {
        card = new VocabPrivateFlashcard(data);
        await card.validate();
        return card;
    });
    t.mock.method(VocabPrivateFlashcard, 'bulkWrite', async ops => {
        Object.assign(card, ops[0].updateOne.update.$set);
        await card.validate();
    });
    t.mock.method(VocabPrivateFlashcard, 'find', () => {
        const cards = Promise.resolve([card]);
        cards.sort = async () => [card];
        return cards;
    });
    const payload = { id: 'card', front: 'one', back: 'mot', ...fields };
    const created = await request('post', '/my-decks/:deckId/cards', payload);
    assert.equal(created.status, 200);
    for (const [key, value] of Object.entries(fields)) assert.equal(created.body.data[key], value, key);
    for (const [key, value] of Object.entries(stored)) assert.equal(card.toObject()[key], value, key);
    const batch = await request('post', '/my-decks/:deckId/cards/batch', [payload]);
    for (const [key, value] of Object.entries(fields)) assert.equal(batch.body.data[0][key], value, key);
    card.save = async () => { await card.validate(); return card; };
    const updated = await request('put', '/my-decks/:deckId/cards/:cardId', { ...fields, fsrs_state: 2, fsrs_step: 0 });
    assert.equal(updated.body.data.fsrs_state, 2);
    assert.equal(updated.body.data.fsrs_step, 0);
    const legacyUpdate = await request('put', '/my-decks/:deckId/cards/:cardId', { front: 'two' });
    assert.equal(legacyUpdate.body.data.stability, fields.stability);
    const legacyBatch = await request('post', '/my-decks/:deckId/cards/batch', [{ id: 'card', front: 'two', back: 'hai' }]);
    // Existing fields must not be overwritten by old clients omitting FSRS data.
    assert.equal(legacyBatch.status, 200);
    assert.equal(legacyBatch.body.data[0].stability, fields.stability);
    const reloaded = await request('get', '/my-decks/:deckId/cards');
    assert.equal(reloaded.body.data[0].fsrs_state, 2);
    assert.equal(reloaded.body.data[0].fsrs_step, 0);
    const graduated = await request('put', '/my-decks/:deckId/cards/:cardId', { fsrs_state: 1, fsrs_step: null });
    assert.equal(graduated.body.data.fsrs_step, null);
    const cleared = await request('post', '/my-decks/:deckId/cards/batch', [
        { id: 'card', front: 'two', back: 'hai', stability: null, difficulty: null, fsrs_state: null, fsrs_step: null },
    ]);
    assert.equal(cleared.status, 200);
    for (const key of ['stability', 'difficulty', 'fsrs_state', 'fsrs_step']) {
        assert.equal(cleared.body.data[0][key], null, key);
    }
    assert.equal(cleared.body.data[0].lapses, fields.lapses);
});

test('invalid optional FSRS values are rejected before model mutations', async t => {
    t.mock.method(VocabPrivateDeck, 'findOne', async () => ({ deckId: 'DECK' }));
    t.mock.method(VocabPrivateFlashcard, 'findOne', async () => null);
    t.mock.method(VocabPrivateFlashcard, 'create', () => assert.fail('must not write'));
    t.mock.method(VocabPrivateFlashcard, 'bulkWrite', () => assert.fail('must not write'));
    for (const bad of [
        { fsrs_state: 3 }, { fsrs_state: 0.5 }, { fsrs_step: -1 }, { fsrs_step: 0.5 },
        { lapses: 0.5 }, { lapses: null }, { difficulty: 0 }, { difficulty: 11 },
        { stability: 'bad' }, { stability: Infinity }, { stability: NaN }, { stability: false },
    ]) {
        assert.equal((await request('post', '/my-decks/:deckId/cards', { front: 'one', back: 'mot', ...bad })).status, 400);
        assert.equal((await request('post', '/my-decks/:deckId/cards/batch', [{ front: 'one', back: 'mot', ...bad }])).status, 400);
    }
    t.mock.method(VocabPrivateFlashcard, 'findOne', async () => ({ save() { assert.fail('must not write'); } }));
    assert.equal((await request('put', '/my-decks/:deckId/cards/:cardId', { fsrs_step: -1 })).status, 400);
});

test('legacy documents keep nullable FSRS state and zero lapses', () => {
    const legacy = new VocabPrivateFlashcard({ cardId: 'old', deckId: 'DECK', userId, front: 'one', back: 'mot' });
    assert.equal(legacy.lapses, 0);
    assert.equal(legacy.fsrsState, null);
    assert.equal(legacy.fsrsStep, null);
    assert.equal(legacy.stability, null);
});
