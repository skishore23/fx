/**
 * Test the Research Agent
 */

import { runCoreWorkflow } from './research-agent';

async function testResearchAgent() {
  console.log('🧪 Testing Research Agent...\n');
  
  // Test 1: Simple scraping
  console.log('📄 Test 1: Scraping a URL...');
  const scrapeState = {
    conversation: [
      { role: 'user', content: 'Scrape https://example.com and analyze the content' }
    ],
    researchTopic: 'Example website',
    researchDepth: 'medium' as const,
    maxSources: 3,
    maxPagesPerSource: 2,
    scrapedPages: [],
    analysisResults: [],
    verbose: true,
    currentGoal: '',
    plan: [],
    currentStep: 0,
    maxIterations: 10,
    iterationCount: 0
  };
  
  try {
    const result1 = await runCoreWorkflow(scrapeState);
    console.log(`✅ Scrape test completed! Scraped pages: ${result1.scrapedPages?.length || 0}`);
  } catch (error) {
    console.error('❌ Scrape test failed:', (error as Error).message);
  }
  
  // Test 2: Report generation
  console.log('\n📊 Test 2: Generating a report...');
  const reportState = {
    conversation: [
      { role: 'user', content: 'Generate a comprehensive report about AI trends' }
    ],
    researchTopic: 'AI trends',
    researchDepth: 'medium' as const,
    maxSources: 3,
    maxPagesPerSource: 2,
    scrapedPages: [
      {
        url: 'https://example.com',
        title: 'Example Page',
        content: 'This is sample content about AI trends and machine learning developments.',
        scrapedAt: new Date().toISOString(),
        wordCount: 12,
        domain: 'example.com'
      }
    ],
    analysisResults: [
      {
        sourceUrl: 'https://example.com',
        keyInsights: ['AI is rapidly evolving', 'Machine learning is becoming more accessible'],
        themes: ['Technology', 'Innovation'],
        credibilityScore: 0.8,
        biasIndicators: [],
        dataQuality: 'high' as const
      }
    ],
    verbose: true,
    currentGoal: '',
    plan: [],
    currentStep: 0,
    maxIterations: 10,
    iterationCount: 0
  };
  
  try {
    const result2 = await runCoreWorkflow(reportState);
    console.log(`✅ Report test completed!`);
    if (result2.finalReport) {
      console.log(`📄 Report generated: ${result2.reportPath}`);
      console.log(`📝 Report preview: ${result2.finalReport.substring(0, 200)}...`);
    } else {
      console.log('⚠️ No report was generated');
    }
  } catch (error) {
    console.error('❌ Report test failed:', (error as Error).message);
  }
  
  console.log('\n🎉 All tests completed!');
}

// Run the test
testResearchAgent();