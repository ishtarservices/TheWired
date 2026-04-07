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
const VERSION = '0.1.0';

export type DownloadLink = {
  os: string;
  label: string;
  fileName: string;
  url: string;
  primary?: boolean;
};

export function getDownloadLinks(detectedOs: Platform['os']): DownloadLink[] {
  const base = `https://github.com/${REPO}/releases/download/v${VERSION}`;

  const allLinks: DownloadLink[] = [
    {
      os: 'macos',
      label: 'macOS (Apple Silicon)',
      fileName: `TheWired_${VERSION}_aarch64.dmg`,
      url: `${base}/TheWired_${VERSION}_aarch64.dmg`,
    },
    {
      os: 'macos-intel',
      label: 'macOS (Intel)',
      fileName: `TheWired_${VERSION}_x64.dmg`,
      url: `${base}/TheWired_${VERSION}_x64.dmg`,
    },
    {
      os: 'windows',
      label: 'Windows',
      fileName: `TheWired_${VERSION}_x64-setup.exe`,
      url: `${base}/TheWired_${VERSION}_x64-setup.exe`,
    },
    {
      os: 'linux',
      label: 'Linux (.AppImage)',
      fileName: `TheWired_${VERSION}_amd64.AppImage`,
      url: `${base}/TheWired_${VERSION}_amd64.AppImage`,
    },
    {
      os: 'linux-deb',
      label: 'Linux (.deb)',
      fileName: `TheWired_${VERSION}_amd64.deb`,
      url: `${base}/TheWired_${VERSION}_amd64.deb`,
    },
  ];

  // Mark the detected OS as primary
  return allLinks.map((link) => ({
    ...link,
    primary: link.os === detectedOs || (detectedOs === 'linux' && link.os === 'linux'),
  }));
}
