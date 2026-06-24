import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { OmniWeave } from '../src';

/**
 * Extraction-layer parity for object-literal store members — the foundation the
 * pinia-store / vuex-dispatch synthesizers bridge to. A real Pinia/Vuex store
 * defines its actions as object-literal methods inside a config object passed to
 * `defineStore` / `createStore` / `export default {...}`, or as body-local consts
 * in a Pinia SETUP store. Tree-sitter does not extract object-literal methods by
 * default, so without this pass those actions are never nodes and any dispatch
 * bridge has 0 targets (measured: vue-realworld had 1 store-fn node vs codegraph's
 * 27, 0 pinia edges vs 25). This locks all three real-world shapes + the
 * store-file precision gate.
 */
async function storeFnNames(dir: string, fileGlob: string): Promise<string[]> {
  const cg = await OmniWeave.init(dir, { silent: true });
  await cg.indexAll();
  const rows = (cg as any).db.db
    .prepare(
      `SELECT name FROM nodes WHERE kind IN ('function','method') AND file_path LIKE ? ORDER BY name`
    )
    .all(fileGlob);
  cg.close?.();
  return rows.map((r: any) => r.name);
}

describe('object-literal store-member extraction', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-extract-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('extracts Pinia OPTIONS-form actions (defineStore(id, { actions: {...} }))', async () => {
    fs.writeFileSync(
      path.join(dir, 'user.ts'),
      `import { defineStore } from 'pinia';
export const useUserStore = defineStore('user', {
  state: () => ({ token: '' }),
  getters: { token: (s) => s.token },
  actions: {
    setAuth(user) { this.token = user.token; },
    login(creds) { return this.setAuth(creds); },
  },
});
`
    );
    const names = await storeFnNames(dir, '%user.ts');
    expect(names).toContain('setAuth');
    expect(names).toContain('login');
  });

  it('extracts Pinia SETUP-form actions (defineStore(id, () => { fn; return {fn} }))', async () => {
    fs.writeFileSync(
      path.join(dir, 'auth.ts'),
      `import { defineStore } from 'pinia';
export const useAuthStore = defineStore('auth', () => {
  async function login() { return true; }
  const logout = () => false;
  return { login, logout };
});
`
    );
    const names = await storeFnNames(dir, '%auth.ts');
    expect(names).toContain('login');
    expect(names).toContain('logout');
  });

  it('extracts Vuex MODULE default-export actions/mutations', async () => {
    fs.writeFileSync(
      path.join(dir, 'module.js'),
      `export default {
  namespaced: true,
  mutations: { SET_TOKEN(state, token) { state.token = token; } },
  actions: { login({ commit }, pw) { commit('SET_TOKEN', pw); } },
};
`
    );
    const names = await storeFnNames(dir, '%module.js');
    expect(names).toContain('SET_TOKEN');
    expect(names).toContain('login');
  });

  it('does NOT over-extract object methods in a non-store file', async () => {
    // A plain config object with method shorthand in a file with no store signals
    // must stay untouched — the store-file gate / store-factory callee is the
    // precision boundary (error edges/nodes are worse than missing ones).
    fs.writeFileSync(
      path.join(dir, 'config.js'),
      `export const handlers = {
  onClick() { return 1; },
  onHover() { return 2; },
};
export default { actions: { notAStore() { return 3; } } };
`
    );
    const names = await storeFnNames(dir, '%config.js');
    // handlers is an exported object-of-functions (OmniWeave already extracts those),
    // but the bare `export default { actions: {...} }` must NOT fire its store path
    // in a file with no store signals.
    expect(names).not.toContain('notAStore');
  });
});
