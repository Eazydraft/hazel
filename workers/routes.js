// Workers-compatible version of routes
// Native
const urlHelpers = require('url');

// Packages
const { valid, compare } = require('semver');
const { parse } = require('express-useragent');
const fetch = require('node-fetch');
const distanceInWordsToNow = require('date-fns/distance_in_words_to_now');

// Utilities
const checkAlias = require('../lib/aliases');
const prepareView = require('../lib/view');

// Micro shim for Workers
const send = (res, statusCode, data) => {
  res.writeHead(statusCode);
  res.end(data);
};

module.exports = ({ cache, config }) => {
  const { loadCache } = cache;
  const exports = {};
  const { token, url } = config;
  const shouldProxyPrivateDownload =
    token && typeof token === 'string' && token.length > 0;

  // Helpers
  const proxyPrivateDownload = async (asset, req, res) => {
    const { api_url: rawUrl } = asset;
    
    // Use the same Bearer token approach as in cache.js
    const headers = { 
      'Accept': 'application/octet-stream',
      'User-Agent': 'Hazel-Update-Server'
    };
    
    if (token && typeof token === 'string' && token.length > 0) {
      headers.Authorization = `Bearer ${token}`;
    }
    
    const options = { headers, redirect: 'manual' };

    const assetRes = await fetch(rawUrl, options);
    
    // Check if it's a redirect (302) or direct download (200)
    if (assetRes.status === 302 || assetRes.status === 301) {
      const location = assetRes.headers.get('Location');
      
      if (!location) {
        console.error('No Location header in redirect response');
        send(res, 500, 'Failed to get download URL');
        return;
      }
      
      res.setHeader('Location', location);
      send(res, 302);
    } else if (assetRes.status === 200) {
      // GitHub might return the file directly without redirect
      console.log('Got direct download (200), need to proxy the content');
      // For now, redirect to the public URL if available
      if (asset.url) {
        res.setHeader('Location', asset.url);
        send(res, 302);
      } else {
        send(res, 500, 'Cannot proxy download');
      }
    } else {
      console.error('Unexpected status code:', assetRes.status);
      send(res, 500, 'Failed to get download from GitHub');
    }
  };

  exports.download = async (req, res) => {
    const userAgent = parse(req.headers['user-agent']);
    const params = urlHelpers.parse(req.url, true).query;
    const isUpdate = params && params.update;

    let platform;

    if (userAgent.isMac && isUpdate) {
      platform = 'darwin';
    } else if (userAgent.isMac && !isUpdate) {
      platform = 'dmg';
    } else if (userAgent.isWindows) {
      platform = 'exe';
    }

    // Get the latest version from the cache
    const { platforms } = await loadCache();

    if (!platform || !platforms || !platforms[platform]) {
      send(res, 404, 'No download available for your platform!');
      return;
    }

    if (shouldProxyPrivateDownload) {
      await proxyPrivateDownload(platforms[platform], req, res);
      return;
    }

    res.writeHead(302, {
      Location: platforms[platform].url
    });

    res.end();
  };

  exports.downloadPlatform = async (req, res) => {
    const params = urlHelpers.parse(req.url, true).query;
    const isUpdate = params && params.update;

    let { platform } = req.params;
    console.log(`Downloading for platform: ${platform}`);

    if (platform === 'mac' && !isUpdate) {
      platform = 'dmg';
    }

    if (platform === 'mac_arm64' && !isUpdate) {
      platform = 'dmg_arm64';
    }

    // Get the latest version from the cache
    const latest = await loadCache();

    // Check platform for appropiate aliases
    platform = checkAlias(platform);

    if (!platform) {
      send(res, 500, 'The specified platform is not valid');
      return;
    }

    if (!latest.platforms || !latest.platforms[platform]) {
      send(res, 404, 'No download available for your platform');
      return;
    }

    if (token && typeof token === 'string' && token.length > 0) {
      await proxyPrivateDownload(latest.platforms[platform], req, res);
      return;
    }

    res.writeHead(302, {
      Location: latest.platforms[platform].url
    });

    res.end();
  };

  exports.update = async (req, res) => {
    const { platform: platformName, version } = req.params;

    if (!valid(version)) {
      send(res, 500, {
        error: 'version_invalid',
        message: 'The specified version is not SemVer-compatible'
      });

      return;
    }

    const platform = checkAlias(platformName);

    if (!platform) {
      send(res, 500, {
        error: 'invalid_platform',
        message: 'The specified platform is not valid'
      });

      return;
    }

    // Get the latest version from the cache for the appropriate channel
    // The loadCache will auto-detect the channel from the version
    const latest = await loadCache(null, version);

    if (!latest.platforms || !latest.platforms[platform]) {
      res.statusCode = 204;
      res.end();

      return;
    }

    // Previously, we were checking if the latest version is
    // greater than the one on the client. However, we
    // only need to compare if they're different (even if
    // lower) in order to trigger an update.

    // This allows developers to downgrade their users
    // to a lower version in the case that a major bug happens
    // that will take a long time to fix and release
    // a patch update.

    if (compare(latest.version, version) !== 0) {
      const { notes, pub_date } = latest;
      const sanitizedBaseUrl = url.startsWith('http') ? url : `https://${url}`

      send(res, 200, {
        name: latest.version,
        notes,
        pub_date,
        url: shouldProxyPrivateDownload
          ? `${sanitizedBaseUrl}/download/${platformName}?update=true`
          : latest.platforms[platform].url
      });

      return;
    }

    res.statusCode = 204;
    res.end();
  };

  exports.releases = async (req, res) => {
    const { version, filename } = req.params
    
    // Get the latest version from the cache for the appropriate channel
    // The loadCache will auto-detect the channel from the version
    const latest = await loadCache(null, version)

    if (filename.toLowerCase().startsWith('releases')) {
      if (!latest.files || !latest.files.RELEASES) {
        res.statusCode = 204
        res.end()
        return
      }
      const content = latest.files.RELEASES
  
      res.writeHead(200, {
        'content-length': Buffer.byteLength(content, 'utf8'),
        'content-type': 'application/octet-stream'
      })
  
      res.end(content)
    }
    else if (filename.toLowerCase().endsWith('nupkg')) {
      // Look up .nupkg file by its full filename (stored as key in platforms)
      const nupkgAsset = latest.platforms?.['nupkg']
      
      if (!nupkgAsset) {
        res.statusCode = 404
        res.end()
        return
      }

      if (shouldProxyPrivateDownload) {
        console.log('Proxying private download...')
        await proxyPrivateDownload(nupkgAsset, req, res)
        return
      }
      res.writeHead(302, {
        Location: nupkgAsset.url
      })
      res.end()
    }else{
      res.statusCode = 400
      res.end()
    }
  }

  exports.files = async (req, res) => {
    const { filename } = req.params;
    
    // Detect channel from filename for electron-builder yml files
    let channelFromFilename = null;
    const lowerFilename = filename.toLowerCase();
    if (lowerFilename === 'stable.yml' || lowerFilename === 'stable-mac.yml' || lowerFilename === 'stable-linux.yml' || lowerFilename === 'latest.yml' || lowerFilename === 'latest-mac.yml' || lowerFilename === 'latest-linux.yml') {
      channelFromFilename = 'stable';
    } else if (lowerFilename === 'beta.yml' || lowerFilename === 'beta-mac.yml' || lowerFilename === 'beta-linux.yml') {
      channelFromFilename = 'beta';
    } else if (lowerFilename === 'test.yml' || lowerFilename === 'test-mac.yml' || lowerFilename === 'test-linux.yml') {
      channelFromFilename = 'test';
    }
    
    // If requesting a specific channel yml file, load that channel's cache
    if (channelFromFilename) {
      const channelCache = await loadCache(channelFromFilename);
      if (channelCache.files && channelCache.files[filename]) {
        const fileFound = channelCache.files[filename];
        if (shouldProxyPrivateDownload) {
          proxyPrivateDownload(fileFound, req, res);
          return;
        }
        res.writeHead(302, {
          Location: fileFound.url
        });
        res.end();
        return;
      }
      // If not found in files, continue to search
    }
    
    // Try to find the file in any channel cache
    // Check all channels in order
    const channels = ['test', 'beta', 'stable'];
    let fileFound = null;
    
    for (const channel of channels) {
      const channelCache = await loadCache(channel);
      if (channelCache.files && channelCache.files[filename]) {
        fileFound = channelCache.files[filename];
        break;
      }
    }

    if (!fileFound) {
      send(res, 404, `can't load ${filename}`)
      return
    }

    if (shouldProxyPrivateDownload) {
      proxyPrivateDownload(fileFound, req, res);
      return
    }

    res.writeHead(302, {
      Location: fileFound.url
    })
    res.end()
  }

  exports.overview = async (req, res) => {
    const latest = await loadCache();

    try {
      const render = await prepareView();

      const details = {
        account: config.account,
        repository: config.repository,
        date: distanceInWordsToNow(latest.pub_date, { addSuffix: true }),
        files: latest.platforms,
        version: latest.version,
        releaseNotes: `https://github.com/${config.account}/${
          config.repository
        }/releases/tag/${latest.version}`,
        allReleases: `https://github.com/${config.account}/${
          config.repository
        }/releases`,
        github: `https://github.com/${config.account}/${config.repository}`
      };

      send(res, 200, render(details));
    } catch (err) {
      console.error(err);
      send(res, 500, 'Error reading overview file');
    }
  };

  return exports;
};
