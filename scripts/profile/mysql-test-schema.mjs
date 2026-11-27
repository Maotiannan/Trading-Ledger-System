import { readFileSync } from 'node:fs';

// MySQL 8 needs parentheses around TEXT default expressions; MariaDB accepts both.
const sql = readFileSync(0, 'utf8');
const legacy = /(`tokens` TEXT NOT NULL DEFAULT )'\[\]'/g;
if ([...sql.matchAll(legacy)].length !== 2) throw new Error('Review isolated MySQL TEXT default adapter');
process.stdout.write(sql.replace(legacy, "$1('[]')"));
