// In-memory `localStorage` for the persisted zustand stores under the node
// jest environment. Seeded with what an older build left behind, so the
// store's migration runs on import.
const data = new Map<string, string>([
  [
    'bull_monitor:store:agents',
    JSON.stringify({
      state: { view: 'run', runLayout: 'waterfall', range: '24h' },
      version: 0,
    }),
  ],
]);

(globalThis as unknown as { localStorage: unknown }).localStorage = {
  get length() {
    return data.size;
  },
  clear: () => data.clear(),
  getItem: (key: string) => data.get(key) ?? null,
  key: (index: number) => Array.from(data.keys())[index] ?? null,
  removeItem: (key: string) => {
    data.delete(key);
  },
  setItem: (key: string, value: string) => {
    data.set(key, String(value));
  },
};

export const readPersisted = (key: string) => {
  const raw = data.get(key);
  return raw ? JSON.parse(raw) : null;
};
