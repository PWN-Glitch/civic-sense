import { absoluteMediaUrl, getApiUrl } from '../src/api/client';

describe('getApiUrl', () => {
  const saved = process.env.EXPO_PUBLIC_API_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = saved;
  });

  it('uses EXPO_PUBLIC_API_URL when set', () => {
    process.env.EXPO_PUBLIC_API_URL = 'http://192.0.2.10:8000';
    expect(getApiUrl()).toBe('http://192.0.2.10:8000');
  });

  it('falls back to the emulator host when unset or empty', () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    expect(getApiUrl()).toBe('http://10.0.2.2:8000');
    process.env.EXPO_PUBLIC_API_URL = '';
    expect(getApiUrl()).toBe('http://10.0.2.2:8000');
  });
});

describe('absoluteMediaUrl', () => {
  it('prefixes the API base onto server-relative media paths', () => {
    const url = absoluteMediaUrl('/media/abc.jpg');
    expect(url.startsWith('http')).toBe(true);
    expect(url.endsWith('/media/abc.jpg')).toBe(true);
    expect(url).not.toMatch(/\/\/media/);
  });

  it('leaves absolute and local URIs alone', () => {
    expect(absoluteMediaUrl('https://cdn.example.com/a.jpg')).toBe(
      'https://cdn.example.com/a.jpg',
    );
    expect(absoluteMediaUrl('file:///data/user/0/x/a.jpg')).toBe(
      'file:///data/user/0/x/a.jpg',
    );
    expect(absoluteMediaUrl('')).toBe('');
  });
});
