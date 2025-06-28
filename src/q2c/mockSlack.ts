import dotenv from 'dotenv';
import { App, LogLevel } from '@slack/bolt';
import inquirer from 'inquirer';
import { demoScenarios } from './seedData';

// Load environment variables
dotenv.config();

// Sample messages from examples
const sampleMessages = [
  "Need to recall so I can bump GenWatt Diesel 1000 kW from 2 → 3. https://yourorg--dev.lightning.force.com/lightning/r/SBQQ_Quote__c/a088x000000Wsv0AAC/view",
  "Edge Communications | AI + Phones. Please approve ASAP. https://yourorg--dev.lightning.force.com/lightning/r/Opportunity/0068x000003Lbc2AAC/view",
  "Remove network fee—customer owns all Cisco phones. https://yourorg--dev.lightning.force.com/lightning/r/SBQQ_Quote__c/a088x000000Wsv1AAC/view",
  "Quote reopened: only 1 NOF logged; need 2nd NOF added so Deal Desk will sign. https://yourorg--dev.lightning.force.com/lightning/r/Opportunity/0068x000003Lbc4AAC/view",
  "Digital Checkout failed. Send the Burlington Textiles quote by DocuSign instead. https://yourorg--dev.lightning.force.com/lightning/r/SBQQ_Quote__c/a088x000000Wsv2AAC/view"
];

// Mock function for sending messages to the Slack bot
async function sendMockMessage() {
  try {
    // Validate that needed environment variables are set
    if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_SIGNING_SECRET || !process.env.SLACK_APP_TOKEN) {
      console.error('❌ Missing required Slack environment variables');
      console.log('Make sure SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, and SLACK_APP_TOKEN are set');
      process.exit(1);
    }

    console.log('🚀 Starting mock Slack message sender...');
    
    // Initialize Slack app in listening mode
    const app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      socketMode: true,
      appToken: process.env.SLACK_APP_TOKEN,
      logLevel: LogLevel.INFO
    });
    
    await app.start();
    console.log('⚡️ Mock Slack sender running');
    
    // Get available channels
    const channelsResponse = await app.client.conversations.list({
      token: process.env.SLACK_BOT_TOKEN,
      types: 'public_channel,private_channel'
    });
    
    const channels = channelsResponse.channels || [];
    
    if (channels.length === 0) {
      console.error('❌ No channels found. Make sure the bot has been added to at least one channel.');
      process.exit(1);
    }
    
    // Get bot info to determine bot user ID
    const botInfoResponse = await app.client.auth.test({
      token: process.env.SLACK_BOT_TOKEN
    });
    
    const botUserId = botInfoResponse.user_id;
    
    if (!botUserId) {
      console.error('❌ Could not determine bot user ID');
      process.exit(1);
    }
    
    // Main interaction loop
    while (true) {
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            { name: 'Send sample message', value: 'SAMPLE' },
            { name: 'Send custom message', value: 'CUSTOM' },
            { name: 'Send command', value: 'COMMAND' },
            { name: 'Exit', value: 'EXIT' }
          ]
        }
      ]);
      
      if (action === 'EXIT') {
        console.log('👋 Goodbye!');
        process.exit(0);
      }
      
      // Channel selection
      const { channelId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'channelId',
          message: 'Select a channel:',
          choices: channels.map((channel: any) => ({
            name: channel.name,
            value: channel.id
          }))
        }
      ]);
      
      // Message selection
      let messageText = '';
      
      if (action === 'SAMPLE') {
        const { sampleIndex } = await inquirer.prompt([
          {
            type: 'list',
            name: 'sampleIndex',
            message: 'Select a sample message:',
            choices: sampleMessages.map((msg, index) => ({
              name: msg,
              value: index
            }))
          }
        ]);
        
        messageText = sampleMessages[sampleIndex];
      } 
      else if (action === 'COMMAND') {
        const { command } = await inquirer.prompt([
          {
            type: 'list',
            name: 'command',
            message: 'Select a command:',
            choices: [
              { name: 'help', value: 'help' },
              { name: 'list', value: 'list' },
              { name: 'status', value: 'status' },
              { name: 'seed', value: 'seed' },
              { name: 'validate', value: 'validate' },
              { name: 'process', value: 'process' },
              { name: 'about', value: 'about' }
            ]
          }
        ]);
        
        messageText = `<@${botUserId}> ${command}`;
        
        // For commands that need parameters
        if (command === 'seed') {
          const { seedOption } = await inquirer.prompt([
            {
              type: 'list',
              name: 'seedOption',
              message: 'Seed option:',
              choices: [
                { name: 'List available scenarios', value: '' },
                { name: 'Create all scenarios', value: 'all' },
                ...demoScenarios.map((s, i) => ({ name: s.name, value: i.toString() }))
              ]
            }
          ]);
          
          messageText += seedOption ? ` ${seedOption}` : '';
        }
        else if (command === 'validate' || command === 'quote') {
          const { quoteId } = await inquirer.prompt([
            {
              type: 'input',
              name: 'quoteId',
              message: 'Enter quote ID:',
              default: 'a088x000000Wsv0AAC'
            }
          ]);
          
          messageText += ` ${quoteId}`;
        }
      }
      else if (action === 'CUSTOM') {
        const { customMessage } = await inquirer.prompt([
          {
            type: 'input',
            name: 'customMessage',
            message: 'Enter your message:'
          }
        ]);
        
        messageText = customMessage;
      }
      
      // Add mention?
      if (action !== 'COMMAND' && messageText) {
        const { addMention } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'addMention',
            message: 'Mention the bot?',
            default: false
          }
        ]);
        
        if (addMention) {
          messageText = `<@${botUserId}> ${messageText}`;
        }
      }
      
      // Send the message
      if (messageText) {
        console.log(`Sending to channel: ${channelId}`);
        console.log(`Message: ${messageText}`);
        
        try {
          const result = await app.client.chat.postMessage({
            token: process.env.SLACK_BOT_TOKEN,
            channel: channelId,
            text: messageText
          });
          
          console.log('✅ Message sent successfully!');
        } catch (error) {
          console.error('❌ Error sending message:', error);
        }
      }
      
      console.log('\n');
    }
    
  } catch (error) {
    console.error('❌ Error in mock sender:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  sendMockMessage();
}

export { sendMockMessage }; 