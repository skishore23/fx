import { h, defineComponent } from 'vue'
import DefaultTheme from 'vitepress/theme'
import mermaid from 'mermaid'
import './custom.css'

// Initialize mermaid with default configuration
mermaid.initialize({
  startOnLoad: true,
  theme: 'default',
  securityLevel: 'loose',
  themeVariables: {
    fontFamily: 'var(--vp-font-family-base)'
  }
})

// Create Mermaid component
const Mermaid = defineComponent({
  name: 'Mermaid',
  props: {
    graph: {
      type: String,
      required: true
    }
  },
  mounted() {
    const element = this.$el as HTMLElement
    mermaid.render('mermaid-svg', this.$props.graph)
      .then(({ svg }) => {
        element.innerHTML = svg
      })
      .catch(error => {
        console.error('Mermaid rendering failed:', error)
        element.innerHTML = `<pre>Diagram rendering failed: ${error.message}</pre>`
      })
  },
  render() {
    return h('div', { class: 'mermaid' })
  }
})

export default {
  ...DefaultTheme,
  enhanceApp({ app }) {
    app.component('Mermaid', Mermaid)
  }
} 