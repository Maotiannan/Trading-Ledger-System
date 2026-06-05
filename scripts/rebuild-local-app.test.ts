import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('local rebuild script safety contract', () => {
  const scriptPath = path.join(process.cwd(), 'scripts', 'rebuild-local-app.sh');

  it('rebuilds only the app service and refreshes maintenance without destructive Docker commands', () => {
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('docker compose up -d --no-deps --build app');
    expect(script).toContain('docker compose up -d --no-deps --force-recreate maintenance');
    expect(script).toContain('MAINTENANCE_JOB_TOKEN');
    expect(script).toContain('SESSION_SECRET');
    expect(script).toContain('/api/system/health');
    expect(script).not.toMatch(/docker\s+compose\s+down\s+-v/);
    expect(script).not.toMatch(/docker\s+volume\s+rm/);
    expect(script).not.toMatch(/rm\s+-rf\s+\$?\{?UPLOAD/i);
  });
});
