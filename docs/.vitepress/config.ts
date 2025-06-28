import { withMermaid } from "vitepress-plugin-mermaid"

// https://vitepress.dev/reference/site-config
export default withMermaid({
  lang: 'en-US',
  title: "f(x) Framework",
  description: "A functional framework for building robust, composable LLM-powered agents",

  head: [
    ['link', { rel: 'stylesheet', href: '/theme/custom.css' }]
  ],

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'API', link: '/api/' },
      { text: 'Examples', link: '/examples/' }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Quick Start', link: '/guide/quick-start' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Basic Concepts', link: '/guide/concepts' }
          ]
        },
        {
          text: 'Core API',
          items: [
            { text: 'Agent Creation', link: '/core/agent' },
            { text: 'State Management', link: '/core/state' },
            { text: 'Tool Registration', link: '/core/tools' },
            { text: 'Composition Functions', link: '/core/composition' },
            { text: 'Prompt Management', link: '/core/prompts' }
          ]
        },
        {
          text: 'Advanced Features',
          items: [
            { text: 'Debugging & Logging', link: '/advanced/debugging' },
            { text: 'Error Handling', link: '/advanced/error-handling' },
            { text: 'Durable Execution', link: '/advanced/durable-execution' },
            { text: 'Performance', link: '/advanced/performance' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'Core',
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'Core Functions', link: '/api/core' },
            { text: 'Tool Functions', link: '/api/tools' },
            { text: 'State Functions', link: '/api/state' },
            { text: 'Utility Functions', link: '/api/utilities' }
          ]
        }
      ],
      '/examples/': [
        {
          text: 'Examples',
          items: [
            { text: 'Overview', link: '/examples/' },
            { text: 'Recursive Research', link: '/examples/recursive-research' },
            { text: 'Dynamic Tool Agent', link: '/examples/dynamic-tool' },
            { text: 'Care Plan Agent', link: '/examples/care-plan' },
            { text: 'Tree Planning', link: '/examples/tree-planning' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/yourusername/fx' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present Your Name'
    },

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://github.com/yourusername/fx/edit/main/docs/:path'
    }
  },

  mermaid: {
    theme: 'neutral',
    securityLevel: 'loose',
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'basis'
    },
    sequence: {
      useMaxWidth: true,
      showSequenceNumbers: false
    }
  }
}) 