export type Platform = {
  os: 'macos' | 'windows' | 'linux' | 'unknown';
  arch: 'aarch64' | 'x64';
  label: string;
};

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') {
    return { os: 'unknown', arch: 'x64', label: 'your platform' };
  }

  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator.platform || '').toLowerCase();

  // macOS detection
  if (ua.includes('mac') || platform.includes('mac')) {
    // Detect Apple Silicon vs Intel
    // navigator.userAgentData is available in Chromium browsers
    const uaData = (navigator as any).userAgentData;
    if (uaData?.architecture === 'arm') {
      return { os: 'macos', arch: 'aarch64', label: 'macOS (Apple Silicon)' };
    }
    // Default to Apple Silicon as it's the majority of modern Macs
    return { os: 'macos', arch: 'aarch64', label: 'macOS' };
  }

  // Windows detection
  if (ua.includes('windows') || ua.includes('win64') || ua.includes('win32') || platform.includes('win')) {
    return { os: 'windows', arch: 'x64', label: 'Windows' };
  }

  // Linux detection
  if (ua.includes('linux') || platform.includes('linux')) {
    return { os: 'linux', arch: 'x64', label: 'Linux' };
  }

  return { os: 'unknown', arch: 'x64', label: 'your platform' };
}

const REPO = 'IshtarServices/TheWired';

export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

export type DownloadLink = {
  os: string;
  label: string;
  fileName: string;
  url: string;
  primary?: boolean;
};

export type ReleaseInfo = {
  version: string;
  links: DownloadLink[];
};

const ASSET_MATCHERS: { os: string; label: string; pattern: RegExp }[] = [
  { os: 'macos', label: 'macOS (Apple Silicon)', pattern: /aarch64\.dmg$/ },
  { os: 'macos-intel', label: 'macOS (Intel)', pattern: /_x64\.dmg$/ },
  { os: 'windows', label: 'Windows', pattern: /x64-setup\.exe$/ },
  { os: 'linux', label: 'Linux (.AppImage)', pattern: /\.AppImage$/ },
  { os: 'linux-deb', label: 'Linux (.deb)', pattern: /\.deb$/ },
];

export async function fetchLatestRelease(detectedOs: Platform['os']): Promise<ReleaseInfo> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

  const release = await res.json();
  const version = (release.tag_name as string).replace(/^v/, '');
  const assets: { name: string; browser_download_url: string }[] = release.assets;

  const links: DownloadLink[] = [];
  for (const { os, label, pattern } of ASSET_MATCHERS) {
    const asset = assets.find((a: { name: string }) => pattern.test(a.name));
    if (!asset) continue;
    links.push({
      os,
      label,
      fileName: asset.name,
      url: asset.browser_download_url,
      primary: os === detectedOs || (detectedOs === 'linux' && os === 'linux'),
    });
  }

  return { version, links };
}
