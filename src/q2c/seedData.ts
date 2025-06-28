import dotenv from 'dotenv';
import { SalesforceAPI, createConnection, getToken, isLeft } from './salesforce';
import { Quote, QuoteLineItem, QuoteStatus, OAuthToken } from './types';
import inquirer from 'inquirer';
import { Connection } from 'jsforce';
import jwt from 'jsonwebtoken';

// Load environment variables
dotenv.config();

// Demo data based on the Slack conversation examples
const demoScenarios = [
  {
    name: 'GenWatt Diesel Recall',
    description: 'Need to recall so I can bump GenWatt Diesel 1000 kW from 2 → 3',
    account: 'GenWatt',
    opportunity: 'GenWatt Generators Expansion',
    amount: 250000,
    status: 'Approved',
    lineItems: [
      { productName: 'GenWatt Diesel 1000 kW', quantity: 2, unitPrice: 125000 }
    ]
  },
  {
    name: 'Edge Communications AI + Phones',
    description: 'Edge Communications | AI + Phones. Please approve ASAP.',
    account: 'Edge Communications',
    opportunity: 'Edge Communications Phone Upgrade',
    amount: 75000,
    status: 'Pending',
    lineItems: [
      { productName: 'Enterprise AI License', quantity: 1, unitPrice: 50000 },
      { productName: 'IP Phone Standard', quantity: 100, unitPrice: 250 }
    ]
  },
  {
    name: 'Burlington Textiles Network Fee Removal',
    description: 'Remove network fee—customer owns all Cisco phones.',
    account: 'Burlington Textiles',
    opportunity: 'Burlington Textiles Corp Network Upgrade',
    amount: 45000,
    status: 'Pending',
    lineItems: [
      { productName: 'Network Monitoring Service', quantity: 1, unitPrice: 35000 },
      { productName: 'Network Setup Fee', quantity: 1, unitPrice: 10000 }
    ]
  },
  {
    name: 'United Oil Bulk SMS',
    description: 'Need 10 k bulk SMS for United Oil North—approve.',
    account: 'United Oil & Gas Corp',
    opportunity: 'United Oil Messaging Platform',
    amount: 15000,
    status: 'Draft',
    lineItems: [
      { productName: 'Bulk SMS Package (10,000)', quantity: 1, unitPrice: 15000 }
    ]
  },
  {
    name: 'Express Logistics AI Removal',
    description: 'Remove AI and delay start to next month.',
    account: 'Express Logistics',
    opportunity: 'Express Logistics Technology Refresh',
    amount: 150000,
    status: 'Draft',
    lineItems: [
      { productName: 'Enterprise AI License', quantity: 1, unitPrice: 50000 },
      { productName: 'Core Platform License', quantity: 1, unitPrice: 75000 },
      { productName: 'Implementation Services', quantity: 1, unitPrice: 25000 }
    ]
  }
];

// Get authentication token
const getAuthToken = async (): Promise<OAuthToken> => {
  const tokenResult = await getToken({
    clientId: process.env.SF_CLIENT_ID!,
    loginUrl: 'https://login.salesforce.com',
    subject: process.env.SF_USERNAME!
  });

  if (isLeft(tokenResult)) {
    throw new Error(`Authentication failed: ${tokenResult.left.message}`);
  }
  return tokenResult.right;
};

// Create account if it doesn't exist
const createAccountIfNeeded = async (conn: any, name: string): Promise<string> => {
  try {
    // Check if account exists
    const result = await conn.query(`SELECT Id FROM Account WHERE Name = '${name}' LIMIT 1`);
    
    if (result.records.length > 0) {
      console.log(`Account "${name}" already exists.`);
      return result.records[0].Id;
    }
    
    // Create account
    const accountResult = await conn.sobject('Account').create({
      Name: name,
      Type: 'Customer',
      Industry: 'Energy',
      Rating: 'Hot'
    });
    
    if (accountResult.success) {
      console.log(`Created account "${name}" with ID: ${accountResult.id}`);
      return accountResult.id;
    } else {
      throw new Error(`Failed to create account: ${accountResult.errors.join(', ')}`);
    }
  } catch (error) {
    console.error(`Error creating account "${name}":`, error);
    throw error;
  }
};

