import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MCPEngine } from '../src/mcp/engine';
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcTransport, MessageHandler } from '../src/mcp/transport';
import { waitForWriteFlush } from '../src/mcp/transport';

describe('waitForWriteFlush', () => {
  it('waits for the stream write callback before resolving', async () => {
    let callbackFired = false;

    await waitForWriteFlush((finish) => {
      setTimeout(() => {
        callbackFired = true;
        finish();
      }, 5);
    });

    expect(callbackFired).toBe(true);
  });

  it('resolves when the stream write throws', async () => {
    await expect(waitForWriteFlush(() => {
      throw new Error('broken pipe');
    })).resolves.toBeUndefined();
  });
});

describe('MCPSession stale runtime replies', () => {
  afterEach(() => {
    vi.doUnmock('../src/mcp/version');
    vi.resetModules();
  });

  it('flushes the stale-runtime JSON-RPC error before closing the transport', async () => {
    vi.doMock('../src/mcp/version', () => ({
      OmniWeavePackageVersion: '1.0.0',
      runtimeBuildSkew: () => ({ loaded: '1.0.0+oldbuild', current: '1.0.0+newbuild' }),
      runtimeBuildSkewMessage: (skew: { loaded: string; current: string }) =>
        `OmniWeave MCP runtime is stale: running ${skew.loaded}, but current disk build is ${skew.current}. Restart the MCP server before trusting tool output.`,
    }));

    const { MCPSession } = await import('../src/mcp/session');
    const transport = new FakeTransport();
    let ownerMessage = '';
    const session = new MCPSession(transport, {} as MCPEngine, {
      onStaleRuntime: (message) => {
        ownerMessage = message;
        transport.events.push('owner-stale');
      },
    });
    session.start();

    await transport.deliver({ jsonrpc: '2.0', id: 7, method: 'tools/list' });

    expect(transport.events).toEqual(['flush-error:7', 'stop', 'owner-stale']);
    expect(transport.errorMessage).toContain('OmniWeave MCP runtime is stale');
    expect(ownerMessage).toBe(transport.errorMessage);
  });
});

class FakeTransport implements JsonRpcTransport {
  events: string[] = [];
  errorMessage = '';
  private handler: MessageHandler | null = null;

  start(handler: MessageHandler): void {
    this.handler = handler;
  }

  stop(): void {
    this.events.push('stop');
  }

  send(): void { /* not used */ }
  notify(): void { /* not used */ }
  request(): Promise<unknown> { return Promise.resolve({}); }
  sendResult(): void { /* not used */ }
  sendError(): void { /* not used */ }

  async sendErrorAndFlush(id: string | number | null, _code: number, message: string): Promise<void> {
    this.events.push(`flush-error:${String(id)}`);
    this.errorMessage = message;
  }

  async deliver(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    if (!this.handler) throw new Error('transport not started');
    await this.handler(message);
  }
}
