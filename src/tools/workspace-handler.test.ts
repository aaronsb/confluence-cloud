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

  it('should list nested directories', async () => {
    await fs.mkdir(path.join(tmpDir, 'projects', 'images'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'projects', 'images', 'logo.png'), Buffer.alloc(512));
    await fs.writeFile(path.join(tmpDir, 'projects', 'readme.md'), 'hello');

    const result = await handleWorkspaceRequest({ operation: 'list' });
    const text = result.content[0].text;
    expect(text).toContain('projects/');
    expect(text).toContain('images/');
    expect(text).toContain('logo.png');
    expect(text).toContain('readme.md');
  });

  // ── Write ─────────────────────────────────────────────

  it('should write base64 content to workspace', async () => {
    const content = Buffer.from('hello workspace').toString('base64');
    const result = await handleWorkspaceRequest({ operation: 'write', filename: 'test.txt', content });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Written');
    expect(result.content[0].text).toContain('Path:');

    const written = await fs.readFile(path.join(tmpDir, 'test.txt'), 'utf-8');
    expect(written).toBe('hello workspace');
  });

  it('should write to nested paths and create parent dirs', async () => {
    const content = Buffer.from('nested content').toString('base64');
    const result = await handleWorkspaceRequest({
      operation: 'write',
      filename: 'projects/docs/readme.md',
      content,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('projects/docs/readme.md');
    expect(result.content[0].text).toContain('Path:');

    const written = await fs.readFile(path.join(tmpDir, 'projects', 'docs', 'readme.md'), 'utf-8');
    expect(written).toBe('nested content');
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

  it('should read text file inline with absolute path', async () => {
    await fs.writeFile(path.join(tmpDir, 'readme.txt'), 'file content here');

    const result = await handleWorkspaceRequest({ operation: 'read', filename: 'readme.txt' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('file content here');
    expect(result.content[0].text).toContain('Path:');
    expect(result.content[0].text).toContain(tmpDir);
  });

  it('should read nested files', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'docs', 'notes.txt'), 'nested notes');

    const result = await handleWorkspaceRequest({ operation: 'read', filename: 'docs/notes.txt' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('nested notes');
    expect(result.content[0].text).toContain(path.join(tmpDir, 'docs', 'notes.txt'));
  });

  it('should return inline image for image files', async () => {
    await fs.writeFile(path.join(tmpDir, 'image.png'), Buffer.alloc(256));

    const result = await handleWorkspaceRequest({ operation: 'read', filename: 'image.png' });
    expect(result.content[0].text).toContain(tmpDir);
    expect(result.content).toHaveLength(2);
    expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  });

  it('should return path reference for non-displayable binary files', async () => {
    await fs.writeFile(path.join(tmpDir, 'data.zip'), Buffer.alloc(256));

    const result = await handleWorkspaceRequest({ operation: 'read', filename: 'data.zip' });
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

  it('should delete a directory recursively', async () => {
    await fs.mkdir(path.join(tmpDir, 'old-project', 'images'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'old-project', 'images', 'photo.png'), Buffer.alloc(100));

    const result = await handleWorkspaceRequest({ operation: 'delete', filename: 'old-project' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Deleted directory');

    await expect(fs.access(path.join(tmpDir, 'old-project'))).rejects.toThrow();
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

  // ── Mkdir ─────────────────────────────────────────────

  it('should create a directory', async () => {
    const result = await handleWorkspaceRequest({ operation: 'mkdir', filename: 'projects' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Created');
    expect(result.content[0].text).toContain('Path:');

    const stat = await fs.stat(path.join(tmpDir, 'projects'));
    expect(stat.isDirectory()).toBe(true);
  });

  it('should create nested directories', async () => {
    const result = await handleWorkspaceRequest({ operation: 'mkdir', filename: 'a/b/c' });
    expect(result.isError).toBeUndefined();

    const stat = await fs.stat(path.join(tmpDir, 'a', 'b', 'c'));
    expect(stat.isDirectory()).toBe(true);
  });

  it('should require filename for mkdir', async () => {
    const result = await handleWorkspaceRequest({ operation: 'mkdir' });
    expect(result.isError).toBe(true);
  });

  // ── Move ───────────────────────────────────────────────

  it('should move/rename a file', async () => {
    await fs.writeFile(path.join(tmpDir, 'old-name.txt'), 'data');

    const result = await handleWorkspaceRequest({
      operation: 'move',
      filename: 'old-name.txt',
      destination: 'new-name.txt',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Moved');
    expect(result.content[0].text).toContain('Path:');

    await expect(fs.access(path.join(tmpDir, 'old-name.txt'))).rejects.toThrow();
    const content = await fs.readFile(path.join(tmpDir, 'new-name.txt'), 'utf-8');
    expect(content).toBe('data');
  });

  it('should move a file into a nested directory', async () => {
    await fs.writeFile(path.join(tmpDir, 'photo.png'), Buffer.alloc(100));

    const result = await handleWorkspaceRequest({
      operation: 'move',
      filename: 'photo.png',
      destination: 'images/photos/photo.png',
    });
    expect(result.isError).toBeUndefined();

    await expect(fs.access(path.join(tmpDir, 'photo.png'))).rejects.toThrow();
    const stat = await fs.stat(path.join(tmpDir, 'images', 'photos', 'photo.png'));
    expect(stat.isFile()).toBe(true);
  });

  it('should move a directory', async () => {
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'src', 'file.txt'), 'hello');

    const result = await handleWorkspaceRequest({
      operation: 'move',
      filename: 'src',
      destination: 'archive/src',
    });
    expect(result.isError).toBeUndefined();

    await expect(fs.access(path.join(tmpDir, 'src'))).rejects.toThrow();
    const content = await fs.readFile(path.join(tmpDir, 'archive', 'src', 'file.txt'), 'utf-8');
    expect(content).toBe('hello');
  });

  it('should error when source does not exist', async () => {
    const result = await handleWorkspaceRequest({
      operation: 'move',
      filename: 'ghost.txt',
      destination: 'new.txt',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('should require filename for move', async () => {
    const result = await handleWorkspaceRequest({ operation: 'move', destination: 'new.txt' });
    expect(result.isError).toBe(true);
  });

  it('should require destination for move', async () => {
    const result = await handleWorkspaceRequest({ operation: 'move', filename: 'old.txt' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('destination');
  });

  // ── Unknown operation ─────────────────────────────────

  it('should reject unknown operations', async () => {
    const result = await handleWorkspaceRequest({ operation: 'explode' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown');
  });
});