// Create opportunity if it doesn't exist
const createOpportunityIfNeeded = async (conn: any, name: string, accountId: string): Promise<string> => {
  try {
    // Check if opportunity exists
    const result = await conn.query(`SELECT Id FROM Opportunity WHERE Name = '${name}' LIMIT 1`);
    
    if (result.records.length > 0) {
      console.log(`Opportunity "${name}" already exists.`);
      return result.records[0].Id;
    }
    
    // Create opportunity
    const closeDate = new Date();
    closeDate.setDate(closeDate.getDate() + 30); // Close date 30 days in future
    
    const opportunityResult = await conn.sobject('Opportunity').create({
      Name: name,
      AccountId: accountId,
      StageName: 'Proposal/Price Quote',
      CloseDate: closeDate.toISOString().split('T')[0], // Format as YYYY-MM-DD
      Amount: 100000
    });
    
    if (opportunityResult.success) {
      console.log(`Created opportunity "${name}" with ID: ${opportunityResult.id}`);
      return opportunityResult.id;
    } else {
      throw new Error(`Failed to create opportunity: ${opportunityResult.errors.join(', ')}`);
    }
  } catch (error) {
    console.error(`Error creating opportunity "${name}":`, error);
    throw error;
  }
};

// Create products if needed
const createProductIfNeeded = async (conn: any, name: string): Promise<string> => {
  try {
    // Check if product exists
    const result = await conn.query(`SELECT Id FROM Product2 WHERE Name = '${name}' LIMIT 1`);
    
    if (result.records.length > 0) {
      console.log(`Product "${name}" already exists.`);
      return result.records[0].Id;
    }
    
    // Create product
    const productResult = await conn.sobject('Product2').create({
      Name: name,
      ProductCode: name.replace(/[^A-Z0-9]/gi, '').substring(0, 10).toUpperCase(),
      IsActive: true,
      Family: 'Hardware'
    });
    
    if (productResult.success) {
      console.log(`Created product "${name}" with ID: ${productResult.id}`);
      return productResult.id;
    } else {
      throw new Error(`Failed to create product: ${productResult.errors.join(', ')}`);
    }
  } catch (error) {
    console.error(`Error creating product "${name}":`, error);
    throw error;
  }
};

// Get or create a pricebook entry
const getPricebookEntry = async (conn: any, productId: string, unitPrice: number): Promise<string> => {
  try {
    // Get standard pricebook ID
    const pricebookResult = await conn.query("SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1");
    if (pricebookResult.records.length === 0) {
      throw new Error('Standard pricebook not found');
    }
    const pricebookId = pricebookResult.records[0].Id;
    
    // Check if pricebook entry exists
    const entryResult = await conn.query(
      `SELECT Id FROM PricebookEntry WHERE Product2Id = '${productId}' AND Pricebook2Id = '${pricebookId}' LIMIT 1`
    );
    
    if (entryResult.records.length > 0) {
      return entryResult.records[0].Id;
    }
    
    // Create pricebook entry
    const entryCreateResult = await conn.sobject('PricebookEntry').create({
      Product2Id: productId,
      Pricebook2Id: pricebookId,
      UnitPrice: unitPrice,
      IsActive: true,
      UseStandardPrice: false
    });
    
    if (entryCreateResult.success) {
      console.log(`Created pricebook entry for product ID ${productId} with price $${unitPrice}`);
      return entryCreateResult.id;
    } else {
      throw new Error(`Failed to create pricebook entry: ${entryCreateResult.errors.join(', ')}`);
    }
  } catch (error) {
    console.error('Error getting/creating pricebook entry:', error);
    throw error;
  }
};

interface SalesforceField {
  name: string;
  updateable: boolean;
}

