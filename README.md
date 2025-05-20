# Wallet Balance Checker

This script checks cryptocurrency balances across multiple blockchains for wallet addresses stored in a CSV file.

---

## 📌 What it does

- Reads wallet addresses from a CSV file
- Checks native coin balances (ETH, BNB, etc.) on multiple chains
- Checks ERC-20 token balances using the Panda Terminal API
- Saves all balances to CSV files
- Records any errors that occur during the process

---

## ⚙️ Requirements

- Node.js (v14 or newer)
- NPM (Node Package Manager)
- A CSV file named `wallet-list.csv` with wallet addresses

---

## 📦 Installation

1. Make sure you have Node.js installed. If not, download it from [nodejs.org](https://nodejs.org/).
2. Clone or download this repository to your computer.
3. Open a terminal/command prompt and navigate to the folder containing the script.
4. Install the required packages:

    ```bash
    npm install viem axios csv-parse csv-stringify
    ```

---

## Environment Setup

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Edit the `.env` file and add your Panda Terminal API authentication token:


## ▶️ How to Run

Simply type this command in your terminal:

```bash
node index.js
