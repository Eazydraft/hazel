/* global describe, it, expect */
const aliases = require('../lib/aliases')

describe('Aliases', () => {
  it('Should return darwin_arm64 for mac (default arch for darwin is arm64)', () => {
    const result = aliases('mac')
    expect(result).toBe('darwin_arm64')
  })

  it('Should return darwin_arm64 for darwin (default arch for darwin is arm64)', () => {
    const result = aliases('darwin')
    expect(result).toBe('darwin_arm64')
  })

  it('Should return darwin for darwin_x64 (explicit x64 request)', () => {
    const result = aliases('darwin_x64')
    expect(result).toBe('darwin')
  })

  it('Should return darwin for mac_x64 (explicit x64 request)', () => {
    const result = aliases('mac_x64')
    expect(result).toBe('darwin')
  })

  it('Should return darwin_arm64 for explicit arm64 request', () => {
    const result = aliases('darwin_arm64')
    expect(result).toBe('darwin_arm64')
  })

  it('Should return exe for windows (default arch for windows is x86)', () => {
    const result = aliases('win32')
    expect(result).toBe('exe')
  })

  it('Should return exe_arm64 for explicit windows arm64 request', () => {
    const result = aliases('win32_arm64')
    expect(result).toBe('exe_arm64')
  })

  it('Should return false if no platform is found', () => {
    const result = aliases('test')
    expect(result).toBe(false)
  })
})
