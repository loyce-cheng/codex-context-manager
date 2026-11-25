import {compareVersions} from '../packaging/install-workflow.mjs';

export function adapterCompatibilityIssue({extension, processes, renderer}, bundledVersion, profiles) {
  const version = extension.version ?? '';
  const stable = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
  if (!/^0\.1\.0-beta\.[1-9]\d*$/.test(version) &&
      !(stable.test(version) && compareVersions(version, '0.1.0') >= 0)) return null;
  const live = renderer?.version === version ? renderer : null;
  if (live?.status === 'unsupported') return 'INSTALLED_ADAPTER_DOES_NOT_MATCH_APP';
  for (const {appVersion} of processes) {
    if (live?.diagnostics?.profile === appVersion) continue;
    if (version === bundledVersion && profiles.some(profile => profile.appVersion === appVersion)) continue;
    return 'INSTALLED_ADAPTER_COMPATIBILITY_UNVERIFIED';
  }
  return null;
}
