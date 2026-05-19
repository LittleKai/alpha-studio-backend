import { ok } from './common.js';

export default function skillListFactory(skillLoader) {
    return {
        name: 'skill.list',
        description: 'List available domain recipe skills.',
        validateArgs: () => ok(),
        handler: async () => ({ ok: true, data: { skills: skillLoader.list() } })
    };
}
