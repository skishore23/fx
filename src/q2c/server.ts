import express, { Request, Response } from 'express';
import { createOAuthConfig, getToken, SalesforceAPI, createConnection } from './salesforce';
import type { JWTConfig, OAuthToken, Quote } from './types';
import { q2cAgent, createInitialState, createAction } from './q2cAgent';
import Fx from '../index';
import { AgentActionType, AgentActionStatus } from './types';
import { isLeft } from './salesforce';

// Store token in memory (in production, use a secure session store)
let globalToken: OAuthToken | null = null;

// HTML templates
const getLoginPage = (error?: string) => `
  <h1>Salesforce Q2C Agent</h1>
  ${error ? `<p style="color: red">${error}</p>` : ''}
  <p>Using JWT authentication</p>
`;

const getQuotesPage = (quotes: Quote[]) => `
  <h1>Quotes</h1>
  <table>
    <tr>
      <th>ID</th>
      <th>Name</th>
      <th>Amount</th>
      <th>Status</th>
      <th>Actions</th>
    </tr>
    ${quotes.map(quote => `
      <tr>
        <td>${quote.id}</td>
        <td>${quote.name}</td>
        <td>${quote.amount}</td>
        <td>${quote.status}</td>
        <td>
          <a href="/process-quote/${quote.id}">Process</a>
        </td>
      </tr>
    `).join('')}
  </table>
`;

// Express app setup
const app = express();

export const startServer = (config: JWTConfig): Promise<OAuthToken> => {
  return new Promise(async (resolve, reject) => {
    try {
      // First get the initial token
      const tokenResult = await getToken({
        clientId: config.clientId,
        loginUrl: 'https://login.salesforce.com',  // Use production URL
        subject: 'shimikeri.kishore@gmail.com.cpq'  // Your Salesforce username
      });

      if (isLeft(tokenResult)) {
        throw new Error(`Failed to get initial token: ${tokenResult.left.message}`);
      }

      globalToken = tokenResult.right;
      resolve(tokenResult.right);

      // Start express server
      const port = process.env.PORT || 3000;

      app.get('/quotes', async (req, res) => {
        try {
          if (!globalToken) {
            throw new Error('No valid token available');
          }

          const conn = createConnection(globalToken);
          const quotes = await SalesforceAPI.listQuotes(conn);
          res.json(quotes);
        } catch (error) {
          console.error('Error fetching quotes:', error);
          res.status(500).json({ error: 'Failed to fetch quotes' });
        }
      });

      app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
      });

    } catch (error) {
      reject(error);
    }
  });
}; 