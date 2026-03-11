import packageJson from '../../package.json';

export const APP_VERSION = packageJson.version.startsWith('v')
  ? packageJson.version
  : `v${packageJson.version}`;
