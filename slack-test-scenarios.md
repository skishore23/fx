# Q2C Slack Bot Test Scenarios

This file contains test scenarios for the Q2C Slack Bot. Use these commands to test the bot's functionality.

## General Commands

```
@Q2C Bot help
@Q2C Bot list
@Q2C Bot status
@Q2C Bot about
```

## Quote-Specific Commands

### GenWatt Diesel Recall (Need to recall so I can bump GenWatt Diesel 1000 kW from 2 → 3)

**Quote URL:** https://agentin-dev-ed.develop.my.salesforce.com/lightning/r/SBQQ__Quote__c/a0qbm000000hqZdAAI/view

**Test Commands:**

```
@Q2C Bot validate a0qbm000000hqZdAAI

@Q2C Bot https://agentin-dev-ed.develop.my.salesforce.com/lightning/r/SBQQ__Quote__c/a0qbm000000hqZdAAI/view Need to bump GenWatt Diesel 1000 kW from 2 → 3

```

### Edge Communications AI + Phones (Edge Communications | AI + Phones. Please approve ASAP.)

**Quote URL:** https://agentin-dev-ed.develop.my.salesforce.com/lightning/r/SBQQ__Quote__c/a0qbm000000hqbFAAQ/view

**Test Commands:**

```
@Q2C Bot validate a0qbm000000hqbFAAQ

@Q2C Bot https://agentin-dev-ed.develop.my.salesforce.com/lightning/r/SBQQ__Quote__c/a0qbm000000hqbFAAQ/view Please approve ASAP

@Q2C Bot https://agentin-dev-ed.develop.my.salesforce.com/lightning/r/SBQQ__Quote__c/a0qbm000000hqbFAAQ/view DocuSign this quote and send to customer

```

### Burlington Textiles Network Fee Removal (Remove network fee—customer owns all Cisco phones.)

**Quote URL:** https://agentin-dev-ed.develop.my.salesforce.com/lightning/r/SBQQ__Quote__c/a0qbm000000ho3DAAQ/view

**Test Commands:**

```
@Q2C Bot validate a0qbm000000ho3DAAQ

@Q2C Bot https://agentin-dev-ed.develop.my.salesforce.com/lightning/r/SBQQ__Quote__c/a0qbm000000ho3DAAQ/view Remove Network Setup Fee

@Q2C Bot https://agentin-dev-ed.develop.my.salesforce.com/lightning/r/SBQQ__Quote__c/a0qbm000000ho3DAAQ/view DocuSign this quote and send to customer

```

### United Oil Bulk SMS (Need 10 k bulk SMS for United Oil North—approve.)

**Quote URL:** https://agentin-dev-ed.develop.my.salesforce.com/lightning/r/SBQQ__Quote__c/a0qbm000000hqcrAAA/view

**Test Commands:**

```
@Q2C Bot validate a0qbm000000hqcrAAA

@Q2C Bot https://agentin-dev-ed.develop.my.salesforce.com/lightning/r/SBQQ__Quote__c/a0qbm000000hqcrAAA/view Please approve ASAP

@Q2C Bot https://agentin-dev-ed.develop.my.salesforce.com/lightning/r/SBQQ__Quote__c/a0qbm000000hqcrAAA/view DocuSign this quote and send to customer

```

### Express Logistics AI Removal (Remove AI and delay start to next month.)

**Quote URL:** https://agentin-dev-ed.develop.my.salesforce.com/lightning/r/SBQQ__Quote__c/a0qbm000000hqeTAAQ/view

**Test Commands:**

```
@Q2C Bot validate a0qbm000000hqeTAAQ

@Q2C Bot https://agentin-dev-ed.develop.my.salesforce.com/lightning/r/SBQQ__Quote__c/a0qbm000000hqeTAAQ/view Remove Enterprise AI License

```

## Advanced Query Examples

```
@Q2C Bot what are all the quotes in our CPQ?
@Q2C Bot show me the details of quote a0qbm000000hqZdAAI
@Q2C Bot can you update the quantity of GenWatt Diesel 1000 kW to 5 in quote a0qbm000000hqZdAAI?
@Q2C Bot when will the quote a0qbm000000hqZdAAI expire?
@Q2C Bot what's the approval status of all our pending quotes?
```

