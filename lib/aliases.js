const aliases = {
  darwin: ['mac', 'macos', 'osx'],
  exe: ['win32', 'windows', 'win'],
  deb: ['debian'],
  rpm: ['fedora'],
  AppImage: ['appimage'],
  dmg: ['dmg'],
  nupkg: ['nupkg']
}

// Create arm64 variants for all platforms
for (const existingPlatform of Object.keys(aliases)) {
  const newPlatform = existingPlatform + '_arm64';
  aliases[newPlatform] = aliases[existingPlatform].map(alias => `${alias}_arm64`);
}

// Create x64 variants for darwin and exe (for explicit x64 requests)
aliases['darwin_x64'] = ['mac_x64', 'macos_x64', 'osx_x64', 'darwin_x86', 'mac_x86', 'macos_x86', 'osx_x86'];
aliases['exe_x64'] = ['win32_x64', 'windows_x64', 'win_x64', 'win32_x86', 'windows_x86', 'win_x86'];
aliases['dmg_x64'] = ['dmg_x86'];

// Helper to detect architecture from platform string
const detectArch = (platform) => {
  if (platform.includes('_arm64') || platform.includes('_aarch64')) {
    return 'arm64';
  }
  if (platform.includes('_x64') || platform.includes('_x86')) {
    return 'x64';
  }
  return null; // No architecture specified
};

// Helper to check if platform matches darwin variants
const isDarwin = (platform) => {
  const basePlatform = platform.replace(/_arm64|_aarch64|_x64|_x86/g, '');
  return basePlatform === 'darwin' || aliases['darwin'].includes(basePlatform);
};

// Helper to check if platform matches windows/exe variants
const isWindows = (platform) => {
  const basePlatform = platform.replace(/_arm64|_aarch64|_x64|_x86/g, '');
  return basePlatform === 'exe' || aliases['exe'].includes(basePlatform);
};

// Helper to check if platform matches dmg variants
const isDmg = (platform) => {
  const basePlatform = platform.replace(/_arm64|_aarch64|_x64|_x86/g, '');
  return basePlatform === 'dmg' || aliases['dmg'].includes(basePlatform);
};

module.exports = platform => {
  const arch = detectArch(platform);

  // Handle darwin platforms - default to arm64 if no arch specified
  if (isDarwin(platform)) {
    if (arch === 'x64') {
      return 'darwin'; // Explicit x64 request
    }
    return 'darwin_arm64'; // Default to arm64, or explicit arm64 request
  }

  // Handle dmg platforms - default to arm64 if no arch specified
  if (isDmg(platform)) {
    if (arch === 'x64') {
      return 'dmg'; // Explicit x64 request
    }
    return 'dmg_arm64'; // Default to arm64, or explicit arm64 request
  }

  // Handle windows platforms - default to x86 if no arch specified
  if (isWindows(platform)) {
    if (arch === 'arm64') {
      return 'exe_arm64'; // Explicit arm64 request
    }
    return 'exe'; // Default to x86, or explicit x64 request
  }

  // Check if it's a direct platform match
  if (typeof aliases[platform] !== 'undefined') {
    return platform;
  }

  // Check against all aliases
  for (const guess of Object.keys(aliases)) {
    const list = aliases[guess];

    if (list.includes(platform)) {
      return guess;
    }
  }

  return false;
}
