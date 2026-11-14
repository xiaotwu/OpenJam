import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Shiori',
  description: 'Self-hosted collaboration for boards, documents, spreadsheets, and presentations',
  base: '/Shiori/',
  ignoreDeadLinks: [/^http:\/\/localhost/],
  vite: {
    server: {
      fs: { allow: [fileURLToPath(new URL('../../app/src/assets/home/', import.meta.url))] },
    },
  },

  head: [
    ['link', { rel: 'icon', href: '/Shiori/icons/favicon-light.png', media: '(prefers-color-scheme: light)' }],
    ['link', { rel: 'icon', href: '/Shiori/icons/favicon-dark.png', media: '(prefers-color-scheme: dark)' }],
    ['meta', { property: 'og:site_name', content: 'Shiori' }],
  ],

  themeConfig: {
    logo: { light: '/icons/mark-light.svg', dark: '/icons/mark-dark.svg' },

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/configuration' },
      { text: 'Releases', link: 'https://github.com/xiaotwu/Shiori/releases' },
      { text: 'GitHub', link: 'https://github.com/xiaotwu/Shiori' },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is Shiori?', link: '/guide/what-is-shiori' },
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Project Branches and Sync', link: '/guide/project-sync' },
          { text: 'Move a Project Between Instances', link: '/guide/project-archive' },
          { text: 'Board Assistant', link: '/guide/board-assistant' },
          { text: 'External Agent Connector', link: '/guide/agent-connector' },
          { text: 'Meetings', link: '/guide/meetings' },
        ],
      },
      {
        text: 'Deployment',
        items: [
          { text: 'Docker', link: '/guide/docker' },
          { text: 'Operations and Recovery', link: '/guide/operations' },
          { text: 'Pilot Acceptance', link: '/guide/pilot-acceptance' },
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
      { icon: 'github', link: 'https://github.com/xiaotwu/Shiori' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2024-present Shiori Contributors',
    },

    search: {
      provider: 'local',
    },
  },
});
