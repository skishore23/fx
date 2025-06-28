# Q2C Slack Bot Test Scenarios

This file contains test scenarios for the Q2C Slack Bot. Use these commands to test the bot's functionality.

## General Commands

```
@Q2C Bot help
@Q2C Bot list
@Q2C Bot status
@Q2C Bot about
```

## Example Quote-Specific Commands

```
@Q2C Bot validate <quote-id>
@Q2C Bot <quote-url> Need to bump <product-name> from 2 → 3
@Q2C Bot <quote-url> Please approve ASAP
@Q2C Bot <quote-url> Remove Network Setup Fee
@Q2C Bot <quote-url> DocuSign this quote and send to customer
```

## Advanced Query Examples

```
@Q2C Bot what are all the quotes in our CPQ?
@Q2C Bot show me the details of quote <quote-id>
@Q2C Bot can you update the quantity of GenWatt Diesel 1000 kW to 5 in quote <quote-id>?
@Q2C Bot when will the quote <quote-id> expire?
@Q2C Bot what's the approval status of all our pending quotes?
```

> Note: This file will be automatically updated with actual quote IDs and URLs when you run the seed data script. 