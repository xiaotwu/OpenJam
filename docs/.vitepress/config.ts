import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'OpenJam',
  description: 'Real-time collaborative whiteboard for teams',
  base: '/OpenJam/',

  head: [
    ['link', { rel: 'icon', href: '/OpenJam/favicon.ico' }],
  ],

  themeConfig: {
    logo: '/logo.png',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/configuration' },
      { text: 'GitHub', link: 'https://github.com/xiaotwu/OpenJam' },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is OpenJam?', link: '/guide/what-is-openjam' },
          { text: 'Getting Started', link: '/guide/getting-started' },
        ],
      },
      {
        text: 'Deployment',
        items: [
          { text: 'Docker', link: '/guide/docker' },
          { text: 'Manual Setup', link: '/guide/manual-setup' },
        ],
      },
      {
        text: 'Architecture',
        items: [
          { text: 'Overview', link: '/guide/architecture' },
          { text: 'Real-Time Collaboration', link: '/guide/collaboration' },
          { text: 'Authentication & Security', link: '/guide/security' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Configuration', link: '/reference/configuration' },
          { text: 'API', link: '/reference/api' },
          { text: 'FAQ', link: '/reference/faq' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/xiaotwu/OpenJam' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2024-present OpenJam Contributors',
    },

    search: {
      provider: 'local',
    },
  },
});
