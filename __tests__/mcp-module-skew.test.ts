import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const projectRoot = join(__dirname, '..');

function readSource(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

describe('MCP module-skew guard', () => {
  it('keeps explore/context runtime independent from the query-level low-signal export', () => {
    const runtimeSources = [
      'src/context/index.ts',
      'src/mcp/tools.ts',
    ];

    for (const relativePath of runtimeSources) {
      const source = readSource(relativePath);
      expect(source, relativePath).not.toContain('isLowSignalSourceQuery');
    }
  });
});
