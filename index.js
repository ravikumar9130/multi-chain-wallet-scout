const fs = require('fs');
require('dotenv').config();
const { createPublicClient, http, formatEther, erc20Abi } = require('viem');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const path = require('path');
const axios = require('axios');

// Configuration for supported chains
const CHAINS = [
  {
    id: 1,
    name: 'Ethereum',
    rpcUrl: 'https://eth.llamarpc.com',
    nativeCurrency: { symbol: 'ETH', decimals: 18 }
  },
  {
    id: 56,
    name: 'BNB Chain',
    rpcUrl: 'https://bsc-dataseed.binance.org',
    nativeCurrency: { symbol: 'BNB', decimals: 18 }
  },
  {
    id: 137,
    name: 'Polygon',
    rpcUrl: 'https://polygon-rpc.com',
    nativeCurrency: { symbol: 'MATIC', decimals: 18 }
  },
  {
    id: 43114,
    name: 'Avalanche',
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    nativeCurrency: { symbol: 'AVAX', decimals: 18 }
  },
  {
    id: 10,
    name: 'Optimism',
    rpcUrl: 'https://mainnet.optimism.io',
    nativeCurrency: { symbol: 'ETH', decimals: 18 }
  },
  {
    id: 42161,
    name: 'Arbitrum',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    nativeCurrency: { symbol: 'ETH', decimals: 18 }
  },
  {
    id: 8453,
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    nativeCurrency: { symbol: 'ETH', decimals: 18 }
  },
  {
    id: 25,
    name: 'Cronos',
    rpcUrl: 'https://evm.cronos.org',
    nativeCurrency: { symbol: 'CRO', decimals: 18 }
  },
];

// Auth token for Panda Terminal API
const AUTH_TOKEN = process.env.AUTH_TOKEN;

// Array to collect all errors
const errors = [];

// Fetch token list for a specific chain ID
async function fetchTokenList(chainId) {
  try {
    const response = await axios.get(`https://tradeapi.pandaterminal.com/dex/guest/tokenlist/${chainId}`, {
      headers: {
        'authorization': `Bearer ${AUTH_TOKEN}`
      }
    });
    
    if (response.data && response.data.data) {
      return response.data.data;
    }
    return [];
  } catch (error) {
    console.error(`Error fetching token list for chain ${chainId}:`, error.message);
    errors.push({
      chain: String(chainId),
      token: 'N/A',
      tokenAddress: 'N/A',
      walletAddress: 'N/A',
      operation: 'fetchTokenList',
      error: error.message
    });
    return [];
  }
}

// Client cache to avoid creating new clients for the same chain
const clientCache = new Map();

// Get or create client for a specific chain
function getClient(chain) {
  if (!clientCache.has(chain.id)) {
    clientCache.set(
      chain.id,
      createPublicClient({
        chain: {
          id: chain.id,
          name: chain.name,
          rpcUrls: {
            default: { http: [chain.rpcUrl] }
          }
        },
        transport: http(chain.rpcUrl, {
          fetchOptions: {
            cache: 'no-store',
            credentials: 'omit',
          },
          retryCount: 3,
          retryDelay: 1000,
        })
      })
    );
  }
  return clientCache.get(chain.id);
}

// Delay function to handle rate limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Check native token balance on a specific chain
async function checkNativeBalance(address, chain) {
  try {
    const client = getClient(chain);
    const balance = await client.getBalance({ address });
    const formattedBalance = Number(formatEther(balance));
    
    return {
      chain: chain.name,
      tokenType: 'native',
      symbol: chain.nativeCurrency.symbol,
      balance: formattedBalance,
      tokenAddress: 'native',
      tokenName: chain.nativeCurrency.symbol
    };
  } catch (error) {
    console.error(`Error checking native balance on ${chain.name} for ${address}:`, error.message);
    errors.push({
      chain: chain.name,
      token: chain.nativeCurrency.symbol,
      tokenAddress: 'native',
      walletAddress: address,
      operation: 'checkNativeBalance',
      error: error.message
    });
    
    return {
      chain: chain.name,
      tokenType: 'native',
      symbol: chain.nativeCurrency.symbol,
      balance: 0,
      tokenAddress: 'native',
      tokenName: chain.nativeCurrency.symbol,
      error: error.message
    };
  }
}

// Check ERC20 token balance
async function checkERC20Balance(address, chain, token) {
  try {
    const client = getClient(chain);
    const balance = await client.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address]
    });
    
    const decimals = token.decimals || 18;
    const formattedBalance = Number(formatEther(balance, decimals));
    
    return {
      chain: chain.name,
      tokenType: 'erc20',
      symbol: token.symbol,
      balance: formattedBalance,
      tokenAddress: token.address,
      tokenName: token.name
    };
  } catch (error) {
    console.error(`Error checking ERC20 balance for ${token.symbol} on ${chain.name} for ${address}:`, error.message);
    
    errors.push({
      chain: chain.name,
      token: token.symbol,
      tokenAddress: token.address,
      walletAddress: address,
      operation: 'checkERC20Balance',
      error: error.message
    });
    
    return {
      chain: chain.name,
      tokenType: 'erc20',
      symbol: token.symbol,
      balance: 0,
      tokenAddress: token.address,
      tokenName: token.name,
      error: error.message
    };
  }
}

