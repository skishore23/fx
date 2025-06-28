import inquirer from 'inquirer';
import { seedData } from './seedData';
import { sendMockMessage } from './mockSlack';
import { startBot } from './slackBot';
import { run } from './run';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Main test script
async function main() {
  console.log('🚀 Q2C Test Suite');
  console.log('=================');
  
  // Check environment variables
  const requiredVars = [
    'SF_CLIENT_ID',
    'SF_USERNAME',
    'SF_LOGIN_URL',
    'SF_PRIVATE_KEY_PATH',
    'OPENAI_API_KEY',
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'SLACK_APP_TOKEN'
  ];
  
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`  - ${varName}`));
    console.error('\nPlease set these variables in your .env file.');
    process.exit(1);
  }
  
  // Main menu
  while (true) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Select an action:',
        choices: [
          { name: '🤖 Start Slack Bot', value: 'START_BOT' },
          { name: '📤 Send Mock Slack Messages', value: 'MOCK_SLACK' },
          { name: '🌱 Create Demo Data in Salesforce', value: 'SEED_DATA' },
          { name: '💻 Run Q2C CLI Interface', value: 'RUN_CLI' },
          { name: '📋 About This Test Suite', value: 'ABOUT' },
          { name: '❌ Exit', value: 'EXIT' }
        ]
      }
    ]);
    
    switch (action) {
      case 'START_BOT':
        console.log('\n🤖 Starting Slack Bot...');
        startBot().catch((error: Error) => {
          console.error('Failed to start bot:', error);
        });
        // This will keep running, so we don't return to the menu
        return;
        
      case 'MOCK_SLACK':
        console.log('\n📤 Launching Mock Slack Message Sender...');
        await sendMockMessage();
        break;
        
      case 'SEED_DATA':
        console.log('\n🌱 Starting Salesforce Data Seeder...');
        await seedData();
        break;
        
      case 'RUN_CLI':
        console.log('\n💻 Starting Q2C CLI Interface...');
        await run();
        break;
        
      case 'ABOUT':
        console.log('\n📋 About this Test Suite');
        console.log('----------------------');
        console.log('This test suite integrates the following components:');
        console.log('1. Slack Bot - Process quotes directly from Slack messages');
        console.log('2. Mock Slack - Send test messages to the bot');
        console.log('3. Data Seeder - Create test data in Salesforce');
        console.log('4. CLI Interface - Process quotes through the terminal');
        console.log('\nUse this to test the Q2C system from end to end.');
        console.log('Typical flow:');
        console.log('1. Create demo data in Salesforce');
        console.log('2. Start the bot (in one terminal)');
        console.log('3. Send mock messages (in another terminal)');
        break;
        
      case 'EXIT':
        console.log('\n👋 Goodbye!');
        process.exit(0);
    }
    
    // Pause before returning to menu
    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: 'Press Enter to return to the main menu...'
      }
    ]);
  }
}

// Start if run directly
if (require.main === module) {
  main().catch(error => {
    console.error('Error in test script:', error);
    process.exit(1);
  });
}

export { main }; 