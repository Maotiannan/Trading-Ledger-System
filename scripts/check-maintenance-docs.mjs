// Historical documents stay in Git; active guides must not depend on a retired path.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const retired = /^(?:docs\/(?:superpowers\/(?:plans|specs)\/|backup\/restore-drills\/)|(?:todolist|worklog|ENGINEERING_LOG)\.md$)/;
const files = execFileSync('git', ['ls-files','-z','*.md'],{encoding:'utf8'}).split('\0').filter(Boolean);
const errors=[];
for(const f of files){
  if(retired.test(f)||/^docs\/(?:.*\/)?\d{4}-\d\d-\d\d-.*(?:plan|design|spec)\.md$/.test(f)) errors.push(f);
  const doc=readFileSync(f,'utf8');
  for(const [, url] of doc.matchAll(/\[[^\]\n]*\]\(([^()\s]+)\)/g)){
    if(!url.startsWith('#')&&!/^[a-z]+:/i.test(url)&&retired.test(path.posix.normalize(path.posix.join(path.posix.dirname(f),url.split('#')[0]))))
      errors.push(f+' -> '+url);
  }
}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
