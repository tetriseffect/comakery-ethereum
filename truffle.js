module.exports = {
  rpc: {
    host: "localhost"
  },

  networks: {
    "live": {
      network_id: 1, // Ethereum public network
      port: 9999,
      from: "0x03b3536e825a484f796b094e63011027620bc2a7"
      // optional config values
      // host - defaults to "localhost"
      // port - defaults to 8545
      // gas
      // gasPrice
      // from - default address to use for any transaction Truffle makes during migrations
    },
    "testnet": {
      network_id: 2, // morden
      port: 80,
      from: "0x5edb0f31d5d8c3146ea6f5c31c7f571c0aeb8fc2",
      port: 8888
    },
    "staging": {
      network_id: 1337 // custom private network
      // use default rpc settings
    },
    "test": {
      network_id: "default",
      port: 7777,
      from: "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
      "ethercamp-subdomain": "not-really"
    },
    "development": {
      network_id: "default",
      port: 7777,
      from: "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
    }
  },

  mocha: {
    "useColors": true
  }

}
