export class ToolRegistry {
    constructor() {
        this.tools = new Map();
    }

    register(tool) {
        if (!tool || typeof tool !== 'object') throw new Error('Tool descriptor is required.');
        if (typeof tool.name !== 'string' || !tool.name.trim()) throw new Error('Tool name is required.');
        if (typeof tool.description !== 'string' || !tool.description.trim()) throw new Error(`Tool ${tool.name} description is required.`);
        if (typeof tool.validateArgs !== 'function') throw new Error(`Tool ${tool.name} validateArgs is required.`);
        if (typeof tool.handler !== 'function') throw new Error(`Tool ${tool.name} handler is required.`);
        this.tools.set(tool.name, { ...tool, terminal: tool.terminal === true });
        return this;
    }

    get(name) {
        return this.tools.get(name) || null;
    }

    list() {
        return [...this.tools.values()].map((tool) => ({
            name: tool.name,
            description: tool.description,
            terminal: tool.terminal === true
        }));
    }

    summary() {
        return this.list().map(({ name, description }) => ({ name, description }));
    }
}
