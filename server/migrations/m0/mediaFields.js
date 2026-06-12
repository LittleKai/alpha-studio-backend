export const MEDIA_FIELD_REGISTRY = Object.freeze([
    { collection: 'users', field: 'avatar', filenameHint: 'avatar' },
    { collection: 'users', field: 'backgroundImage', filenameHint: 'background' },
    { collection: 'users', field: 'featuredWorks.*.image', filenameHint: 'featured-work' },
    { collection: 'users', field: 'attachments.*.url', filenameHint: 'attachment' },
    { collection: 'courses', field: 'thumbnail', filenameHint: 'thumbnail' },
    { collection: 'courses', field: 'instructor.avatar', filenameHint: 'instructor-avatar' },
    { collection: 'courses', field: 'modules.*.lessons.*.videoUrl', filenameHint: 'lesson-video' },
    { collection: 'courses', field: 'modules.*.lessons.*.documents.*.url', filenameHint: 'lesson-document' },
    { collection: 'prompts', field: 'exampleImages.*.url', filenameHint: 'prompt-example' },
    { collection: 'resources', field: 'file.url', filenameHint: 'resource-file' },
    { collection: 'resources', field: 'thumbnail.url', filenameHint: 'resource-thumbnail' },
    { collection: 'resources', field: 'previewImages.*.url', filenameHint: 'resource-preview' },
    { collection: 'workflowprojects', field: 'avatar', filenameHint: 'workflow-avatar' },
    { collection: 'workflowprojects', field: 'team.*.avatar', filenameHint: 'workflow-team-avatar' },
    { collection: 'workflowdocuments', field: 'url', filenameHint: 'workflow-document' },
    { collection: 'interiorprojects', field: 'versions.*.refImageUrls.*', filenameHint: 'interior-reference' },
    { collection: 'interior_analysis', field: 'imageUrl', filenameHint: 'interior-analysis' },
    { collection: 'interior_renders', field: 'viewUrl', filenameHint: 'interior-view' },
    { collection: 'interior_renders', field: 'renderUrl', filenameHint: 'interior-render' },
    { collection: 'studiogenerations', field: 'items.*.b2Url', filenameHint: 'studio-generation' },
    { collection: 'vocabpublicdecks', field: 'imageUrl', filenameHint: 'vocab-deck' },
    { collection: 'vocabprofiles', field: 'avatarUrl', filenameHint: 'vocab-avatar' },
    { collection: 'vocabprivatedecks', field: 'imagePath', filenameHint: 'vocab-deck' },
    { collection: 'vocabprivateflashcards', field: 'imageUrl', filenameHint: 'vocab-card' },
    { collection: 'vocabprivateflashcards', field: 'frontImageUrl', filenameHint: 'vocab-card-front' },
    { collection: 'vocabprivateflashcards', field: 'backImageUrl', filenameHint: 'vocab-card-back' },
    { collection: 'vocabpublicflashcards', field: 'frontImageUrl', filenameHint: 'vocab-card-front' },
    { collection: 'vocabpublicflashcards', field: 'backImageUrl', filenameHint: 'vocab-card-back' },
    { collection: 'crmmessages', field: 'attachments.**', filenameHint: 'crm-attachment' }
]);

export function mediaFieldsForCollection(collection, registry = MEDIA_FIELD_REGISTRY) {
    return registry.filter((entry) => entry.collection === collection);
}

export function collectionsWithMediaFields(registry = MEDIA_FIELD_REGISTRY) {
    return [...new Set(registry.map((entry) => entry.collection))];
}
