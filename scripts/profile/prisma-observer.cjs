/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node preload, never loaded in production. */
const fs = require('node:fs');
const Module = require('node:module');
const load = Module._load;
const wrappers = new WeakMap();
let created = 0;
let queries = 0;
Module._load = function (id, ...args) {
  const value = load.call(this, id, ...args);
  if (!/^(@prisma\/client|\.prisma\/client)(\/|$)/.test(id) || !value?.PrismaClient) return value;
  const ctor = value.PrismaClient;
  if (!wrappers.has(ctor)) {
    const wrapper = new Proxy(ctor, { construct(original, [options = {}]) {
      const client = new original({ ...options, log: [...(options.log || []), { emit: 'event', level: 'query' }] });
      created++;
      client.$on('query', () => { queries++; });
      return client;
    } });
    wrappers.set(ctor, wrapper);
    wrappers.set(wrapper, wrapper);
  }
  return { ...value, PrismaClient: wrappers.get(ctor) };
};
function sample() {
  const m = process.memoryUsage();
  const data = { time: Date.now(), pid: process.pid, created, queries, ...m,
    cgroup: Number(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8')) };
  fs.writeFileSync('/metrics/.current', JSON.stringify(data));
  fs.renameSync('/metrics/.current', '/metrics/current');
}
setInterval(sample, 80).unref();
