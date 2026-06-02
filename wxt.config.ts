import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  autoIcons: {
    baseIconPath: 'public/icon-512.png',
    sizes: [16, 32, 48, 96, 128],
  },
  manifest: {
    name: 'FeedForge — Custom YouTube Algorithm',
    description: 'Reclaim your YouTube feed with snooze blocks, channel caps, and hidden gem discovery.',
    version: '0.1.0',
    permissions: ['storage'],
    host_permissions: ['*://*.youtube.com/*'],
    web_accessible_resources: [
      {
        resources: ['youtube-interceptor.js'],
        matches: ['*://*.youtube.com/*'],
      },
    ],
  },
});
