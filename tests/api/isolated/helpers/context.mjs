import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function firstSetCookieValue(header) {
  const [cookie] = String(header || '').split(';');
  const index = cookie.indexOf('=');
  if (index <= 0) return null;
  return {
    name: cookie.slice(0, index),
    value: cookie.slice(index + 1),
  };
}

export class ApiTestContext {
  constructor() {
    this.baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3100';
    this.adminEmail = process.env.INIT_ADMIN_EMAIL || 'admin@example.com';
    this.adminPassword = process.env.INIT_ADMIN_PASSWORD || 'Admin@2026!';
    this.initToken = process.env.INIT_ADMIN_TOKEN || 'test-init-token';
    this.cookies = new Map();
    this.currentCase = 'bootstrap';
    this.tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tls-api-cases-'));
  }

  setCase(name) {
    this.currentCase = name;
    console.log(`\n[CASE] ${name}`);
  }

  destroy() {
    rmSync(this.tmpDir, { recursive: true, force: true });
  }

  step(message) {
    console.log(`[PASS] ${this.currentCase}: ${message}`);
  }

  unique(prefix = 'qa') {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  cookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  updateCookies(response) {
    const headers = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
    for (const header of headers) {
      const parsed = firstSetCookieValue(header);
      if (!parsed) continue;
      this.cookies.set(parsed.name, parsed.value);
    }
  }

  async request(method, route, options = {}) {
    const url = new URL(route, this.baseUrl);
    const headers = new Headers(options.headers || {});
    if (this.cookies.size > 0) {
      headers.set('cookie', this.cookieHeader());
    }

    let body;
    if (options.json !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(options.json);
    } else if (options.form) {
      const form = new FormData();
      for (const [key, value] of Object.entries(options.form)) {
        if (value && typeof value === 'object' && 'filePath' in value) {
          const fileBuffer = readFileSync(value.filePath);
          const blob = new Blob([fileBuffer], { type: value.contentType || 'application/octet-stream' });
          form.append(key, blob, value.filename || path.basename(value.filePath));
        } else if (value !== undefined && value !== null) {
          form.append(key, String(value));
        }
      }
      body = form;
    }

    const response = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'manual',
    });
    this.updateCookies(response);

    const text = await response.text();
    const data = parseJson(text);
    if (options.expectedStatus !== undefined) {
      assert.equal(
        response.status,
        options.expectedStatus,
        `${method} ${route} expected ${options.expectedStatus}, got ${response.status}\n${text}`,
      );
    }

    return {
      status: response.status,
      ok: response.ok,
      text,
      data,
      headers: response.headers,
    };
  }

  async initAdmin() {
    const response = await this.request('POST', '/api/init', {
      headers: { 'x-init-token': this.initToken },
      expectedStatus: 200,
    });
    this.step('init admin');
    return response;
  }

  async resetRateLimits() {
    const response = await this.request('POST', '/api/internal/maintenance/rate-limit', {
      headers: { 'x-init-token': this.initToken },
      expectedStatus: 200,
    });
    this.step('reset rate limits');
    return response;
  }

  async login(email = this.adminEmail, password = this.adminPassword) {
    const response = await this.request('POST', '/api/auth', {
      json: { action: 'login', email, password },
      expectedStatus: 200,
    });
    this.step(`login ${email}`);
    return response;
  }

  async loginAdmin() {
    return this.login(this.adminEmail, this.adminPassword);
  }

  async auth(json, expectedStatus = 200) {
    return this.request('POST', '/api/auth', {
      json,
      expectedStatus,
    });
  }

  async createUser(payload, expectedStatus = 200) {
    return this.auth({
      action: 'create',
      ...payload,
    }, expectedStatus);
  }

  async logout() {
    const response = await this.request('POST', '/api/auth', {
      json: { action: 'logout' },
      expectedStatus: 200,
    });
    this.step('logout');
    return response;
  }

  assertOk(condition, message) {
    assert.ok(condition, message);
    this.step(message);
  }

  assertEqual(actual, expected, message) {
    assert.equal(actual, expected, message);
    this.step(message);
  }

  assertMatch(text, matcher, message) {
    if (typeof matcher === 'string') {
      assert.ok(String(text).includes(matcher), `${message}: expected to include ${matcher}, got ${text}`);
    } else {
      assert.match(String(text), matcher, message);
    }
    this.step(message);
  }

  writeTempFile(name, contents) {
    const filePath = path.join(this.tmpDir, name);
    writeFileSync(filePath, contents);
    return filePath;
  }
}
