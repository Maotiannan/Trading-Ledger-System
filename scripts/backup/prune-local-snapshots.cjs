/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS entry point for the backup runner. */
const fs = require('node:fs');
const path = require('node:path');

const entries = (directory) => fs.readdirSync(directory, { withFileTypes: true });
const busy = (error) => ['EBUSY', 'ENOTEMPTY', 'EEXIST'].includes(error.code);

// An earlier find -delete may have changed the mtime and left only SMB tombstones.
function isRetiredShell(directory, top = true) {
  return entries(directory).every((item) =>
    (item.isFile() && item.name.startsWith('.smbdelete')) ||
    (top && item.isDirectory() && ['database', 'media'].includes(item.name) &&
      isRetiredShell(path.join(directory, item.name), false)));
}

function removeRetired(directory) {
  for (const item of entries(directory)) {
    if (item.name.startsWith('.smbdelete')) continue; // owned by the SMB client until close
    const child = path.join(directory, item.name);
    try {
      if (item.isDirectory()) removeRetired(child);
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
  let pending = false;
  let failed = false;
  function scan(parent, parts) {
    for (const item of entries(parent)) {
      if (!item.isDirectory()) continue;
      const dir = path.join(parent, item.name);
      if (parts.length < 3) {
        const pattern = [/^\d{4}$/, /^(0[1-9]|1[0-2])$/, /^(0[1-9]|[12]\d|3[01])$/][parts.length];
        if (pattern.test(item.name)) scan(dir, [...parts, item.name]);
        continue;
      }
      const match = /^(\.retiring-)?muledger-(\d{8})-\d{6}$/.exec(item.name);
      if (!match || match[2] !== parts.join('') || dir === published ||
          !(Date.parse(parts.join('-') + 'T00:00:00') <= cutoff)) continue;
      try {
        let target = dir;
        if (!match[1]) {
          if (fs.lstatSync(dir).mtimeMs > cutoff && !isRetiredShell(dir)) continue;
          target = path.join(parent, '.retiring-' + item.name);
          if (fs.lstatSync(target, { throwIfNoEntry: false })) throw new Error('retirement target already exists');
          fs.renameSync(dir, target);
        }
        removeRetired(target);
        console.error('Removed expired snapshot: ' + path.relative(root, dir));
      } catch (error) {
        if (busy(error)) {
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
  return failed ? 1 : pending ? 75 : 0;
}

try {
  process.exitCode = prune(process.argv[2], process.argv[3], Number(process.argv[4]));
} catch (error) {
  console.error('ERROR: snapshot retention: ' + error.message);
  process.exitCode = 1;
}
