/**
 * OMNIWEAVE_MCP_TOOLS allowlist — lets an operator (or an A/B harness) trim the
 * exposed MCP tool surface without touching the client config. Inert when unset.
 * Filtering happens in ListTools (getTools) and is enforced again on execute().
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ToolHandler } from '../src/mcp/tools';

const ENV = 'OMNIWEAVE_MCP_TOOLS';

describe('OMNIWEAVE_MCP_TOOLS allowlist', () => {
  const original = process.env[ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  const listed = () => new ToolHandler(null).getTools().map(t => t.name).sort();

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
