import { readFileSync } from 'node:fs';
import path from 'node:path';

function serviceBlock(compose: string, serviceName: string): string {
  const escaped = serviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = compose.match(new RegExp(`^  ${escaped}:\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:|^volumes:|^networks:|\\Z)`, 'm'));
  if (!match) throw new Error(`Missing Compose service: ${serviceName}`);
  return match[0];
}

describe('MU Contract synchronization runtime contract', () => {
  const root = process.cwd();
  const compose = readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  const envExample = readFileSync(path.join(root, '.env.example'), 'utf8');
  const app = serviceBlock(compose, 'app');

  it('passes source credentials only to the application service', () => {
    const trigger = serviceBlock(compose, 'mucontract-sync-trigger');

    expect(app).toContain('MU_CONTRACT_SYNC_BASE_URL');
    expect(app).toContain('MU_CONTRACT_SYNC_TOKEN');
    expect(trigger).not.toContain('MU_CONTRACT_SYNC_BASE_URL');
    expect(trigger).not.toContain('MU_CONTRACT_SYNC_TOKEN');
    expect(envExample).toMatch(/^MU_CONTRACT_SYNC_BASE_URL=""$/m);
    expect(envExample).toMatch(/^MU_CONTRACT_SYNC_TOKEN=""$/m);
  });

  it('uses the existing maintenance token to call only the protected internal pull API', () => {
    const trigger = serviceBlock(compose, 'mucontract-sync-trigger');

    expect(trigger).toContain('MAINTENANCE_JOB_TOKEN');
    expect(trigger).toContain('/api/internal/integrations/mu-contract/pull');
    expect(trigger).toContain('x-maintenance-token');
    expect(trigger).toContain('x-maintenance-token: $$MAINTENANCE_JOB_TOKEN" >/dev/null');
    expect(trigger).not.toMatch(/\/api\/integrations\/mu-contract\/actions/);
  });
});
