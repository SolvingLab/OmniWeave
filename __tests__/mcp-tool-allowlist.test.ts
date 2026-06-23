/**
 * OMNIWEAVE_MCP_TOOLS allowlist — lets an operator (or an A/B harness) trim the
 * exposed MCP tool surface without touching the client config. Inert when unset.
 * Filtering happens in ListTools (getTools) and is enforced again on execute().
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getStaticTools, ToolHandler } from '../src/mcp/tools';

const ENV = 'OMNIWEAVE_MCP_TOOLS';

describe('OMNIWEAVE_MCP_TOOLS allowlist', () => {
  const original = process.env[ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  const listed = () => new ToolHandler(null).getTools().map(t => t.name).sort();
  const staticListed = () => getStaticTools().map(t => t.name).sort();

  it('exposes the default 5-tool surface when unset', () => {
    delete process.env[ENV];
    // The default set (see DEFAULT_MCP_TOOLS): explore + node are the
    // validated workhorses, search the cheap lookup, callers the one
    // irreplaceable enumerator, impact the one-call transitive closure
    // (round-4 A/B: without it, agents rebuild the closure with ~20
    // recursive callers). callees/files/status stay defined and executable
    // but unlisted.
    expect(listed()).toEqual([
      'omniweave_callers',
      'omniweave_explore',
      'omniweave_impact',
      'omniweave_node',
      'omniweave_search',
    ]);
  });

  it('keeps static and dynamic no-project tool lists identical', () => {
    for (const value of [undefined, '   ', ',', ' , , ', 'explore,files']) {
      if (value === undefined) delete process.env[ENV];
      else process.env[ENV] = value;

      expect(staticListed()).toEqual(listed());
    }
  });

  it('re-enables an unlisted tool via the allowlist (callees)', () => {
    process.env[ENV] = 'explore,callees';
    expect(listed()).toEqual(['omniweave_callees', 'omniweave_explore']);
  });

  it('filters ListTools to the allowlisted short names', () => {
    process.env[ENV] = 'explore,search,node';
    expect(listed()).toEqual(['omniweave_explore', 'omniweave_node', 'omniweave_search']);
  });

  it('accepts fully-qualified omniweave_ names and ignores whitespace', () => {
    process.env[ENV] = ' omniweave_explore , search ';
    expect(listed()).toEqual(['omniweave_explore', 'omniweave_search']);
  });

  it('treats an empty/whitespace value as unset (default surface)', () => {
    process.env[ENV] = '   ';
    expect(listed()).toHaveLength(5);
    expect(listed()).toContain('omniweave_explore');
  });

  it('treats delimiter-only values as unset instead of exposing every tool', () => {
    process.env[ENV] = ',,';

    expect(listed()).toHaveLength(5);
    expect(staticListed()).toEqual(listed());
    expect(staticListed()).not.toContain('omniweave_files');
    expect(staticListed()).not.toContain('omniweave_status');
  });

  it('does not advertise a stale fixed maxFiles default in the static explore schema', () => {
    delete process.env[ENV];
    const explore = getStaticTools().find(t => t.name === 'omniweave_explore');
    const maxFiles = explore?.inputSchema.properties.maxFiles;

    expect(maxFiles?.description).toContain('adaptive project-size default');
    expect(maxFiles).not.toHaveProperty('default');
  });

  it('adds the current adaptive maxFiles default to the dynamic explore description', () => {
    delete process.env[ENV];
    const cg = {
      getStats: () => ({ fileCount: 42 }),
    } as unknown as ConstructorParameters<typeof ToolHandler>[0];
    const explore = new ToolHandler(cg).getTools().find(t => t.name === 'omniweave_explore');

    expect(explore?.description).toContain('Budget: make at most 1 calls for this project');
    expect(explore?.description).toContain('defaults to 4 source files per call');
  });

  it('applies the same project-size shaping to static proxy tools when file count is known', () => {
    delete process.env[ENV];
    const tiny = getStaticTools(42);
    const medium = getStaticTools(505);

    expect(tiny.map(t => t.name).sort()).toEqual([
      'omniweave_explore',
      'omniweave_node',
      'omniweave_search',
    ]);
    expect(tiny.find(t => t.name === 'omniweave_explore')?.description).toContain(
      'Budget: make at most 1 calls for this project (42 files indexed)'
    );
    expect(tiny.find(t => t.name === 'omniweave_explore')?.description).toContain(
      'defaults to 4 source files per call'
    );

    expect(medium.map(t => t.name).sort()).toEqual([
      'omniweave_callers',
      'omniweave_explore',
      'omniweave_impact',
      'omniweave_node',
      'omniweave_search',
    ]);
    expect(medium.find(t => t.name === 'omniweave_explore')?.description).toContain(
      'Budget: make at most 2 calls for this project (505 files indexed)'
    );
    expect(medium.find(t => t.name === 'omniweave_explore')?.description).toContain(
      'defaults to 8 source files per call'
    );
  });

  it('discloses bounded numeric parameters in the static tool schemas', () => {
    delete process.env[ENV];
    const byName = new Map(getStaticTools().map(t => [t.name, t]));

    expect(byName.get('omniweave_search')?.inputSchema.properties.limit.description).toContain('clamped to 1-100');
    expect(byName.get('omniweave_callers')?.inputSchema.properties.limit.description).toContain('clamped to 1-100');
    expect(byName.get('omniweave_impact')?.inputSchema.properties.depth.description).toContain('clamped to 1-10');
  });

  it('rejects a disabled tool on execute (defense in depth)', async () => {
    process.env[ENV] = 'node';
    const res = await new ToolHandler(null).execute('omniweave_explore', {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/disabled via OMNIWEAVE_MCP_TOOLS/);
  });

  it('lets an allowlisted tool past the guard', async () => {
    process.env[ENV] = 'search';
    // No OmniWeave attached, so it fails *after* the allowlist guard — the
    // "disabled" message must NOT appear, proving the guard passed it through.
    const res = await new ToolHandler(null).execute('omniweave_search', { query: 'x' });
    expect(res.content[0].text).not.toMatch(/disabled via OMNIWEAVE_MCP_TOOLS/);
  });
});