// Create a quote and its line items
const createQuote = async (conn: any, scenario: any, opportunityId: string): Promise<string> => {
  try {
    // Check if SBQQ__Quote__c object exists (indicates CPQ is installed)
    let quoteObject = 'SBQQ__Quote__c';
    try {
      await conn.describe(quoteObject);
    } catch (e) {
      throw new Error('Salesforce CPQ (SBQQ) is required. Please ensure it is installed and you have proper permissions.');
    }
    
    // Create quote with minimal required fields first
    const quoteFields: any = {
      SBQQ__Opportunity2__c: opportunityId,
      SBQQ__Status__c: scenario.status || 'Draft',
      SBQQ__Primary__c: true
    };

    // Only set the name if we have permission
    try {
      const describeResult = await conn.describe(quoteObject);
      const nameField = describeResult.fields.find((f: SalesforceField) => f.name === 'Name');
      if (nameField?.updateable) {
        quoteFields.Name = scenario.name;
      }
    } catch (e) {
      console.warn('Warning: Could not verify Name field permissions, skipping Name field');
    }
    
    console.log(`Creating quote with fields:`, quoteFields);
    const quoteResult = await conn.sobject(quoteObject).create(quoteFields);
    
    if (!quoteResult.success) {
      throw new Error(`Failed to create quote: ${quoteResult.errors.join(', ')}`);
    }
    
    console.log(`Created quote with ID: ${quoteResult.id}`);
    
    // Update the amount separately to handle field permissions
    if (scenario.amount) {
      try {
        await conn.sobject(quoteObject).update({
          Id: quoteResult.id,
          SBQQ__ListAmount__c: scenario.amount,  // Try List Amount instead of Net Amount
          SBQQ__CustomerAmount__c: scenario.amount  // Also set Customer Amount
        });
        console.log(`Updated quote amounts successfully`);
      } catch (e) {
        console.warn('Warning: Could not update quote amounts, continuing anyway:', e);
      }
    }
    
    // Create line items
    for (const item of scenario.lineItems) {
      try {
        const productId = await createProductIfNeeded(conn, item.productName);
        const pricebookEntryId = await getPricebookEntry(conn, productId, item.unitPrice);
        
        const lineItemFields: any = {
          SBQQ__Quote__c: quoteResult.id,
          SBQQ__Product__c: productId,
          SBQQ__Quantity__c: item.quantity,
          SBQQ__ListPrice__c: item.unitPrice,  // Use ListPrice instead of NetPrice
          SBQQ__CustomerPrice__c: item.unitPrice  // Also set CustomerPrice
        };
        
        const lineItemResult = await conn.sobject('SBQQ__QuoteLine__c').create(lineItemFields);
        
        if (!lineItemResult.success) {
          console.error(`Failed to create line item: ${lineItemResult.errors.join(', ')}`);
        } else {
          console.log(`Created line item for ${item.productName}, quantity: ${item.quantity}`);
        }
      } catch (e) {
        console.warn(`Warning: Could not create line item for ${item.productName}:`, e);
      }
    }
    
    return quoteResult.id;
  } catch (error) {
    console.error(`Error creating quote "${scenario.name}":`, error);
    throw error;
  }
};

