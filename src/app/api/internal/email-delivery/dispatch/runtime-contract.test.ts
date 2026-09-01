import { readFileSync } from 'node:fs';
import path from 'node:path';

import { apiCatalog, configTemplate } from '@/lib/api-catalog';

function serviceBlock(compose: string, serviceName: string): string {
  const escaped = serviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = compose.match(new RegExp(`^  ${escaped}:\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:|^volumes:|^networks:|(?![\\s\\S]))`, 'm'));
  if (!match) throw new Error(`Missing Compose service: ${serviceName}`);
  return match[0];
}

describe('approved email delivery runtime contract', () => {
  const root = process.cwd();
  const compose = readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  const envExample = readFileSync(path.join(root, '.env.example'), 'utf8');
  const app = serviceBlock(compose, 'app');

  it('passes Resend credentials only to the application service', () => {
    const trigger = serviceBlock(compose, 'email-delivery-trigger');

    expect(app).toContain('RESEND_API_KEY');
    expect(app).toContain('RESEND_WEBHOOK_SECRET');
    expect(trigger).not.toContain('RESEND_API_KEY');
    expect(trigger).not.toContain('RESEND_WEBHOOK_SECRET');
    expect(envExample).toMatch(/^RESEND_API_KEY=""$/m);
    expect(envExample).toMatch(/^RESEND_WEBHOOK_SECRET=""$/m);
  });

  it('uses the maintenance token and bounded delivery configuration only', () => {
    const trigger = serviceBlock(compose, 'email-delivery-trigger');

    expect(trigger).toContain('curlimages/curl:8.12.1');
    expect(trigger).toContain('MAINTENANCE_BASE_URL');
    expect(trigger).toContain('MAINTENANCE_JOB_TOKEN');
    expect(trigger).toContain('EMAIL_DELIVERY_BATCH_SIZE');
    expect(trigger).toContain('EMAIL_DELIVERY_LOOP_SECONDS');
    expect(trigger).toContain('/api/internal/email-delivery/dispatch');
    expect(trigger).toContain('x-maintenance-token');
    expect(trigger).toContain('x-email-delivery-batch-size');
  });

  it('catalogs the routes and all deployment configuration keys', () => {
    expect(apiCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpoint: '/api/internal/email-delivery/dispatch' }),
      expect.objectContaining({ endpoint: '/api/webhooks/resend' }),
    ]));
    expect(configTemplate.optional).toEqual(expect.arrayContaining([
      'RESEND_API_KEY',
      'RESEND_WEBHOOK_SECRET',
      'EMAIL_DELIVERY_BATCH_SIZE',
      'EMAIL_DELIVERY_LOOP_SECONDS',
    ]));
  });
});
