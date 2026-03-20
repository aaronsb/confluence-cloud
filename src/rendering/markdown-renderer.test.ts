import { describe, it, expect } from 'vitest';
import {
  renderPage,
  renderPageList,
  renderSpace,
  renderSpaceList,
  renderSearchResults,
  renderAttachmentList,
  renderTree,
} from './markdown-renderer.js';
import type { Page, Space, SearchResult, Attachment } from '../types/index.js';

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: '123',
    title: 'Test Page',
    spaceId: 'sp1',
    spaceKey: 'TEST',
    status: 'current',
    version: { number: 3, createdAt: '2026-03-15T10:00:00Z', authorId: 'user1' },
    createdAt: '2026-01-01T00:00:00Z',
    authorId: 'user1',
    ...overrides,
  };
}

describe('renderPage', () => {
  it('should render basic page metadata', () => {
    const text = renderPage(makePage());
    expect(text).toContain('📄 Test Page');
    expect(text).toContain('id:123');
    expect(text).toContain('TEST');
    expect(text).toContain('current');
    expect(text).toContain('v3');
  });

  it('should include parent when present', () => {
    const text = renderPage(makePage({ parentId: '456' }));
    expect(text).toContain('Parent: 456');
  });

  it('should include labels when present', () => {
    const text = renderPage(makePage({
      labels: [
        { id: 'l1', name: 'architecture', prefix: 'global' },
        { id: 'l2', name: 'reviewed', prefix: 'global' },
      ],
    }));
    expect(text).toContain('Labels: architecture, reviewed');
  });

  it('should show body placeholder when expanded', () => {
    const text = renderPage(
      makePage({ body: { atlas_doc_format: { type: 'doc', content: [] } } }),
      { showBody: true },
    );
    expect(text).toContain('Page body available');
  });

  it('should not show body when not expanded', () => {
    const text = renderPage(makePage({ body: { atlas_doc_format: { type: 'doc', content: [] } } }));
    expect(text).not.toContain('Page body available');
  });

  it('should fall back to spaceId when spaceKey missing', () => {
    const text = renderPage(makePage({ spaceKey: undefined }));
    expect(text).toContain('sp1');
  });
});

describe('renderPageList', () => {
  it('should render empty list', () => {
    expect(renderPageList([])).toBe('No pages found.');
  });

  it('should render multiple pages', () => {
    const pages = [
      makePage({ id: '1', title: 'Page A' }),
      makePage({ id: '2', title: 'Page B' }),
    ];
    const text = renderPageList(pages);
    expect(text).toContain('Page A');
    expect(text).toContain('id:1');
    expect(text).toContain('Page B');
    expect(text).toContain('id:2');
  });
});

describe('renderSpace', () => {
  it('should render space with description', () => {
    const space: Space = {
      id: 's1', key: 'ENG', name: 'Engineering',
      type: 'global', status: 'current', description: 'Engineering space',
    };
    const text = renderSpace(space);
    expect(text).toContain('🏠 Engineering (ENG)');
    expect(text).toContain('global');
    expect(text).toContain('Engineering space');
  });

  it('should render space without description', () => {
    const space: Space = { id: 's1', key: 'ENG', name: 'Engineering', type: 'global', status: 'current' };
    const text = renderSpace(space);
    expect(text).toContain('🏠 Engineering (ENG)');
    expect(text).not.toContain('\n');
  });
});

describe('renderSpaceList', () => {
  it('should render empty list', () => {
    expect(renderSpaceList([])).toBe('No spaces found.');
  });

  it('should render multiple spaces', () => {
    const spaces: Space[] = [
      { id: 's1', key: 'ENG', name: 'Engineering', type: 'global', status: 'current' },
      { id: 's2', key: 'HR', name: 'HR', type: 'global', status: 'current' },
    ];
    const text = renderSpaceList(spaces);
    expect(text).toContain('Engineering (ENG)');
    expect(text).toContain('HR (HR)');
  });
});

describe('renderSearchResults', () => {
  it('should render result count and items', () => {
    const results: SearchResult = {
      totalSize: 2,
      results: [
        {
          content: makePage({ id: '10', title: 'Result One' }),
          excerpt: 'This is the first result',
          lastModified: '2026-03-10',
          url: '/wiki/spaces/TEST/pages/10',
        },
        {
          content: makePage({ id: '20', title: 'Result Two' }),
          lastModified: '2026-03-11',
          url: '/wiki/spaces/TEST/pages/20',
        },
      ],
    };
    const text = renderSearchResults(results);
    expect(text).toContain('Found 2 result(s)');
    expect(text).toContain('Result One');
    expect(text).toContain('id:10');
    expect(text).toContain('This is the first result');
    expect(text).toContain('Result Two');
    expect(text).toContain('id:20');
  });

  it('should show cursor when available', () => {
    const results: SearchResult = {
      totalSize: 50,
      results: [],
      cursor: 'abc123',
    };
    const text = renderSearchResults(results);
    expect(text).toContain('cursor: "abc123"');
  });
});

describe('renderAttachmentList', () => {
  it('should render empty list', () => {
    expect(renderAttachmentList([])).toBe('No attachments found.');
  });

  it('should render attachments with formatted sizes', () => {
    const attachments: Attachment[] = [
      { id: 'a1', title: 'doc.pdf', mediaType: 'application/pdf', fileSize: 1024 * 500, downloadUrl: '', pageId: '1', version: 1, createdAt: '' },
      { id: 'a2', title: 'tiny.txt', mediaType: 'text/plain', fileSize: 100, downloadUrl: '', pageId: '1', version: 1, createdAt: '' },
      { id: 'a3', title: 'big.zip', mediaType: 'application/zip', fileSize: 1024 * 1024 * 2.5, downloadUrl: '', pageId: '1', version: 1, createdAt: '' },
    ];
    const text = renderAttachmentList(attachments);
    expect(text).toContain('doc.pdf');
    expect(text).toContain('500.0KB');
    expect(text).toContain('tiny.txt');
    expect(text).toContain('100B');
    expect(text).toContain('big.zip');
    expect(text).toContain('2.5MB');
  });
});

describe('renderTree', () => {
  it('should render tree with indentation', () => {
    const pages = [
      { page: makePage({ title: 'Root' }), depth: 0 },
      { page: makePage({ title: 'Child A' }), depth: 1 },
      { page: makePage({ title: 'Grandchild' }), depth: 2 },
      { page: makePage({ title: 'Child B' }), depth: 1 },
    ];
    const text = renderTree(pages);
    expect(text).toContain('📄 Root');
    expect(text).toContain('├── 📄 Child A');
    expect(text).toContain('│   ├── 📄 Grandchild');
    expect(text).toContain('├── 📄 Child B');
    expect(text).toContain('4 pages');
  });
});
