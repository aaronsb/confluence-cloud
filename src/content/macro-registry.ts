/**
 * Macro registry with typed parameter schemas.
 * See ADR-302: Confluence Macro Block Handling.
 */

// ── Types ──────────────────────────────────────────────────────

export type MacroCategory = 'formatting' | 'navigation' | 'integration' | 'content';
export type MacroParamType = 'string' | 'enum' | 'boolean' | 'number' | 'page-id' | 'space-key';

export interface MacroParamSchema {
  name: string;
  type: MacroParamType;
  required: boolean;
  values?: string[];
  default?: string;
  description?: string;
}

export interface MacroDefinition {
  key: string;
  name: string;
  category: MacroCategory;
  params: MacroParamSchema[];
  hasBody: boolean;
  bodyHint?: string;
  renderHint: string;
}

export interface MacroValidationError {
  param: string;
  message: string;
}

// ── Built-in Registry ──────────────────────────────────────────

const BUILTIN_MACROS: MacroDefinition[] = [
  {
    key: 'status',
    name: 'Status Badge',
    category: 'formatting',
    params: [
      { name: 'color', type: 'enum', required: true, values: ['green', 'yellow', 'red', 'blue', 'grey'] },
      { name: 'title', type: 'string', required: true },
    ],
    hasBody: false,
    renderHint: ':::status{color="<color>" title="<title>"}:::',
  },
  {
    key: 'info',
    name: 'Info Panel',
    category: 'formatting',
    params: [
      { name: 'title', type: 'string', required: false },
    ],
    hasBody: true,
    bodyHint: 'Rich text content',
    renderHint: ':::panel{type="info" title="<title>"}\n<content>\n:::',
  },
  {
    key: 'note',
    name: 'Note Panel',
    category: 'formatting',
    params: [
      { name: 'title', type: 'string', required: false },
    ],
    hasBody: true,
    bodyHint: 'Rich text content',
    renderHint: ':::panel{type="note" title="<title>"}\n<content>\n:::',
  },
  {
    key: 'warning',
    name: 'Warning Panel',
    category: 'formatting',
    params: [
      { name: 'title', type: 'string', required: false },
    ],
    hasBody: true,
    bodyHint: 'Rich text content',
    renderHint: ':::panel{type="warning" title="<title>"}\n<content>\n:::',
  },
  {
    key: 'error',
    name: 'Error Panel',
    category: 'formatting',
    params: [
      { name: 'title', type: 'string', required: false },
    ],
    hasBody: true,
    bodyHint: 'Rich text content',
    renderHint: ':::panel{type="error" title="<title>"}\n<content>\n:::',
  },
  {
    key: 'code',
    name: 'Code Block',
    category: 'formatting',
    params: [
      { name: 'language', type: 'string', required: false },
      { name: 'title', type: 'string', required: false },
      { name: 'collapse', type: 'boolean', required: false, default: 'false' },
    ],
    hasBody: true,
    bodyHint: 'Source code',
    renderHint: '```<language>\n<code>\n```',
  },
  {
    key: 'expand',
    name: 'Expand Block',
    category: 'content',
    params: [
      { name: 'title', type: 'string', required: true },
    ],
    hasBody: true,
    bodyHint: 'Collapsible content',
    renderHint: ':::expand{title="<title>"}\n<content>\n:::',
  },
  {
    key: 'toc',
    name: 'Table of Contents',
    category: 'navigation',
    params: [
      { name: 'maxLevel', type: 'number', required: false, default: '3' },
      { name: 'style', type: 'enum', required: false, values: ['default', 'flat', 'circle', 'square', 'disc'] },
      { name: 'type', type: 'enum', required: false, values: ['list', 'flat'] },
    ],
    hasBody: false,
    renderHint: ':::toc{maxLevel=<n>}:::',
  },
  {
    key: 'jira',
    name: 'Jira Issue',
    category: 'integration',
    params: [
      { name: 'key', type: 'string', required: true, description: 'Jira issue key (e.g., PROJ-123)' },
      { name: 'server', type: 'string', required: false },
    ],
    hasBody: false,
    renderHint: ':::jira{key="<key>"}:::',
  },
  {
    key: 'children',
    name: 'Children Display',
    category: 'navigation',
    params: [
      { name: 'sort', type: 'enum', required: false, values: ['creation', 'title', 'modified'] },
      { name: 'style', type: 'enum', required: false, values: ['h2', 'h3', 'h4', 'h5', 'h6'] },
      { name: 'depth', type: 'number', required: false },
    ],
    hasBody: false,
    renderHint: ':::children{depth=<n>}:::',
  },
  {
    key: 'excerpt',
    name: 'Excerpt',
    category: 'content',
    params: [
      { name: 'name', type: 'string', required: false },
      { name: 'hidden', type: 'boolean', required: false, default: 'false' },
    ],
    hasBody: true,
    bodyHint: 'Content to excerpt',
    renderHint: ':::excerpt{name="<name>"}\n<content>\n:::',
  },
];

// ── Registry Class ─────────────────────────────────────────────

export class MacroRegistry {
  private macros: Map<string, MacroDefinition>;

  constructor() {
    this.macros = new Map();
    for (const macro of BUILTIN_MACROS) {
      this.macros.set(macro.key, macro);
    }
  }

  get(key: string): MacroDefinition | undefined {
    return this.macros.get(key);
  }

  has(key: string): boolean {
    return this.macros.has(key);
  }

  register(definition: MacroDefinition): void {
    this.macros.set(definition.key, definition);
  }

  all(): MacroDefinition[] {
    return Array.from(this.macros.values());
  }

  byCategory(category: MacroCategory): MacroDefinition[] {
    return this.all().filter(m => m.category === category);
  }

  validate(key: string, params: Record<string, string>): MacroValidationError[] {
    const definition = this.macros.get(key);
    if (!definition) {
      return []; // Unknown macro — pass through, don't validate
    }

    const errors: MacroValidationError[] = [];

    for (const schema of definition.params) {
      const value = params[schema.name];

      if (schema.required && (value === undefined || value === '')) {
        errors.push({
          param: schema.name,
          message: `Required parameter '${schema.name}' is missing`,
        });
        continue;
      }

      if (value === undefined) continue;

      if (schema.type === 'enum' && schema.values && !schema.values.includes(value)) {
        errors.push({
          param: schema.name,
          message: `'${schema.name}' must be one of: ${schema.values.join(', ')}. Got '${value}'`,
        });
      }

      if (schema.type === 'number' && isNaN(Number(value))) {
        errors.push({
          param: schema.name,
          message: `'${schema.name}' must be a number. Got '${value}'`,
        });
      }

      if (schema.type === 'boolean' && !['true', 'false'].includes(value.toLowerCase())) {
        errors.push({
          param: schema.name,
          message: `'${schema.name}' must be true or false. Got '${value}'`,
        });
      }
    }

    return errors;
  }
}
