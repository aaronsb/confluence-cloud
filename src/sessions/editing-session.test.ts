import { describe, it, expect } from 'vitest';
import { SessionManager } from './editing-session.js';
import type { Block } from '../content/blocks.js';

function makeBlocks(): Block[] {
  return [
    { type: 'paragraph', text: 'First paragraph', id: 'p1' },
    { type: 'section', heading: 'Section', level: 2, content: [
      { type: 'paragraph', text: 'Section body', id: 'p2' },
    ], id: 's1' },
  ];
}

describe('SessionManager', () => {
  it('should create a session and return a handle', () => {
    const mgr = new SessionManager();
    const id = mgr.create('page-1', 'SPACE', 1, makeBlocks());
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('should retrieve a session by handle', () => {
    const mgr = new SessionManager();
    const id = mgr.create('page-1', 'SPACE', 1, makeBlocks());
    const session = mgr.get(id);
    expect(session).not.toBeNull();
    expect(session?.pageId).toBe('page-1');
    expect(session?.version).toBe(1);
    expect(session?.blocks).toHaveLength(2);
  });

  it('should return null for unknown session', () => {
    const mgr = new SessionManager();
    expect(mgr.get('nonexistent')).toBeNull();
  });

  it('should track block changes via updateBlock', () => {
    const mgr = new SessionManager();
    const id = mgr.create('page-1', 'SPACE', 1, makeBlocks());

    const updated: Block = { type: 'paragraph', text: 'Updated text', id: 'p1' };
    const success = mgr.updateBlock(id, 'block-0', updated);
    expect(success).toBe(true);

    const changes = mgr.getChanges(id);
    expect(changes.some(c => c.state === 'modified')).toBe(true);

    const session = mgr.get(id);
    expect(session?.status).toBe('dirty');
  });

  it('should insert blocks at position', () => {
    const mgr = new SessionManager();
    const id = mgr.create('page-1', 'SPACE', 1, makeBlocks());

    const newBlock: Block = { type: 'paragraph', text: 'Inserted', id: 'new' };
    const newId = mgr.insertBlock(id, 1, newBlock);
    expect(newId).toBeTruthy();

    const blocks = mgr.getCurrentBlocks(id);
    expect(blocks).toHaveLength(3);
  });

  it('should mark blocks as deleted', () => {
    const mgr = new SessionManager();
    const id = mgr.create('page-1', 'SPACE', 1, makeBlocks());

    mgr.deleteBlock(id, 'block-0');
    const blocks = mgr.getCurrentBlocks(id);
    expect(blocks).toHaveLength(1); // one deleted, one remaining
  });

  it('should report no changes for unmodified session', () => {
    const mgr = new SessionManager();
    const id = mgr.create('page-1', 'SPACE', 1, makeBlocks());
    expect(mgr.getChanges(id)).toHaveLength(0);
  });

  it('should mark session as synced and reset change tracking', () => {
    const mgr = new SessionManager();
    const id = mgr.create('page-1', 'SPACE', 1, makeBlocks());

    const updated: Block = { type: 'paragraph', text: 'Changed', id: 'p1' };
    mgr.updateBlock(id, 'block-0', updated);
    expect(mgr.getChanges(id)).toHaveLength(1);

    mgr.markSynced(id, 2);
    expect(mgr.getChanges(id)).toHaveLength(0);
    expect(mgr.get(id)?.version).toBe(2);
    expect(mgr.get(id)?.status).toBe('synced');
  });

  it('should close and remove a session', () => {
    const mgr = new SessionManager();
    const id = mgr.create('page-1', 'SPACE', 1, makeBlocks());
    mgr.close(id);
    expect(mgr.get(id)).toBeNull();
  });

  it('should list active sessions', () => {
    const mgr = new SessionManager();
    mgr.create('page-1', 'SPACE', 1, makeBlocks());
    mgr.create('page-2', 'SPACE', 3, makeBlocks());
    const sessions = mgr.listSessions();
    expect(sessions).toHaveLength(2);
  });
});
