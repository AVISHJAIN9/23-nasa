import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

export default withMermaid(
  defineConfig({
    title: '25-NASA-AstroCare',
    description: 'Autonomous Delay-Tolerant Space-Medicine Platform for Deep-Space Missions.',
    appearance: 'dark',
    base: '/',
    themeConfig: {
      nav: [
        { text: 'Guide', link: '/00a-project-analysis' },
        { text: 'Features', link: '/01-features' },
        { text: 'API Reference', link: '/03-api-reference' },
        { text: 'System Design', link: '/system-design/' },
        { text: 'Interview Q&A', link: '/09-interview-qa' },
        { text: 'Checklist', link: '/13-master-checklist' }
      ],
      sidebar: [
        {
          text: 'Project Overview',
          items: [
            { text: 'Project Type', link: '/00-project-type' },
            { text: 'Project Analysis', link: '/00a-project-analysis' },
            { text: 'Project Pitch', link: '/00b-project-pitch' },
            { text: 'Project Map', link: '/00-project-map' }
          ]
        },
        {
          text: 'Features',
          items: [
            { text: 'Feature Inventory', link: '/01-features' },
            { text: 'F1: Telemetry Ingest & SQA', link: '/features/F1-telemetry-ingest-signal-quality' },
            { text: 'F2: Comms Delay Emulator', link: '/features/F2-comms-delay-emulator-dtn' },
            { text: 'F3: Alert Storm Suppression', link: '/features/F3-alert-fusion-storm-suppression' },
            { text: 'F4: Predictive ML Sidecar', link: '/features/F4-predictive-decompensation-ml' },
            { text: 'F5: Local Live & Audit Ledger', link: '/features/F5-live-telemetry-audit-ledger' },
            { text: 'Build Order', link: '/02-build-order' },
            { text: 'API Reference', link: '/03-api-reference' },
            { text: 'Tech Comparisons', link: '/04-tech-comparisons' }
          ]
        },
        {
          text: 'Architecture & Security',
          items: [
            { text: 'Architecture & DTN', link: '/05-architecture' },
            { text: 'Spacecraft Security', link: '/06-security' },
            { text: 'Predictive Clinical ML', link: '/07-ai-integration' },
            { text: 'Quality & Testing', link: '/08-quality-and-ops' }
          ]
        },
        {
          text: 'System Design Deep Dive',
          items: [
            { text: 'System Design Overview', link: '/system-design/' },
            { text: '14.1 Capacity Estimation', link: '/system-design/14.1-requirements-and-estimation' },
            { text: '14.2 Architecture Styles', link: '/system-design/14.2-architecture-styles' },
            { text: '14.5 Databases & Storage', link: '/system-design/14.5-databases-and-storage' },
            { text: '14.11 Security Architecture', link: '/system-design/14.11-security-architecture' },
            { text: 'Architecture Decisions (ADR)', link: '/system-design/decisions' }
          ]
        },
        {
          text: 'Interview & Quality',
          items: [
            { text: 'Interview Q&A (150+)', link: '/09-interview-qa' },
            { text: 'Gaps & Roadmap', link: '/10-gaps-and-improvements' },
            { text: 'Glossary', link: '/11-glossary' },
            { text: 'Confirm List', link: '/12-confirm-list' },
            { text: 'Master Checklist (275)', link: '/13-master-checklist' },
            { text: 'Say It Out Loud', link: '/14-say-it-out-loud' }
          ]
        }
      ],
      search: {
        provider: 'local'
      },
      outline: [2, 3]
    },
    mermaid: {
      theme: 'dark'
    },
    vite: {
      optimizeDeps: {
        include: ['mermaid', 'fastdom', 'fastdom/extensions/fastdom-promised.js']
      },
      ssr: {
        noExternal: ['mermaid', 'vitepress-plugin-mermaid', 'fastdom']
      }
    }
  })
);
