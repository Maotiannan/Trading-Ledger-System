import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as equal } from 'node:util';

const root = realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const label = 'org.opencontainers.image.version';
const project = 'trading-ledger-system';
const sha = /^sha256:[a-f0-9]{64}$/;
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function docker(args, json = false) {
  // No ambient Compose or site variables may override the explicitly selected env file.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'DOCKER_CONFIG', 'DOCKER_HOST', 'DOCKER_CONTEXT']
    .filter(k => process.env[k]).map(k => [k, process.env[k]]));
  const result = spawnSync('docker', args, { cwd: root, env, encoding: 'utf8' });
  // Resolved Compose output and inspect data may contain credentials.
  insist(result.status === 0, 'Docker ' + args[0] + ' failed (exit ' + result.status + '); inspect this stage privately.');
  return json ? JSON.parse(result.stdout) : result.stdout.trim();
}

export function compareReleaseConfigs(current, next, sourceRoot) {
  const left = structuredClone(current), right = structuredClone(next);
  for (const cfg of [left, right]) {
    const app = cfg.services.app;
    insist(cfg.name === project && sha.test(app.image), 'Project or fixed image differs from release policy');
    insist(equal(app.command, ['node', 'server.js']), 'App must start without migrations');
    insist(/^\d+\.\d+\.\d+$/.test(app.labels?.[label]), 'Missing release version label');
    insist(app.build?.context, 'Missing app build context');
  }
  insist(right.services.app.build.context === sourceRoot, 'Candidate build context is not the main checkout');
  const fields = { image: a => a.image, 'build.context': a => a.build.context, [label]: a => a.labels[label] };
  const changed = Object.keys(fields).filter(key => fields[key](left.services.app) !== fields[key](right.services.app));
  for (const cfg of [left, right]) {
    delete cfg.services.app.image;
    delete cfg.services.app.build.context;
    delete cfg.services.app.labels[label];
  }
  insist(equal(left, right), 'Resolved site configuration differs beyond the app image, version or build context');
  return changed;
}

export function verifyRuntime(app, running, cfg, imageEnv) {
  const parseEnv = entries => Object.fromEntries(entries.map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
  const mounts = running.Mounts.map(m => [m.Type, m.Type === 'volume' ? m.Name : m.Source, m.Destination, m.RW]).sort();
  const expectedMounts = (app.volumes || []).map(m => [m.type, m.type === 'volume' ? cfg.volumes[m.source].name : m.source, m.target, !m.read_only]).sort();
  const networks = Object.keys(app.networks).map(n => cfg.networks[n].name).sort();
  insist(running.State.Running && running.Image === app.image && running.Config.Labels[label] === app.labels[label] &&
    equal(running.Config.Cmd, app.command) && app.restart === running.HostConfig.RestartPolicy.Name, 'Live app image, version, command or restart policy drift');
  insist(equal(parseEnv(running.Config.Env), { ...parseEnv(imageEnv), ...app.environment }), 'Live application environment drift');
  insist(equal(mounts, expectedMounts) && equal(Object.keys(running.NetworkSettings.Networks).sort(), networks), 'Live mounts or networks differ');
  insist(!app.ports?.length && !Object.keys(running.HostConfig.PortBindings ?? {}).length, 'Unexpected app port publishing');
}

function check(envFile, override) {
  const ids = docker(['ps', '-q', '--filter', 'label=com.docker.compose.project=' + project, '--filter', 'label=com.docker.compose.service=app']).split(/\s+/);
  insist(ids.length === 1 && ids[0], 'Expected one running app');
  const [running] = docker(['inspect', ids[0]], true);
  const labels = running.Config.Labels;
  const cwd = labels['com.docker.compose.project.working_dir'];
  const files = labels['com.docker.compose.project.config_files'].split(',');
  const render = (dir, list) => docker(['compose', '--project-directory', dir, '--env-file', realpathSync(envFile),
    '-p', project, ...list.flatMap(f => ['-f', f]), 'config', '--format', 'json'], true);
  const current = render(cwd, files), next = render(root, [path.join(root, 'docker-compose.yml'), realpathSync(override)]);
  const changed = compareReleaseConfigs(current, next, root);
  const app = current.services.app;
  verifyRuntime(app, running, current, docker(['image', 'inspect', '--format', '{{json .Config.Env}}', running.Image], true));
  insist(docker(['image', 'inspect', '--format', '{{.Id}}', next.services.app.image]) === next.services.app.image, 'Candidate image is not present locally');
  return { changed, services: Object.keys(current.services), currentFiles: files.length, candidateFiles: 2,
    oldConfigSha256: digest(current), newConfigSha256: digest(next), appEnvironmentKeysChecked: Object.keys(app.environment).length,
    currentImage: app.image, candidateImage: next.services.app.image, currentVersion: app.labels[label], candidateVersion: next.services.app.labels[label] };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    insist(process.argv.length === 4, 'Usage: node scripts/check-site-compose.mjs ENV_FILE SITE_OVERRIDE');
    console.log(JSON.stringify(check(process.argv[2], process.argv[3]), null, 2));
  } catch (err) { console.error('[site-preflight] ' + err.message); process.exitCode = 1; }
}
