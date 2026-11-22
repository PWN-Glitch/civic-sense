const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
} = require('expo/config-plugins');

/**
 * Release builds talk to the API over HTTPS only: the session token must never
 * cross any network, LAN included, in cleartext. Debug builds are untouched and
 * keep the template's blanket cleartext for Metro and a local HTTP server.
 *
 * Prebuild can't tell a debug build from a release one, so the URL check runs
 * in Gradle's preReleaseBuild. It reads EXPO_PUBLIC_API_URL the way the
 * release bundle does (shell first, then .env files) and fails the build
 * unless it is an https:// URL with a host.
 */

const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
</network-security-config>
`;

const GRADLE_MARKER = '// @generated civicsense-release-https';

const RELEASE_URL_CHECK = `
${GRADLE_MARKER}
tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    doFirst {
        def url = ["node", "-e",
            "process.env.NODE_ENV='production';require('@expo/env').load(process.argv[1],{silent:true});process.stdout.write(process.env.EXPO_PUBLIC_API_URL||'')",
            projectRoot].execute(null, rootDir).text.trim()
        def uri = null
        try { uri = url ? new URI(url) : null } catch (URISyntaxException ignored) {}
        if (uri == null || uri.scheme != "https" || !uri.host) {
            throw new GradleException("Release builds need EXPO_PUBLIC_API_URL set to an https:// URL, got '\${url}'.")
        }
    }
}
`;

const RELEASE_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:networkSecurityConfig="@xml/network_security_config" />
</manifest>
`;

function withReleaseTransport(config) {
  config = withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes(GRADLE_MARKER)) {
      config.modResults.contents += RELEASE_URL_CHECK;
    }
    return config;
  });
  // Earlier versions of this plugin set it to true on the main manifest; prebuild keeps old attributes.
  config = withAndroidManifest(config, (config) => {
    delete config.modResults.manifest.application[0].$['android:usesCleartextTraffic'];
    return config;
  });
  return withDangerousMod(config, [
    'android',
    (config) => {
      const release = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'release');
      fs.mkdirSync(path.join(release, 'res', 'xml'), { recursive: true });
      fs.writeFileSync(path.join(release, 'AndroidManifest.xml'), RELEASE_MANIFEST);
      fs.writeFileSync(
        path.join(release, 'res', 'xml', 'network_security_config.xml'),
        NETWORK_SECURITY_CONFIG,
      );
      return config;
    },
  ]);
}

module.exports = withReleaseTransport;
module.exports.NETWORK_SECURITY_CONFIG = NETWORK_SECURITY_CONFIG;
module.exports.RELEASE_MANIFEST = RELEASE_MANIFEST;
module.exports.RELEASE_URL_CHECK = RELEASE_URL_CHECK;
