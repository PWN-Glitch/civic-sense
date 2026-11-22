import { assertSecureTransport } from '../src/api/client';
import {
  NETWORK_SECURITY_CONFIG,
  RELEASE_MANIFEST,
  RELEASE_URL_CHECK,
} from '../plugins/withCleartextTraffic';

describe('release transport policy', () => {
  it('release builds refuse every plain-HTTP API URL, private networks included', () => {
    for (const url of [
      'http://civic.example.org',
      'http://192.168.1.20:8000',
      'http://100.100.1.2:8001',
      'http://devbox.local:8000',
      'http://10.0.2.2:8000',
      'http://127.0.0.1:8000',
    ]) {
      expect(() => assertSecureTransport(url, false)).toThrow(/https/);
    }
  });

  it('release builds accept HTTPS', () => {
    expect(() => assertSecureTransport('https://civic.example.org', false)).not.toThrow();
  });

  it('debug builds keep local HTTP', () => {
    expect(() => assertSecureTransport('http://10.0.2.2:8000', true)).not.toThrow();
    expect(() => assertSecureTransport('http://192.168.1.20:8000', true)).not.toThrow();
  });

  it('the release network config permits no cleartext host at all', () => {
    expect(NETWORK_SECURITY_CONFIG).toContain('<base-config cleartextTrafficPermitted="false" />');
    expect(NETWORK_SECURITY_CONFIG).not.toContain('domain-config');
    expect(NETWORK_SECURITY_CONFIG).not.toMatch(/cleartextTrafficPermitted="true"/);
    expect(RELEASE_MANIFEST).toContain('android:networkSecurityConfig="@xml/network_security_config"');
  });

  it('the Gradle URL check gates release builds only and demands https with a host', () => {
    expect(RELEASE_URL_CHECK).toContain('it.name == "preReleaseBuild"');
    expect(RELEASE_URL_CHECK).not.toMatch(/Debug/);
    expect(RELEASE_URL_CHECK).toContain('uri.scheme != "https" || !uri.host');
    // Same source of truth as the bundler: shell env, then .env files.
    expect(RELEASE_URL_CHECK).toContain("require('@expo/env').load");
  });
});