// Function to write test scenarios to a markdown file
const writeTestScenarios = async (createdQuotes: Array<{id: string, name: string, scenario: any, instanceUrl: string}>) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Create markdown content
    let content = `# Q2C Slack Bot Test Scenarios\n\n`;
    content += `This file contains test scenarios for the Q2C Slack Bot. Use these commands to test the bot's functionality.\n\n`;
    
    // General commands section
    content += `## General Commands\n\n`;
    content += `\`\`\`\n`;
    content += `@Q2C Bot help\n`;
    content += `@Q2C Bot list\n`;
    content += `@Q2C Bot status\n`;
    content += `@Q2C Bot about\n`;
    content += `\`\`\`\n\n`;
    
    // Quote-specific commands section
    content += `## Quote-Specific Commands\n\n`;
    
    // Add each scenario with its commands
    createdQuotes.forEach(quote => {
      const quoteUrl = `${quote.instanceUrl}/lightning/r/SBQQ__Quote__c/${quote.id}/view`;
      
      content += `### ${quote.name} (${quote.scenario.description})\n\n`;
      content += `**Quote URL:** ${quoteUrl}\n\n`;
      content += `**Test Commands:**\n\n`;
      content += `\`\`\`\n`;
      
      // Validate command
      content += `@Q2C Bot validate ${quote.id}\n\n`;
      
      // Custom command based on scenario
      if (quote.scenario.description.toLowerCase().includes('recall') || 
          quote.scenario.description.toLowerCase().includes('bump')) {
        content += `@Q2C Bot ${quoteUrl} Need to bump ${quote.scenario.lineItems[0].productName} from ${quote.scenario.lineItems[0].quantity} → ${quote.scenario.lineItems[0].quantity + 1}\n\n`;
      } 
      
      if (quote.scenario.description.toLowerCase().includes('approve')) {
        content += `@Q2C Bot ${quoteUrl} Please approve ASAP\n\n`;
      }
      
      if (quote.scenario.description.toLowerCase().includes('remove')) {
        const itemToRemove = quote.scenario.lineItems.find((item: {productName: string, quantity: number, unitPrice: number}) => 
          item.productName.toLowerCase().includes('fee') || item.productName.toLowerCase().includes('ai')
        );
        if (itemToRemove) {
          content += `@Q2C Bot ${quoteUrl} Remove ${itemToRemove.productName}\n\n`;
        }
      }
      
      if (quote.scenario.description.toLowerCase().includes('sms') || 
          quote.scenario.description.toLowerCase().includes('phone')) {
        content += `@Q2C Bot ${quoteUrl} DocuSign this quote and send to customer\n\n`;
      }
      
      content += `\`\`\`\n\n`;
    });
    
    // Add advanced examples section
    content += `## Advanced Query Examples\n\n`;
    content += `\`\`\`\n`;
    content += `@Q2C Bot what are all the quotes in our CPQ?\n`;
    content += `@Q2C Bot show me the details of quote ${createdQuotes[0].id}\n`;
    content += `@Q2C Bot can you update the quantity of GenWatt Diesel 1000 kW to 5 in quote ${createdQuotes[0].id}?\n`;
    content += `@Q2C Bot when will the quote ${createdQuotes[0].id} expire?\n`;
    content += `@Q2C Bot what's the approval status of all our pending quotes?\n`;
    content += `\`\`\`\n\n`;
    
    // Save the file
    const filePath = path.join(process.cwd(), 'slack-test-scenarios.md');
    fs.writeFileSync(filePath, content);
    
    console.log(`\n✅ Test scenarios written to ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('Error writing test scenarios:', error);
  }
};

// Main function to seed data
const seedData = async () => {
  try {
    console.log('🔑 Authenticating with Salesforce...');
    const token = await getAuthToken();
    const conn = createConnection(token);
    
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'Create individual scenario', value: 'CREATE_ONE' },
          { name: 'Create all demo scenarios', value: 'CREATE_ALL' },
          { name: 'Exit', value: 'EXIT' }
        ]
      }
    ]);
    
    if (action === 'EXIT') {
      console.log('Exiting without creating data.');
      return;
    }
    
    // Track created quotes for test scenarios
    const createdQuotes: Array<{id: string, name: string, scenario: any, instanceUrl: string}> = [];
    
    if (action === 'CREATE_ONE') {
      const { scenarioIndex } = await inquirer.prompt([
        {
          type: 'list',
          name: 'scenarioIndex',
          message: 'Select a scenario to create:',
          choices: demoScenarios.map((scenario, index) => ({
            name: `${scenario.name} - ${scenario.description}`,
            value: index
          }))
        }
      ]);
      
      const scenario = demoScenarios[scenarioIndex];
      console.log(`\nCreating scenario: ${scenario.name}`);
      
      const accountId = await createAccountIfNeeded(conn, scenario.account);
      const opportunityId = await createOpportunityIfNeeded(conn, scenario.opportunity, accountId);
      const quoteId = await createQuote(conn, scenario, opportunityId);
      
      console.log(`\n✅ Successfully created scenario "${scenario.name}"`);
      console.log(`Quote ID: ${quoteId}`);
      console.log(`Salesforce URL: ${token.instance_url}/lightning/r/SBQQ__Quote__c/${quoteId}/view`);
      
      // Add to created quotes
      createdQuotes.push({
        id: quoteId,
        name: scenario.name,
        scenario,
        instanceUrl: token.instance_url
      });
    } else {
      console.log('\nCreating all demo scenarios...');
      
      for (const scenario of demoScenarios) {
        console.log(`\n--- Creating scenario: ${scenario.name} ---`);
        
        const accountId = await createAccountIfNeeded(conn, scenario.account);
        const opportunityId = await createOpportunityIfNeeded(conn, scenario.opportunity, accountId);
        const quoteId = await createQuote(conn, scenario, opportunityId);
        
        console.log(`✅ Created scenario "${scenario.name}"`);
        console.log(`Quote ID: ${quoteId}`);
        console.log(`Salesforce URL: ${token.instance_url}/lightning/r/SBQQ__Quote__c/${quoteId}/view`);
        
        // Add to created quotes
        createdQuotes.push({
          id: quoteId,
          name: scenario.name,
          scenario,
          instanceUrl: token.instance_url
        });
      }
      
      console.log('\n🎉 All demo scenarios created successfully!');
    }
    
    // Write test scenarios to markdown file
    if (createdQuotes.length > 0) {
      const filePath = await writeTestScenarios(createdQuotes);
      console.log(`\n📋 Check ${filePath} for example Slack commands to test these scenarios`);
    }
    
  } catch (error) {
    console.error('\n❌ Error seeding data:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
};

// Execute if run directly
if (require.main === module) {
  seedData();
}

// Export all necessary functions
export { 
  seedData, 
  demoScenarios, 
  createAccountIfNeeded, 
  createOpportunityIfNeeded, 
  createQuote, 
  createProductIfNeeded, 
  getPricebookEntry 
}; 