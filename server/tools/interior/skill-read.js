import { invalid, ok } from './common.js';

export default function skillReadFactory(skillLoader) {
    return {
        name: 'skill.read',
        description: 'Read one domain recipe skill by name.',
        validateArgs: (args) => (typeof args.name === 'string' ? ok() : invalid('name is required.')),
        handler: async (args) => {
            const skill = skillLoader.read(args.name);
            if (!skill) return { ok: false, error: `Skill ${args.name} not found.` };
            return { ok: true, data: skill };
        }
    };
}
