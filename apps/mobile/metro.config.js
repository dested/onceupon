// Learn more https://docs.expo.dev/guides/monorepos
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const config = getDefaultConfig(__dirname)

// packages/shared is imported by relative path and lives outside the app root, so Metro must watch it.
config.watchFolders = [path.resolve(__dirname, '../../packages/shared')]

// The bundled offline studio ships as an .html asset.
config.resolver.assetExts.push('html')

// Resolve every dependency (including the shared package's) from this app's node_modules only.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]

module.exports = config
