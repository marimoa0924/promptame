// 기기마다 "이미 본 문제"를 기억해서, 새 판을 만들 때 먼저 안 본 문제를 뽑게 한다.
const MAX_PER_DEVICE = 80;
const MAX_DEVICES = 2000;

export function createSeen(store) {
  const seen = (store.data.seen ??= {});
  return {
    ids: (device) => (device ? [...(seen[device] ?? [])] : []),
    add(device, ids) {
      if (!device || !ids.length) return;
      const merged = [...(seen[device] ?? []).filter((id) => !ids.includes(id)), ...ids].slice(-MAX_PER_DEVICE);
      delete seen[device]; // 다시 넣어서 가장 최근 기기로 만든다
      seen[device] = merged;
      const keys = Object.keys(seen);
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_DEVICES))) delete seen[k];
      store.save();
    },
  };
}
