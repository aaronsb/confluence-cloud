import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import {
  sanitizeFilename,
  resolveWorkspacePath,
  validateWorkspaceDir,
  getWorkspaceDir,
  checkWorkspaceStatus,
} from './workspace.js';

describe('sanitizeFilename', () => {
  it('should pass through clean filenames', () => {
    expect(sanitizeFilename('photo.png')).toBe('photo.png');
    expect(sanitizeFilename('my-file_v2.txt')).toBe('my-file_v2.txt');
  });

  it('should strip path separators', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(sanitizeFilename('foo\\bar\\baz.txt')).toBe('foo_bar_baz.txt');
  });

  it('should strip null bytes and control chars', () => {
    expect(sanitizeFilename('file\x00name.txt')).toBe('filename.txt');
    expect(sanitizeFilename('file\x01\x02.txt')).toBe('file.txt');
  });

  it('should strip dangerous characters', () => {
    expect(sanitizeFilename('file<>:"|?*.txt')).toBe('file_.txt');
  });

  it('should remove leading dots', () => {
    expect(sanitizeFilename('.hidden')).toBe('hidden');
    expect(sanitizeFilename('...secret')).toBe('secret');
  });

  it('should remove trailing dots and spaces', () => {
    expect(sanitizeFilename('file.txt...')).toBe('file.txt');
    expect(sanitizeFilename('file.txt   ')).toBe('file.txt');
  });

  it('should collapse multiple underscores', () => {
    expect(sanitizeFilename('a///b')).toBe('a_b');
  });

  it('should return unnamed for empty result', () => {
    expect(sanitizeFilename('')).toBe('unnamed');
    expect(sanitizeFilename('...')).toBe('unnamed');
    expect(sanitizeFilename('\x00')).toBe('unnamed');
  });
});

describe('resolveWorkspacePath', () => {
  const originalEnv = process.env.WORKSPACE_DIR;

  beforeEach(() => {
    process.env.WORKSPACE_DIR = '/tmp/test-workspace';
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.WORKSPACE_DIR = originalEnv;
    } else {
      delete process.env.WORKSPACE_DIR;
    }
  });

  it('should resolve clean filenames inside workspace', () => {
    const result = resolveWorkspacePath('photo.png');
    expect(result).toBe('/tmp/test-workspace/photo.png');
  });

  it('should sanitize before resolving', () => {
    const result = resolveWorkspacePath('../../etc/passwd');
    // After sanitization: _.._etc_passwd (dots preserved, separators replaced)
    expect(result).toBe('/tmp/test-workspace/_.._etc_passwd');
  });

  it('should not resolve to workspace root itself', () => {
    // sanitizeFilename('') returns 'unnamed'
    const result = resolveWorkspacePath('');
    expect(result).toBe('/tmp/test-workspace/unnamed');
  });
});

describe('validateWorkspaceDir', () => {
  it('should accept valid workspace paths', () => {
    expect(() => validateWorkspaceDir('/tmp/mcp-workspace')).not.toThrow();
    expect(() => validateWorkspaceDir('/home/user/projects/workspace')).not.toThrow();
  });

  it('should reject home directory', () => {
    const home = process.env.HOME;
    if (home) {
      expect(() => validateWorkspaceDir(home)).toThrow('cannot be');
    }
  });

  it('should reject filesystem root', () => {
    expect(() => validateWorkspaceDir('/')).toThrow('filesystem root');
  });

  it('should reject cloud sync mounts', () => {
    expect(() => validateWorkspaceDir('/home/user/Google Drive/workspace')).toThrow('cloud sync');
    expect(() => validateWorkspaceDir('/home/user/OneDrive/work')).toThrow('cloud sync');
    expect(() => validateWorkspaceDir('/home/user/Dropbox/files')).toThrow('cloud sync');
  });

  it('should allow subdirectories of protected paths', () => {
    const home = process.env.HOME;
    if (home) {
      expect(() => validateWorkspaceDir(path.join(home, 'mcp-workspace'))).not.toThrow();
    }
  });
});

describe('getWorkspaceDir', () => {
  const originalWD = process.env.WORKSPACE_DIR;
  const originalXDG = process.env.XDG_DATA_HOME;

  afterEach(() => {
    if (originalWD !== undefined) process.env.WORKSPACE_DIR = originalWD;
    else delete process.env.WORKSPACE_DIR;
    if (originalXDG !== undefined) process.env.XDG_DATA_HOME = originalXDG;
    else delete process.env.XDG_DATA_HOME;
  });

  it('should respect WORKSPACE_DIR override', () => {
    process.env.WORKSPACE_DIR = '/custom/workspace';
    expect(getWorkspaceDir()).toBe('/custom/workspace');
  });

  it('should ignore template variables in WORKSPACE_DIR', () => {
    process.env.WORKSPACE_DIR = '${user_config.workspace_dir}';
    const result = getWorkspaceDir();
    expect(result).not.toContain('${');
    expect(result).toContain('confluence-cloud-mcp');
  });

  it('should use default when WORKSPACE_DIR is unset', () => {
    delete process.env.WORKSPACE_DIR;
    const result = getWorkspaceDir();
    expect(result).toContain('confluence-cloud-mcp');
    expect(result).toContain('workspace');
  });
});

describe('checkWorkspaceStatus', () => {
  const originalWD = process.env.WORKSPACE_DIR;

  afterEach(() => {
    if (originalWD !== undefined) process.env.WORKSPACE_DIR = originalWD;
    else delete process.env.WORKSPACE_DIR;
  });

  it('should return valid for safe paths', () => {
    process.env.WORKSPACE_DIR = '/tmp/mcp-workspace';
    const status = checkWorkspaceStatus();
    expect(status.valid).toBe(true);
    expect(status.path).toBe('/tmp/mcp-workspace');
  });

  it('should return invalid with warning for bad paths', () => {
    process.env.WORKSPACE_DIR = '/';
    const status = checkWorkspaceStatus();
    expect(status.valid).toBe(false);
    expect(status.warning).toContain('filesystem root');
  });
});
