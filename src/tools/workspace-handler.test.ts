import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleWorkspaceRequest } from './workspace-handler.js';

describe('handleWorkspaceRequest', () => {
  let tmpDir: string;
  const originalWD = process.env.WORKSPACE_DIR;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-test-'));
    process.env.WORKSPACE_DIR = tmpDir;
  });

  afterEach(async () => {
    if (originalWD !== undefined) process.env.WORKSPACE_DIR = originalWD;
    else delete process.env.WORKSPACE_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── List ──────────────────────────────────────────────

  it('should list empty workspace', async () => {
    const result = await handleWorkspaceRequest({ operation: 'list' });
    expect(result.content[0].text).toContain('empty');
  });

  it('should list files with sizes', async () => {
    await fs.writeFile(path.join(tmpDir, 'photo.png'), Buffer.alloc(1024));
    await fs.writeFile(path.join(tmpDir, 'notes.txt'), 'hello');

    const result = await handleWorkspaceRequest({ operation: 'list' });
    expect(result.content[0].text).toContain('photo.png');
    expect(result.content[0].text).toContain('notes.txt');
    expect(result.content[0].text).toContain('1.0KB');
  });

  // ── Write ─────────────────────────────────────────────

  it('should write base64 content to workspace', async () => {
    const content = Buffer.from('hello workspace').toString('base64');
    const result = await handleWorkspaceRequest({ operation: 'write', filename: 'test.txt', content });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Written');

    const written = await fs.readFile(path.join(tmpDir, 'test.txt'), 'utf-8');
    expect(written).toBe('hello workspace');
  });

  it('should require filename for write', async () => {
    const result = await handleWorkspaceRequest({ operation: 'write', content: 'abc' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('filename is required');
  });

  it('should require content for write', async () => {
    const result = await handleWorkspaceRequest({ operation: 'write', filename: 'test.txt' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('content');
  });

  // ── Read ──────────────────────────────────────────────

  it('should read text file inline', async () => {
    await fs.writeFile(path.join(tmpDir, 'readme.txt'), 'file content here');

    const result = await handleWorkspaceRequest({ operation: 'read', filename: 'readme.txt' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('file content here');
  });

  it('should return path reference for binary files', async () => {
    await fs.writeFile(path.join(tmpDir, 'image.png'), Buffer.alloc(256));

    const result = await handleWorkspaceRequest({ operation: 'read', filename: 'image.png' });
    expect(result.content[0].text).toContain('binary');
    expect(result.content[0].text).toContain(tmpDir);
  });

  it('should return error for missing file', async () => {
    const result = await handleWorkspaceRequest({ operation: 'read', filename: 'nope.txt' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('should require filename for read', async () => {
    const result = await handleWorkspaceRequest({ operation: 'read' });
    expect(result.isError).toBe(true);
  });

  // ── Delete ────────────────────────────────────────────

  it('should delete a file from workspace', async () => {
    await fs.writeFile(path.join(tmpDir, 'temp.txt'), 'data');

    const result = await handleWorkspaceRequest({ operation: 'delete', filename: 'temp.txt' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Deleted');

    await expect(fs.access(path.join(tmpDir, 'temp.txt'))).rejects.toThrow();
  });

  it('should return error for deleting missing file', async () => {
    const result = await handleWorkspaceRequest({ operation: 'delete', filename: 'ghost.txt' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('should require filename for delete', async () => {
    const result = await handleWorkspaceRequest({ operation: 'delete' });
    expect(result.isError).toBe(true);
  });

  // ── Unknown operation ─────────────────────────────────

  it('should reject unknown operations', async () => {
    const result = await handleWorkspaceRequest({ operation: 'explode' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown');
  });
});
