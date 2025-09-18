const aliases = {
  darwin: ['mac', 'macos', 'osx'],
  exe: ['win32', 'windows', 'win'],
  deb: ['debian'],
  rpm: ['fedora'],
  AppImage: ['appimage'],
  dmg: ['dmg'],
  nupkg: ['nupkg']
}

for (const existingPlatform of Object.keys(aliases)) {
  const newPlatform = existingPlatform + '_arm64';
  aliases[newPlatform] = aliases[existingPlatform].map(alias => `${alias}_arm64`);
}

module.exports = platform => {
  // special handling for mac arm64
  if (platform === "darwin" || aliases['darwin'].includes(platform)) {
    return 'darwin_arm64';
  }  
  if (typeof aliases[platform] !== 'undefined') {
    return platform
  }

  for (const guess of Object.keys(aliases)) {
    const list = aliases[guess]

    if (list.includes(platform)) {
      return guess
    }
  }

  return false
}
