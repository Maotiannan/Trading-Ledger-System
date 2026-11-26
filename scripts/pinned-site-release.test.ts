/** @jest-environment node */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

it('allows only fixed image/version/source changes; refuses service, environment or storage drift', () => {
  const helper = path.join(process.cwd(), 'scripts/check-site-compose.mjs');
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const {compareReleaseConfigs,verifyRuntime}=await import(process.env.SITE_TEST_HELPER);
    const label='org.opencontainers.image.version';
    const app={image:'sha256:'+'a'.repeat(64),command:['node','server.js'],labels:{[label]:'1.0.1'},
      build:{context:'/main'},restart:'unless-stopped',environment:{TOKEN:'synthetic'},networks:{default:{}},
      volumes:[{type:'bind',source:'/isolated',target:'/app/upload'}]};
    const original={name:'trading-ledger-system',services:{app,maintenance:{restart:'unless-stopped'}},networks:{default:{name:'isolated'}}};
    const current=structuredClone(original);current.services.app.build.context='/frozen';
    assert.deepEqual(compareReleaseConfigs(current,original,'/main'),['build.context']);
    for(const mutate of [c=>c.services.app.command=['migrate'],c=>c.services.app.environment.TOKEN='different',
      c=>c.services.app.image='latest',c=>c.services.app.volumes[0].source='/other',c=>delete c.services.maintenance,
      c=>c.services.app.build.context='/other']){
      const bad=structuredClone(original);mutate(bad);assert.throws(()=>compareReleaseConfigs(current,bad,'/main'));
    }
    const live={State:{Running:true}, Image:app.image, Config:{Labels:app.labels,Env:['TOKEN=synthetic','NODE_ENV=production'],Cmd:app.command},
      HostConfig:{RestartPolicy:{Name:app.restart},PortBindings:{}},NetworkSettings:{Networks:{isolated:{}}},
      Mounts:[{Type:'bind',Source:'/isolated',Destination:'/app/upload',RW:true}]};
    verifyRuntime(app,live,original,['NODE_ENV=production']);
    for(const mutate of [r=>r.Config.Env.push('UNEXPECTED=x'),r=>r.Mounts[0].RW=false,
      r=>r.NetworkSettings.Networks={extra:{}},r=>r.HostConfig.PortBindings={extra:[]},r=>r.Image='different']){
      const drift=structuredClone(live);mutate(drift);assert.throws(()=>verifyRuntime(app,drift,original,['NODE_ENV=production']));
    }
  `], { env: { ...process.env, SITE_TEST_HELPER: helper } });
});

it('never applies legacy or unregistered sites; adopted sites only recreate app and support explicit rollback', () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'muledger-pin-')));
  const dir = path.join(root, 'out/site-releases');
  const override = (v: string) => path.join(dir, v, 'site.override.json');
  try {
    mkdirSync(path.join(root, 'scripts'));
    copyFileSync(path.join(process.cwd(), 'scripts/rebuild-local-app.sh'), path.join(root, 'scripts/rebuild-local-app.sh'));
    for (const v of ['1.0.1', '1.0.2']) {
      mkdirSync(path.dirname(override(v)), { recursive: true });
      writeFileSync(override(v), '{}');
    }
    writeFileSync(path.join(dir, 'site.env'), '');
    writeFileSync(path.join(root, 'state'), '1.0.1');
    writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.2"}');
    writeFileSync(path.join(root, 'scripts/check-site-compose.mjs'), `import fs from 'node:fs';import path from 'node:path';
      const old=fs.readFileSync('state','utf8'),v=path.basename(path.dirname(process.argv[3]));
      console.log(JSON.stringify({currentVersion:old,candidateVersion:v,currentImage:old,candidateImage:v}));`);
    const docker = path.join(root, 'docker');
    writeFileSync(docker, `#!/bin/sh
set -eu
echo "$*" >> calls
v=$(cat state)
case "$1" in
 ps) echo fake;;
 inspect) case "$*" in *working_dir*) pwd;; *config_files*) echo "$PWD/docker-compose.yml,$PWD/out/site-releases/$v/site.override.json";; *) exit 33;; esac;;
 exec) case "$*" in *"-p "*) echo "$v";; *) exit 0;; esac;;
 compose) case "$*" in *"up -d --no-deps --no-build --pull never app") while [ "$1" != up ]; do case "$1" in */site.override.json) new=$(basename "$(dirname "$1")");; esac; shift; done; printf %s "$new" > state;; *"ps -q app") echo fake;; *) exit 34;; esac;;
 *) exit 35;;
esac\n`);
    chmodSync(docker, 0o700);
    const run = (...args: string[]) => spawnSync('bash', ['scripts/rebuild-local-app.sh', ...args], {
      cwd: root, encoding: 'utf8', env: { NODE_ENV: 'test', HOME: root, PATH: root + ':' + process.env.PATH },
    }).status;
    expect(run('--check-only')).toBe(0);
    expect(run()).toBe(1);
    expect(run('--release', path.join(root, 'other.json'))).toBe(1);
    expect(run('--rollback', override('1.0.2'))).toBe(1);
    expect(readFileSync(path.join(root, 'calls'), 'utf8')).not.toContain('up -d');
    expect(run('--release', override('1.0.2'))).toBe(0);
    expect(run('--release', override('1.0.2'))).toBe(0);
    expect(run('--rollback', override('1.0.1'))).toBe(0);
    expect(readFileSync(path.join(root, 'state'), 'utf8')).toBe('1.0.1');
    expect(readFileSync(path.join(root, 'calls'), 'utf8').split('\n').filter(s => s.includes('up -d'))).toHaveLength(2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
