# Q2C Slack Bot

A Quote-to-Cash (Q2C) agent that processes quotes in Salesforce CPQ through Slack, built with functional programming principles.

## Overview

The Q2C Slack Bot enables sales teams to:

1. Process quotes directly from Slack messages
2. Generate and validate quotes in Salesforce CPQ
3. Approve, reject, and modify quotes based on business rules
4. Send quotes via DocuSign

The bot uses natural language processing to understand requests from Slack messages and takes appropriate actions in Salesforce.

## Features

- **Slack Integration**: Process quote requests directly from Slack
- **Rules Engine**: Validate quotes against business rules
- **Reactive Agent**: Intelligent quote processing with proper validations
- **Demo Data Creation**: Generate test scenarios in Salesforce

## Setup

### Prerequisites

- Node.js 14+
- Salesforce account with CPQ installed
- Slack workspace with bot permissions

### Environment Variables

Create a `.env` file with the following variables:

```
# Salesforce Configuration
SF_CLIENT_ID=<your_salesforce_client_id>
SF_USERNAME=<your_salesforce_username>
SF_LOGIN_URL=https://login.salesforce.com
SF_PRIVATE_KEY_PATH=<path_to_server.key>

# Slack Configuration
SLACK_BOT_TOKEN=<your_slack_bot_token>
SLACK_SIGNING_SECRET=<your_slack_signing_secret>
SLACK_APP_TOKEN=<your_slack_app_token>

# OpenAI Configuration
OPENAI_API_KEY=<your_openai_api_key>
```

### Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

## Usage

### Testing Suite

The easiest way to test the system is using the testing suite:

```bash
npm run test
```

This will provide an interactive menu to:
- Start the Slack bot
- Send mock messages to test the bot
- Create demo data in Salesforce
- Run the CLI interface

### Running Components Individually

You can also run individual components:

**Start the Slack Bot:**
```bash
npm run start:bot
```

**Create Demo Data:**
```bash
npm run seed
```

**Send Mock Messages:**
```bash
npm run mock
```

**Run CLI Interface:**
```bash
npm run cli
```

## Slack Commands

The bot supports the following commands:

- `help`: Show available commands
- `list`: List all quotes
- `quote [ID]`: Process a specific quote
- `validate [ID]`: Validate a quote against rules
- `process`: Process all pending quotes
- `status`: Check current processing status
- `seed [index|all]`: Create demo data in Salesforce
- `about`: Learn about the bot

## Processing Quotes from Slack

Simply paste a Salesforce quote URL in a channel where the bot is present. The bot will:

1. Extract the quote ID from the URL
2. Analyze your message text to determine the intended action
3. Confirm the action with you
4. Execute the appropriate actions in Salesforce
5. Report back with results in the thread

Example:
> Need to recall so I can bump GenWatt Diesel 1000 kW from 2 → 3.
> https://yourorg--dev.lightning.force.com/lightning/r/SBQQ_Quote__c/a088x000000Wsv0AAC/view

## Architecture

The system follows functional programming principles and is built with:

- TypeScript for type safety
- Fx for functional composition and pure functions
- Zod for runtime validation
- Category theory concepts for handling side effects

## License

MIT 