// Process all wallets from CSV file
async function processWallets() {
  try {
    // Read and parse the CSV file
    const csvData = fs.readFileSync('wallet-list.csv', 'utf8');
    const records = parse(csvData, {
      columns: true,
      skip_empty_lines: true
    });

    // Extract unique wallet addresses from the 'verified_credential_address' column
    // Only include addresses that are embedded wallets (format is "blockchain")
    const wallets = new Set();
    records.forEach(record => {
      const address = record.verified_credential_address;
      const format = record.verified_credential_format;
      
      if (address && address.startsWith('0x') && format === 'blockchain' && 
          record.verified_credential_walletProvider === 'embeddedWallet') {
        wallets.add(address);
      }
    });

    console.log(`Found ${wallets.size} unique embedded wallet addresses to check`);
    
    // Cache token lists for each chain
    const tokenLists = {};
    for (const chain of CHAINS) {
      console.log(`Fetching token list for ${chain.name} (Chain ID: ${chain.id})...`);
      tokenLists[chain.id] = await fetchTokenList(chain.id);
      console.log(`Found ${tokenLists[chain.id].length} tokens for ${chain.name}`);
      await delay(500); // Delay to avoid rate limiting
    }
    
    // Results array for all wallets
    const results = [];
    let count = 0;
    
    // Check balance for each wallet on all chains
    for (const address of wallets) {
      count++;
      console.log(`Checking wallet ${count}/${wallets.size}: ${address}`);
      
      for (const chain of CHAINS) {
        // Add delay between chains to avoid rate limiting
        await delay(300);
        
        // Check native token balance
        const nativeBalance = await checkNativeBalance(address, chain);
        results.push({
          address,
          ...nativeBalance
        });
        
        // Check ERC20 token balances
        const tokens = tokenLists[chain.id] || [];
        
        // Only check a subset of tokens to prevent excessive API calls
        const tokensToCheck = tokens.slice(0, 20); // Limit to first 20 tokens per chain
        
        for (const token of tokensToCheck) {
          await delay(300); // Delay between token checks
          
          const tokenBalance = await checkERC20Balance(address, chain, token);
          results.push({
            address,
            ...tokenBalance
          });
        }
        
        console.log(`Completed checks for ${chain.name}`);
      }
      
      // Add a longer delay after checking every wallet
      if (count % 3 === 0) {
        console.log(`Processed ${count}/${wallets.size} wallets, pausing for rate limits...`);
        await delay(5000); // 5 second pause
      }
    }
    
    // Write results to CSV
    const outputCsv = stringify(results, { header: true });
    const outputPath = path.join(__dirname, 'wallet-balances.csv');
    fs.writeFileSync(outputPath, outputCsv);
    
    // Create another CSV with only non-zero balances
    const nonZeroBalances = results.filter(result => result.balance > 0);
    const nonZeroOutputCsv = stringify(nonZeroBalances, { header: true });
    const nonZeroOutputPath = path.join(__dirname, 'wallets-with-balance.csv');
    fs.writeFileSync(nonZeroOutputPath, nonZeroOutputCsv);
    
    // Write all errors to both CSV and JSON
    const errorOutputCsv = stringify(errors, { header: true });
    const errorCsvPath = path.join(__dirname, 'balance-check-errors.csv');
    fs.writeFileSync(errorCsvPath, errorOutputCsv);
    
    const errorOutputJson = JSON.stringify(errors, null, 2);
    const errorJsonPath = path.join(__dirname, 'balance-check-errors.json');
    fs.writeFileSync(errorJsonPath, errorOutputJson);
    
    console.log(`Process complete. Checked ${wallets.size} wallets.`);
    console.log(`All results saved to: ${outputPath}`);
    console.log(`Non-zero balances saved to: ${nonZeroOutputPath}`);
    console.log(`Found ${nonZeroBalances.length} entries with non-zero balances.`);
    console.log(`Logged ${errors.length} errors to ${errorCsvPath} and ${errorJsonPath}`);
    
  } catch (error) {
    console.error('Error processing wallets:', error);
    errors.push({
      chain: 'N/A',
      token: 'N/A',
      tokenAddress: 'N/A',
      walletAddress: 'N/A',
      operation: 'processWallets',
      error: error.message
    });
    
    // Even if the main process fails, try to write errors
    try {
      const errorOutputCsv = stringify(errors, { header: true });
      const errorCsvPath = path.join(__dirname, 'balance-check-errors.csv');
      fs.writeFileSync(errorCsvPath, errorOutputCsv);
      
      const errorOutputJson = JSON.stringify(errors, null, 2);
      const errorJsonPath = path.join(__dirname, 'balance-check-errors.json');
      fs.writeFileSync(errorJsonPath, errorOutputJson);
      
      console.log(`Logged ${errors.length} errors to ${errorCsvPath} and ${errorJsonPath}`);
    } catch (writeError) {
      console.error('Failed to write error logs:', writeError);
    }
  }
}

// Run the script
processWallets().catch(console.error);