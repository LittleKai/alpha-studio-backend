import modelPreview from './model-preview.js';
import modelSetPalette from './model-set-palette.js';
import modelSetDimensions from './model-set-dimensions.js';
import templateList from './template-list.js';
import templateSuggest from './template-suggest.js';
import templateCreate from './template-create.js';
import runAdd from './run-add.js';
import runUpdate from './run-update.js';
import moduleAdd from './module-add.js';
import moduleUpdate from './module-update.js';
import moduleRemove from './module-remove.js';
import skillListFactory from './skill-list.js';
import skillReadFactory from './skill-read.js';
import modelCommit from './model-commit.js';
import modelAbort from './model-abort.js';

export function registerInteriorTools(registry, skillLoader) {
    [
        modelPreview,
        modelSetPalette,
        modelSetDimensions,
        templateList,
        templateSuggest,
        templateCreate,
        runAdd,
        runUpdate,
        moduleAdd,
        moduleUpdate,
        moduleRemove,
        skillListFactory(skillLoader),
        skillReadFactory(skillLoader),
        modelCommit,
        modelAbort
    ].forEach((tool) => registry.register(tool));
    return registry;
}
