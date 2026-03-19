/**
 * Editing session manager with per-block change tracking.
 * See ADR-301: Session-Based Editing with Delta Sync.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Block, SessionBlock, SessionBlockState } from '../content/blocks.js';

// ── Session Types ──────────────────────────────────────────────

export type SessionStatus = 'active' | 'dirty' | 'synced' | 'conflict';

export interface EditingSession {
  sessionId: string;
  pageId: string;
  spaceKey: string;
  version: number;
  blocks: SessionBlock[];
  originalHashes: Map<string, string>;
  status: SessionStatus;
  createdAt: Date;
  lastModified: Date;
}

// ── Session Manager ────────────────────────────────────────────

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class SessionManager {
  private sessions: Map<string, EditingSession> = new Map();

  /**
   * Create a new editing session from parsed blocks.
   */
  create(pageId: string, spaceKey: string, version: number, blocks: Block[]): string {
    const sessionId = randomUUID();
    const originalHashes = new Map<string, string>();
    const sessionBlocks: SessionBlock[] = blocks.map((block, i) => {
      const id = block.type === 'section' && block.id ? block.id : `block-${i}`;
      const hash = hashBlock(block);
      originalHashes.set(id, hash);
      return { block, id, hash, state: 'unchanged' as SessionBlockState };
    });

    this.sessions.set(sessionId, {
      sessionId,
      pageId,
      spaceKey,
      version,
      blocks: sessionBlocks,
      originalHashes,
      status: 'active',
      createdAt: new Date(),
      lastModified: new Date(),
    });

    return sessionId;
  }

  /**
   * Get a session by handle. Returns null if expired or not found.
   */
  get(sessionId: string): EditingSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const elapsed = Date.now() - session.lastModified.getTime();
    if (elapsed > SESSION_TIMEOUT_MS) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Update a block within a session.
   */
  updateBlock(sessionId: string, blockId: string, newBlock: Block): boolean {
    const session = this.get(sessionId);
    if (!session) return false;

    const idx = session.blocks.findIndex(b => b.id === blockId);
    if (idx === -1) return false;

    const hash = hashBlock(newBlock);
    const originalHash = session.originalHashes.get(blockId);
    const state: SessionBlockState = hash === originalHash ? 'unchanged' : 'modified';

    session.blocks[idx] = { block: newBlock, id: blockId, hash, state };
    session.status = 'dirty';
    session.lastModified = new Date();
    return true;
  }

  /**
   * Insert a new block at a position.
   */
  insertBlock(sessionId: string, position: number, block: Block): string | null {
    const session = this.get(sessionId);
    if (!session) return null;

    const id = `block-new-${randomUUID().slice(0, 8)}`;
    const hash = hashBlock(block);
    const sessionBlock: SessionBlock = { block, id, hash, state: 'inserted' };

    session.blocks.splice(position, 0, sessionBlock);
    session.status = 'dirty';
    session.lastModified = new Date();
    return id;
  }

  /**
   * Mark a block as deleted.
   */
  deleteBlock(sessionId: string, blockId: string): boolean {
    const session = this.get(sessionId);
    if (!session) return false;

    const idx = session.blocks.findIndex(b => b.id === blockId);
    if (idx === -1) return false;

    session.blocks[idx].state = 'deleted';
    session.status = 'dirty';
    session.lastModified = new Date();
    return true;
  }

  /**
   * Get changed blocks for delta sync.
   */
  getChanges(sessionId: string): SessionBlock[] {
    const session = this.get(sessionId);
    if (!session) return [];
    return session.blocks.filter(b => b.state !== 'unchanged');
  }

  /**
   * Get all non-deleted blocks (current state for full serialization).
   */
  getCurrentBlocks(sessionId: string): Block[] {
    const session = this.get(sessionId);
    if (!session) return [];
    return session.blocks
      .filter(b => b.state !== 'deleted')
      .map(b => b.block);
  }

  /**
   * Mark session as synced.
   */
  markSynced(sessionId: string, newVersion: number): void {
    const session = this.get(sessionId);
    if (!session) return;

    session.version = newVersion;
    session.status = 'synced';
    session.lastModified = new Date();

    // Reset change tracking
    session.originalHashes.clear();
    for (const sb of session.blocks) {
      if (sb.state === 'deleted') continue;
      sb.state = 'unchanged';
      session.originalHashes.set(sb.id, sb.hash);
    }
    session.blocks = session.blocks.filter(b => b.state !== 'deleted');
  }

  /**
   * Close and remove a session.
   */
  close(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * List active sessions (for debugging/status).
   */
  listSessions(): Array<{ sessionId: string; pageId: string; status: SessionStatus; blockCount: number }> {
    const result = [];
    for (const session of this.sessions.values()) {
      result.push({
        sessionId: session.sessionId,
        pageId: session.pageId,
        status: session.status,
        blockCount: session.blocks.length,
      });
    }
    return result;
  }
}

// ── Helpers ────────────────────────────────────────────────────

function hashBlock(block: Block): string {
  const content = JSON.stringify(block);
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
