// Packages
const fetch = require('node-fetch')
const retry = require('async-retry')
const ms = require('ms')

// Utilities
const checkPlatform = require('./platform')

module.exports = class Cache {
  constructor(config) {
    const { account, repository, token, url } = config
    this.config = config

    if (!account || !repository) {
      const error = new Error('Neither ACCOUNT, nor REPOSITORY are defined')
      error.code = 'missing_configuration_properties'
      throw error
    }

    if (token && !url) {
      const error = new Error(
        'Neither VERCEL_URL, nor URL are defined, which are mandatory for private repo mode'
      )
      error.code = 'missing_configuration_properties'
      throw error
    }

    // Support multiple channels: cutting-edge, test, edge, nightly, and latest
    this.channels = {
      'cutting-edge': {},
      test: {},
      edge: {},
      nightly: {},
      latest: {}
    }
    this.lastUpdate = null

    this.cacheReleaseList = this.cacheReleaseList.bind(this)
    this.refreshCache = this.refreshCache.bind(this)
    this.loadCache = this.loadCache.bind(this)
    this.isOutdated = this.isOutdated.bind(this)
    this.detectChannel = this.detectChannel.bind(this)
  }

   async cacheReleaseList({ url, browser_download_url }) {
    const { token } = this.config
    const shouldProxyPrivateDownload = token && typeof token === 'string' && token.length > 0
    const headers = { 
      Accept: 'application/octet-stream',
      'User-Agent': 'Hazel-Update-Server'
    }

    if (token && typeof token === 'string' && token.length > 0) {
      headers.Authorization = `Bearer ${token}`
    }

    const response = await retry(
      async () => {
        const res = await fetch(url, { headers })

        if (res.status !== 200) {
          throw new Error(
            `Tried to cache RELEASES, but failed fetching ${url}, status ${res.status}`
          )
        }

        return res
      },
      { retries: 3 }
    )

    let content = await response.text()
    const matches = content.match(/[^ ]*\.nupkg/gim)

    if (matches && matches.length === 0) {
      throw new Error(
        `Tried to cache RELEASES, but failed. RELEASES content doesn't contain nupkg`
      )
    }

    // for (let i = 0; i < matches.length; i += 1) {
    //   const nuPKG = url.replace('RELEASES', matches[i])
    //   content = content.replace(matches[i], nuPKG)
    // }
    return content
  }

  detectChannel(version) {
    // Detect channel from version string
    // version format: X.Y.Z or X.Y.Z-cutting-edge.N or X.Y.Z-test.N, etc.
    if (!version || typeof version !== 'string') {
      return 'latest'
    }
    
    const lowerVersion = version.toLowerCase()
    if (lowerVersion.includes('-cutting-edge') || lowerVersion.includes('cutting-edge')) {
      return 'cutting-edge'
    }
    if (lowerVersion.includes('-test') || lowerVersion.includes('test')) {
      return 'test'
    }
    if (lowerVersion.includes('-edge') || lowerVersion.includes('edge')) {
      return 'edge'
    }
    if (lowerVersion.includes('-nightly') || lowerVersion.includes('nightly')) {
      return 'nightly'
    }
    return 'latest'
  }

  async refreshCache() {
    const { account, repository, token } = this.config
    const repo = account + '/' + repository
    const url = `https://api.github.com/repos/${repo}/releases?per_page=100`
    const headers = { 
      Accept: 'application/vnd.github.preview',
      'User-Agent': 'Hazel-Update-Server'
    }

    if (token && typeof token === 'string' && token.length > 0) {
      headers.Authorization = `Bearer ${token}`
    }

    const response = await retry(
      async () => {
        const response = await fetch(url, { headers })

        if (response.status !== 200) {
          throw new Error(
            `GitHub API responded with ${response.status} for url ${url}`
          )
        }

        return response
      },
      { retries: 3 }
    )

    const data = await response.json()

    if (!Array.isArray(data) || data.length === 0) {
      return
    }

    // Find the latest release for each channel
    const channelReleases = {
      'cutting-edge': null,
      test: null,
      edge: null,
      nightly: null,
      latest: null
    }

    for (const item of data) {
      if (item.draft) {
        continue
      }

      const channel = this.detectChannel(item.tag_name)
      
      // Only set if we haven't found one for this channel yet
      // (releases are ordered by date, so first match is the latest)
      if (!channelReleases[channel]) {
        channelReleases[channel] = item
      }
      
      // Stop early if all channels have been found
      if (Object.values(channelReleases).every(release => release !== null)) {
        break
      }
    }

    // Cache each channel's release
    for (const [channel, release] of Object.entries(channelReleases)) {
      if (!release) {
        console.log(`No ${channel} release found`)
        continue
      }

      await this.cacheRelease(channel, release)
    }

    console.log('Finished caching all channels')
    this.lastUpdate = Date.now()
  }

  async cacheRelease(channel, release) {
    const { token } = this.config
    
    if (!release || !release.assets || !Array.isArray(release.assets)) {
      return
    }

    const { tag_name } = release

    if (this.channels[channel].version === tag_name) {
      console.log(`Cached version for ${channel} is the same as latest: ${tag_name}`)
      return
    }

    console.log(`Caching ${channel} channel version ${tag_name}...`)

    this.channels[channel].version = tag_name
    this.channels[channel].notes = release.body
    this.channels[channel].pub_date = release.published_at

    // Clear list of download links
    this.channels[channel].platforms = {}
    this.channels[channel].files = {}

    for (const asset of release.assets) {
      const { name, browser_download_url, url, content_type, size } = asset
      
      this.channels[channel].files[name] = {
        name,
        api_url: url,
        url: browser_download_url,
        content_type,
        size: Math.round(size / 1000000 * 10) / 10
      }

      if (name === 'RELEASES') {
        try {
          if (!this.channels[channel].files) {
            this.channels[channel].files = {}
          }
          this.channels[channel].files.RELEASES = await this.cacheReleaseList({
            url, browser_download_url
          })
        } catch (err) {
          console.error(err)
        }
        continue
      }

      const platform = checkPlatform(name)

      if (!platform) {
        continue
      }

      this.channels[channel].platforms[platform] = {
        name,
        api_url: url,
        url: browser_download_url,
        content_type,
        size: Math.round(size / 1000000 * 10) / 10
      }
    }

    console.log(`Finished caching ${channel} version ${tag_name}`)
  }

  isOutdated() {
    const { lastUpdate, config } = this
    const { interval = 15 } = config

    if (lastUpdate && Date.now() - lastUpdate > ms(`${interval}m`)) {
      return true
    }

    return false
  }

  // This is a method returning the cache
  // because the cache would otherwise be loaded
  // only once when the index file is parsed
  async loadCache(channel = 'latest', version = null) {
    const { refreshCache, isOutdated, lastUpdate } = this

    if (!lastUpdate || isOutdated()) {
      await refreshCache()
    }

    // If version is provided, auto-detect channel from it
    if (version) {
      channel = this.detectChannel(version)
    }

    const channelCache = this.channels[channel]
    
    if (!channelCache || !channelCache.version) {
      console.log(`No release found for channel ${channel}`)
      return {}
    }

    return Object.assign({}, channelCache)
  }

}
