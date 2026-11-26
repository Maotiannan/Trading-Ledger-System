/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS entry point for the backup runner. */
const fs = require('node:fs');
const path = require('node:path');

const dateSegments = [/^\d{4}$/, /^(0[1-9]|1[0-2])$/, /^(0[1-9]|[12]\d|3[01])$/];
const busy = (error) => ['EBUSY', 'ENOTEMPTY', 'EEXIST'].includes(error.code);

// An earlier find -delete may have changed the mtime and left only SMB tombstones.
function isRetiredShell(directory, top = true) {
  return fs.readdirSync(directory).every((name) => {
    const child = path.join(directory, name);
    if (name.startsWith('.smbdelete')) return fs.lstatSync(child, { throwIfNoEntry: false })?.isFile();
    return top && ['database', 'media'].includes(name) &&
      fs.lstatSync(child, { throwIfNoEntry: false })?.isDirectory() && isRetiredShell(child, false);
  });
}

function removeRetired(directory) {
  for (const name of fs.readdirSync(directory)) {
    if (name.startsWith('.smbdelete')) continue; // owned by the SMB client until close
    const child = path.join(directory, name);
    try {
      if (fs.lstatSync(child).isDirectory()) removeRetired(child);
      else fs.unlinkSync(child); // includes symlinks; never follow them
    } catch (error) {
      if (error.code !== 'ENOENT' && !busy(error)) throw error;
    }
  }
  fs.rmdirSync(directory);
}

function prune(root, published, days) {
  const day = 86400000;
  const relative = path.relative(root, published);
  if (!Number.isSafeInteger(days) || days < 1 || path.basename(root) !== 'snapshots' ||
      !/^(\d{4})\/(\d{2})\/(\d{2})\/muledger-\1\2\3-\d{6}$/.test(relative) ||
      fs.realpathSync(root) !== root || fs.realpathSync(published) !== published ||
      !fs.lstatSync(path.join(published, 'manifest.json')).isFile()) {
    throw new Error('Invalid retention root, publication or period');
  }
  const cutoff = Date.now() - (days + 1) * day; // same full-day boundary as find -mtime +N
  const local = new Date(cutoff);
  const cutoffDate = [local.getFullYear(), String(local.getMonth() + 1).padStart(2, '0'),
    String(local.getDate()).padStart(2, '0')].join('/');
  const originalRoot = fs.statSync(root);
  function verifyPublication() {
    const currentRoot = fs.statSync(root);
    if (currentRoot.dev !== originalRoot.dev || currentRoot.ino !== originalRoot.ino ||
        fs.realpathSync(published) !== published || !fs.lstatSync(path.join(published, 'manifest.json')).isFile()) {
      throw new Error('Backup mount or published snapshot changed during retention');
    }
  }
  let pending = false;
  let failed = false;
  function scan(parent, parts) {
    const prefix = parts.join('/');
    const limit = cutoffDate.slice(0, prefix.length);
    if (prefix > limit) return; // Entire local year/month/day is protected, even if SMB lists a stale child.
    let children;
    try {
      if (parts.length && !fs.lstatSync(parent).isDirectory()) return;
      // DT_UNKNOWN on SMB makes withFileTypes stat every child before we can filter names.
      children = fs.readdirSync(parent);
    } catch (error) {
      if (error.code !== 'ENOENT' || error.path !== parent || prefix >= limit ||
          published.startsWith(parent + path.sep)) throw error;
      verifyPublication();
      return;
    }
    for (const name of children) {
      const dir = path.join(parent, name);
      if (parts.length < 3) {
        if (dateSegments[parts.length].test(name)) scan(dir, [...parts, name]);
        continue;
      }
      const match = /^(\.retiring-)?muledger-(\d{8})-\d{6}$/.exec(name);
      if (!match || match[2] !== parts.join('') || dir === published ||
          !(Date.parse(parts.join('-') + 'T00:00:00') <= cutoff)) continue;
      try {
        const stat = fs.lstatSync(dir);
        if (!stat.isDirectory()) continue;
        let target = dir;
        if (!match[1]) {
          if (stat.mtimeMs > cutoff && !isRetiredShell(dir)) continue;
          target = path.join(parent, '.retiring-' + name);
          if (fs.lstatSync(target, { throwIfNoEntry: false })) throw new Error('retirement target already exists');
          fs.renameSync(dir, target);
        }
        removeRetired(target);
        console.error('Removed expired snapshot: ' + path.relative(root, dir));
      } catch (error) {
        if (error.code === 'ENOENT' && !fs.lstatSync(dir, { throwIfNoEntry: false }) &&
            !fs.lstatSync(path.join(parent, '.retiring-' + name.replace(/^\.retiring-/, '')), { throwIfNoEntry: false })) {
          verifyPublication();
        } else if (busy(error)) {
          pending = true;
          console.error('WARN: expired snapshot still busy; retry cleanup after next publication: ' + dir);
        } else {
          failed = true;
          console.error('ERROR: unable to retire ' + dir + ': ' + error.message);
        }
      }
    }
  }
  scan(root, []);
  verifyPublication();
  return failed ? 1 : pending ? 75 : 0;
}

try {
  process.exitCode = prune(process.argv[2], process.argv[3], Number(process.argv[4]));
} catch (error) {
  console.error('ERROR: snapshot retention: ' + error.message);
  process.exitCode = 1;
}
