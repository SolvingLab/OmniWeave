import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { OmniWeave } from '../src';

/**
 * End-to-end synthesizer tests for JS store dynamic dispatch.
 *
 * Pinia and Vuex hide action calls behind store instances or string keys. These
 * bridges are useful only if they stay conservative: Pinia requires a proven
 * relative import of the store factory, and Vuex bare dispatch/commit is limited
 * to store files while component calls must go through `$store`.
 */
describe('Pinia and Vuex dispatch synthesizer', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-dispatch-fixture-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('bridges imported Pinia store instance actions and skips unimported same-name factories', async () => {
    fs.mkdirSync(path.join(dir, 'stores'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'views'), { recursive: true });

    fs.writeFileSync(
      path.join(dir, 'stores', 'user.ts'),
      `import { defineStore } from 'pinia';

export function login() {
  return false;
}

export const useUserStore = defineStore('user', () => {
  return {
    login: async () => true,
    logout: () => false,
  };
});
`
    );
    fs.writeFileSync(
      path.join(dir, 'views', 'login.ts'),
      `import { useUserStore as useSessionStore } from '../stores/user';

export async function submitLogin() {
  const session = useSessionStore();
  const docOnly = "session.logout()";
  await session.login();
  return docOnly;
}
`
    );
    fs.writeFileSync(
      path.join(dir, 'views', 'fake.ts'),
      `export async function fakeLogin() {
  const session = useUserStore();
  await session.login();
}
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const fns = cg.getNodesByKind('function');
    const submitLogin = fns.find((n) => n.name === 'submitLogin');
    const fakeLogin = fns.find((n) => n.name === 'fakeLogin');
    const loginNodes = fns.filter((n) => n.name === 'login' && n.filePath.endsWith('stores/user.ts'));
    const login = loginNodes.find((n) => sourceLine(dir, n.filePath, n.startLine).includes('login:'));
    const helperLogin = loginNodes.find((n) => sourceLine(dir, n.filePath, n.startLine).includes('function login'));
    const logout = fns.find((n) => n.name === 'logout' && n.filePath.endsWith('stores/user.ts'));

    expect(submitLogin).toBeDefined();
    expect(fakeLogin).toBeDefined();
    expect(login).toBeDefined();
    expect(helperLogin).toBeDefined();
    expect(logout).toBeDefined();

    const bridge = cg
      .getOutgoingEdges(submitLogin!.id)
      .find(
        (e) =>
          e.target === login!.id &&
          e.kind === 'calls' &&
          e.provenance === 'heuristic' &&
          (e.metadata as { synthesizedBy?: string } | undefined)?.synthesizedBy ===
            'pinia-store'
      );
    expect(bridge).toBeDefined();
    expect((bridge!.metadata as { confidence?: number }).confidence).toBe(0.8);
    expect((bridge!.metadata as { registeredAt?: string }).registeredAt).toMatch(/views\/login\.ts:\d+/);
    expect(bridge!.target).not.toBe(helperLogin!.id);

    const fakeBridge = cg
      .getOutgoingEdges(fakeLogin!.id)
      .find(
        (e) =>
          e.target === login!.id &&
          (e.metadata as { synthesizedBy?: string } | undefined)?.synthesizedBy ===
            'pinia-store'
    );
    expect(fakeBridge).toBeUndefined();

    const stringOnlyBridge = cg
      .getOutgoingEdges(submitLogin!.id)
      .find(
        (e) =>
          e.target === logout!.id &&
          (e.metadata as { synthesizedBy?: string } | undefined)?.synthesizedBy ===
            'pinia-store'
      );
    expect(stringOnlyBridge).toBeUndefined();

    cg.close();
  });

  it('bridges Vuex string keys through $store and local store commits, but skips unrelated bare dispatch', async () => {
    fs.mkdirSync(path.join(dir, 'store', 'modules'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'views'), { recursive: true });

    fs.writeFileSync(
      path.join(dir, 'store', 'modules', 'user.js'),
      `export function login({ commit }) {
  commit('SET_TOKEN');
}

export function getInfo() {
  return {};
}

export function SET_TOKEN(state) {
  state.token = 'ok';
}

export default { namespaced: true, actions: { login }, mutations: { SET_TOKEN } };
`
    );
    fs.writeFileSync(
      path.join(dir, 'views', 'login.js'),
      `export function submitLogin() {
  this.$store.dispatch('user/login');
}

export function wrongNamespace() {
  this.$store.dispatch('ghost/login');
}

export function unregisteredAction() {
  this.$store.dispatch('user/getInfo');
}

export function rootKey() {
  this.$store.dispatch('login');
}

export function docOnly() {
  return "this.$store.dispatch('user/login')";
}

export function reduxLike(dispatch) {
  dispatch('user/login');
}
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const fns = cg.getNodesByKind('function');
    const submitLogin = fns.find((n) => n.name === 'submitLogin');
    const wrongNamespace = fns.find((n) => n.name === 'wrongNamespace');
    const unregisteredAction = fns.find((n) => n.name === 'unregisteredAction');
    const rootKey = fns.find((n) => n.name === 'rootKey');
    const docOnly = fns.find((n) => n.name === 'docOnly');
    const reduxLike = fns.find((n) => n.name === 'reduxLike');
    const login = fns.find((n) => n.name === 'login' && n.filePath.endsWith('store/modules/user.js'));
    const getInfo = fns.find((n) => n.name === 'getInfo' && n.filePath.endsWith('store/modules/user.js'));
    const setToken = fns.find((n) => n.name === 'SET_TOKEN' && n.filePath.endsWith('store/modules/user.js'));

    expect(submitLogin).toBeDefined();
    expect(wrongNamespace).toBeDefined();
    expect(unregisteredAction).toBeDefined();
    expect(rootKey).toBeDefined();
    expect(docOnly).toBeDefined();
    expect(reduxLike).toBeDefined();
    expect(login).toBeDefined();
    expect(getInfo).toBeDefined();
    expect(setToken).toBeDefined();

    const submitBridge = cg
      .getOutgoingEdges(submitLogin!.id)
      .find(
        (e) =>
          e.target === login!.id &&
          e.kind === 'calls' &&
          e.provenance === 'heuristic' &&
          (e.metadata as { synthesizedBy?: string } | undefined)?.synthesizedBy ===
            'vuex-dispatch'
      );
    expect(submitBridge).toBeDefined();
    expect((submitBridge!.metadata as { via?: string; confidence?: number }).via).toBe('user/login');
    expect((submitBridge!.metadata as { via?: string; confidence?: number }).confidence).toBe(0.75);

    const mutationBridge = cg
      .getOutgoingEdges(login!.id)
      .find(
        (e) =>
          e.target === setToken!.id &&
          e.kind === 'calls' &&
          (e.metadata as { synthesizedBy?: string } | undefined)?.synthesizedBy ===
            'vuex-dispatch'
      );
    expect(mutationBridge).toBeDefined();
    expect((mutationBridge!.metadata as { via?: string }).via).toBe('SET_TOKEN');

    for (const source of [wrongNamespace, rootKey, docOnly]) {
      const badBridge = cg
        .getOutgoingEdges(source!.id)
        .find(
          (e) =>
            e.target === login!.id &&
            (e.metadata as { synthesizedBy?: string } | undefined)?.synthesizedBy ===
              'vuex-dispatch'
        );
      expect(badBridge).toBeUndefined();
    }

    const unregisteredBridge = cg
      .getOutgoingEdges(unregisteredAction!.id)
      .find(
        (e) =>
          e.target === getInfo!.id &&
          (e.metadata as { synthesizedBy?: string } | undefined)?.synthesizedBy ===
            'vuex-dispatch'
      );
    expect(unregisteredBridge).toBeUndefined();

    const reduxBridge = cg
      .getOutgoingEdges(reduxLike!.id)
      .find(
        (e) =>
          e.target === login!.id &&
          (e.metadata as { synthesizedBy?: string } | undefined)?.synthesizedBy ===
            'vuex-dispatch'
      );
    expect(reduxBridge).toBeUndefined();

    cg.close();
  });
});

function sourceLine(root: string, filePath: string, line: number): string {
  return fs.readFileSync(path.resolve(root, filePath), 'utf-8').split('\n')[line - 1] ?? '';
}
