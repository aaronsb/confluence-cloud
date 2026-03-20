import { describe, it, expect, beforeEach } from 'vitest';
import type { ConfluenceClient } from '../client/confluence-client.js';
import type { Page } from '../types/index.js';
import { ScratchpadManager } from '../sessions/scratchpad.js';
import { handleEditRequest } from './edit-handler.js';

// ── Fake Client ───────────────────────────────────────────

function fakePage(overrides?: Partial<Page>): Page {
  return {
    id: '12345',
    title: 'Test Page',
    spaceId: 'SPACE1',
    status: 'current',
    version: { number: 2, createdAt: '', authorId: '' },
    createdAt: '',
    authorId: '',
    ...overrides,
  };
}

function fakeClient(overrides?: Partial<ConfluenceClient>): ConfluenceClient {
  return {
    getPage: async () => fakePage(),
    createPage: async () => fakePage({ id: '99999', version: { number: 1, createdAt: '', authorId: '' } }),
    updatePage: async () => fakePage({ version: { number: 3, createdAt: '', authorId: '' } }),
    deletePage: async () => {},
    getChildren: async () => ({ results: [] }),
    getAncestors: async () => [],
    getSpace: async () => ({ id: 'S1', key: 'KEY', name: 'Space', type: 'global', status: 'current' }),
    listSpaces: async () => ({ results: [] }),
    searchByCql: async () => ({ results: [], totalSize: 0 }),
    getAttachments: async () => ({ results: [] }),
    getAttachmentInfo: async () => ({ id: '', title: '', mediaType: '', fileSize: 0, downloadUrl: '', pageId: '', version: 0, createdAt: '' }),
    downloadAttachment: async () => Buffer.from(''),
    uploadAttachment: async () => ({ id: '', title: '', mediaType: '', fileSize: 0, downloadUrl: '', pageId: '', version: 0, createdAt: '' }),
    deleteAttachment: async () => {},
    getLabels: async () => [],
    addLabel: async () => {},
    addLabels: async () => {},
    removeLabel: async () => {},
    getProperties: async () => [],
    getProperty: async () => ({ key: '', value: {}, version: { number: 1 } }),
    setProperty: async () => ({ key: '', value: {}, version: { number: 1 } }),
    deleteProperty: async () => {},
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────

describe('handleEditRequest', () => {
  let scratchpads: ScratchpadManager;
  let client: ConfluenceClient;

  beforeEach(() => {
    scratchpads = new ScratchpadManager();
    client = fakeClient();
  });

  // ── Basic operations ──────────────────────────────────

  it('should return error for missing scratchpadId', async () => {
    const result = await handleEditRequest(client, scratchpads, { operation: 'view' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('scratchpadId is required');
  });

  it('should return error for expired scratchpad', async () => {
    const result = await handleEditRequest(client, scratchpads, { operation: 'view', scratchpadId: 'sp-nonexistent' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found or expired');
  });

  it('should list active scratchpads', async () => {
    scratchpads.createEmpty({ type: 'new_page', spaceId: 'S1', title: 'Page A' });
    const result = await handleEditRequest(client, scratchpads, { operation: 'list' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Page A');
  });

  it('should list empty when no scratchpads', async () => {
    const result = await handleEditRequest(client, scratchpads, { operation: 'list' });
    expect(result.content[0].text).toContain('No active scratchpads');
  });

  it('should view scratchpad content', async () => {
    const id = scratchpads.createFromLines(
      { type: 'new_page', spaceId: 'S1', title: 'Test' },
      ['# Hello', '', 'World'],
    );
    const result = await handleEditRequest(client, scratchpads, { operation: 'view', scratchpadId: id });
    expect(result.content[0].text).toContain('# Hello');
    expect(result.content[0].text).toContain('Status: valid');
  });

  it('should discard a scratchpad', async () => {
    const id = scratchpads.createEmpty({ type: 'new_page', spaceId: 'S1', title: 'Test' });
    const result = await handleEditRequest(client, scratchpads, { operation: 'discard', scratchpadId: id });
    expect(result.content[0].text).toContain('discarded');
    expect(scratchpads.get(id)).toBeNull();
  });

  // ── Line operations ───────────────────────────────────

  it('should require afterLine for insert_lines', async () => {
    const id = scratchpads.createEmpty({ type: 'new_page', spaceId: 'S1', title: 'T' });
    const result = await handleEditRequest(client, scratchpads, { operation: 'insert_lines', scratchpadId: id, content: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('afterLine is required');
  });

  it('should require content for append_lines', async () => {
    const id = scratchpads.createEmpty({ type: 'new_page', spaceId: 'S1', title: 'T' });
    const result = await handleEditRequest(client, scratchpads, { operation: 'append_lines', scratchpadId: id });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('content is required');
  });

  it('should require startLine and endLine for replace_lines', async () => {
    const id = scratchpads.createFromLines({ type: 'new_page', spaceId: 'S1', title: 'T' }, ['a']);
    const result = await handleEditRequest(client, scratchpads, { operation: 'replace_lines', scratchpadId: id, content: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('startLine and endLine are required');
  });

  it('should require startLine for remove_lines', async () => {
    const id = scratchpads.createFromLines({ type: 'new_page', spaceId: 'S1', title: 'T' }, ['a']);
    const result = await handleEditRequest(client, scratchpads, { operation: 'remove_lines', scratchpadId: id });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('startLine is required');
  });

  // ── Submit: new page ──────────────────────────────────

  it('should submit new page successfully', async () => {
    const id = scratchpads.createFromLines(
      { type: 'new_page', spaceId: 'S1', title: 'New Page' },
      ['# New Page', '', 'Content here.'],
    );

    const result = await handleEditRequest(client, scratchpads, {
      operation: 'submit',
      scratchpadId: id,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Page created successfully');
    expect(result.content[0].text).toContain('99999');
    // Scratchpad should be invalidated
    expect(scratchpads.get(id)).toBeNull();
  });

  // ── Submit: existing page ─────────────────────────────

  it('should submit existing page update successfully', async () => {
    const id = scratchpads.createFromLines(
      { type: 'existing_page', pageId: '12345', version: 2, title: 'Existing' },
      ['# Updated', '', 'New content.'],
    );

    const result = await handleEditRequest(client, scratchpads, {
      operation: 'submit',
      scratchpadId: id,
      message: 'Updated via test',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Page updated successfully');
    expect(result.content[0].text).toContain('Version: 3');
    expect(scratchpads.get(id)).toBeNull();
  });

  // ── Submit: empty buffer ──────────────────────────────

  it('should reject submit of empty scratchpad', async () => {
    const id = scratchpads.createEmpty({ type: 'new_page', spaceId: 'S1', title: 'Empty' });

    const result = await handleEditRequest(client, scratchpads, {
      operation: 'submit',
      scratchpadId: id,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cannot submit empty scratchpad');
    // Scratchpad should persist
    expect(scratchpads.get(id)).not.toBeNull();
  });

  // ── Submit: version conflict ──────────────────────────

  it('should handle 409 version conflict and preserve scratchpad', async () => {
    const conflictClient = fakeClient({
      updatePage: async () => { throw new Error('409 Conflict: version mismatch'); },
    });

    const id = scratchpads.createFromLines(
      { type: 'existing_page', pageId: '12345', version: 2, title: 'Stale' },
      ['# Content'],
    );

    const result = await handleEditRequest(conflictClient, scratchpads, {
      operation: 'submit',
      scratchpadId: id,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Version conflict');
    expect(result.content[0].text).toContain('still active');
    // Scratchpad should persist
    expect(scratchpads.get(id)).not.toBeNull();
  });

  it('should not false-positive on errors containing "version" as a substring', async () => {
    const genericClient = fakeClient({
      updatePage: async () => { throw new Error('Failed to parse version header in response'); },
    });

    const id = scratchpads.createFromLines(
      { type: 'existing_page', pageId: '12345', version: 2, title: 'Test' },
      ['# Content'],
    );

    const result = await handleEditRequest(genericClient, scratchpads, {
      operation: 'submit',
      scratchpadId: id,
    });

    expect(result.isError).toBe(true);
    // Should NOT match as version conflict — it's a generic error
    expect(result.content[0].text).not.toContain('Version conflict');
    expect(result.content[0].text).toContain('Failed to parse version header');
  });

  // ── Submit: generic API error ─────────────────────────

  it('should handle generic API errors and preserve scratchpad', async () => {
    const errorClient = fakeClient({
      createPage: async () => { throw new Error('Permission denied: user lacks write access'); },
    });

    const id = scratchpads.createFromLines(
      { type: 'new_page', spaceId: 'S1', title: 'Forbidden' },
      ['# Page'],
    );

    const result = await handleEditRequest(errorClient, scratchpads, {
      operation: 'submit',
      scratchpadId: id,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Permission denied');
    expect(result.content[0].text).toContain('still active');
    expect(scratchpads.get(id)).not.toBeNull();
  });

  // ── Submit: RawAdfBlock resolution ────────────────────

  it('should resolve raw_adf placeholders from side-table on submit', async () => {
    let capturedBody: object | undefined;
    const capturingClient = fakeClient({
      createPage: async (_spaceId, _title, body) => {
        capturedBody = body;
        return fakePage({ id: '77777', version: { number: 1, createdAt: '', authorId: '' } });
      },
    });

    const sideTable = new Map<string, object>([
      ['abc123def45678', { type: 'customWidget', attrs: { x: 1 } }],
    ]);

    const id = scratchpads.createFromLines(
      { type: 'new_page', spaceId: 'S1', title: 'With Raw ADF' },
      ['# Page', '', ':::raw_adf{hash="abc123def45678"}:::'],
      sideTable,
    );

    await handleEditRequest(capturingClient, scratchpads, {
      operation: 'submit',
      scratchpadId: id,
    });

    // The serialized ADF should contain the resolved raw node
    expect(capturedBody).toBeDefined();
    const doc = capturedBody as { content: Array<{ type: string; attrs?: object }> };
    const rawNode = doc.content.find(n => n.type === 'customWidget');
    expect(rawNode).toEqual({ type: 'customWidget', attrs: { x: 1 } });
  });

  it('should handle raw_adf with missing hash gracefully', async () => {
    let capturedBody: object | undefined;
    const capturingClient = fakeClient({
      createPage: async (_spaceId, _title, body) => {
        capturedBody = body;
        return fakePage({ id: '88888', version: { number: 1, createdAt: '', authorId: '' } });
      },
    });

    // Side-table has no entry for the hash — the raw_adf block will have empty adf
    const id = scratchpads.createFromLines(
      { type: 'new_page', spaceId: 'S1', title: 'Missing Hash' },
      ['# Page', '', ':::raw_adf{hash="nonexistent0000"}:::'],
    );

    const result = await handleEditRequest(capturingClient, scratchpads, {
      operation: 'submit',
      scratchpadId: id,
    });

    // Should still succeed — unresolved raw_adf serializes as empty object
    expect(result.isError).toBeUndefined();
    expect(capturedBody).toBeDefined();
  });
});
