/**
 * electron-builder afterSign hook: give the macOS app an ad-hoc signature.
 *
 * Without an Apple Developer ID nothing signs the bundle, and renaming and
 * re-packaging Electron leaves its original signature broken. macOS then calls
 * a downloaded copy "damaged" and offers no way to open it. A valid ad-hoc
 * signature turns that into the ordinary "Apple could not verify…" prompt,
 * which people can get past once with System Settings → Privacy & Security →
 * Open Anyway. Replace this with real signing and notarization if a Developer
 * ID is ever available (set mac.identity and remove this hook).
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
};
