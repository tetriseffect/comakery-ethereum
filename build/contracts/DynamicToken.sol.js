var Web3 = require("web3");

(function() {
  // Planned for future features, logging, etc.
  function Provider(provider) {
    this.provider = provider;
  }

  Provider.prototype.send = function() {
    this.provider.send.apply(this.provider, arguments);
  };

  Provider.prototype.sendAsync = function() {
    this.provider.sendAsync.apply(this.provider, arguments);
  };

  var BigNumber = (new Web3()).toBigNumber(0).constructor;

  var Utils = {
    is_object: function(val) {
      return typeof val == "object" && !Array.isArray(val);
    },
    is_big_number: function(val) {
      if (typeof val != "object") return false;

      // Instanceof won't work because we have multiple versions of Web3.
      try {
        new BigNumber(val);
        return true;
      } catch (e) {
        return false;
      }
    },
    merge: function() {
      var merged = {};
      var args = Array.prototype.slice.call(arguments);

      for (var i = 0; i < args.length; i++) {
        var object = args[i];
        var keys = Object.keys(object);
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var value = object[key];
          merged[key] = value;
        }
      }

      return merged;
    },
    promisifyFunction: function(fn, C) {
      var self = this;
      return function() {
        var instance = this;

        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {
          var callback = function(error, result) {
            if (error != null) {
              reject(error);
            } else {
              accept(result);
            }
          };
          args.push(tx_params, callback);
          fn.apply(instance.contract, args);
        });
      };
    },
    synchronizeFunction: function(fn, C) {
      var self = this;
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {

          var callback = function(error, tx) {
            if (error != null) {
              reject(error);
              return;
            }

            var timeout = C.synchronization_timeout || 240000;
            var start = new Date().getTime();

            var make_attempt = function() {
              C.web3.eth.getTransactionReceipt(tx, function(err, receipt) {
                if (err) return reject(err);

                if (receipt != null) {
                  return accept(tx, receipt);
                }

                if (timeout > 0 && new Date().getTime() - start > timeout) {
                  return reject(new Error("Transaction " + tx + " wasn't processed in " + (timeout / 1000) + " seconds!"));
                }

                setTimeout(make_attempt, 1000);
              });
            };

            make_attempt();
          };

          args.push(tx_params, callback);
          fn.apply(self, args);
        });
      };
    }
  };

  function instantiate(instance, contract) {
    instance.contract = contract;
    var constructor = instance.constructor;

    // Provision our functions.
    for (var i = 0; i < instance.abi.length; i++) {
      var item = instance.abi[i];
      if (item.type == "function") {
        if (item.constant == true) {
          instance[item.name] = Utils.promisifyFunction(contract[item.name], constructor);
        } else {
          instance[item.name] = Utils.synchronizeFunction(contract[item.name], constructor);
        }

        instance[item.name].call = Utils.promisifyFunction(contract[item.name].call, constructor);
        instance[item.name].sendTransaction = Utils.promisifyFunction(contract[item.name].sendTransaction, constructor);
        instance[item.name].request = contract[item.name].request;
        instance[item.name].estimateGas = Utils.promisifyFunction(contract[item.name].estimateGas, constructor);
      }

      if (item.type == "event") {
        instance[item.name] = contract[item.name];
      }
    }

    instance.allEvents = contract.allEvents;
    instance.address = contract.address;
    instance.transactionHash = contract.transactionHash;
  };

  // Use inheritance to create a clone of this contract,
  // and copy over contract's static functions.
  function mutate(fn) {
    var temp = function Clone() { return fn.apply(this, arguments); };

    Object.keys(fn).forEach(function(key) {
      temp[key] = fn[key];
    });

    temp.prototype = Object.create(fn.prototype);
    bootstrap(temp);
    return temp;
  };

  function bootstrap(fn) {
    fn.web3 = new Web3();
    fn.class_defaults  = fn.prototype.defaults || {};

    // Set the network iniitally to make default data available and re-use code.
    // Then remove the saved network id so the network will be auto-detected on first use.
    fn.setNetwork("default");
    fn.network_id = null;
    return fn;
  };

  // Accepts a contract object created with web3.eth.contract.
  // Optionally, if called without `new`, accepts a network_id and will
  // create a new version of the contract abstraction with that network_id set.
  function Contract() {
    if (this instanceof Contract) {
      instantiate(this, arguments[0]);
    } else {
      var C = mutate(Contract);
      var network_id = arguments.length > 0 ? arguments[0] : "default";
      C.setNetwork(network_id);
      return C;
    }
  };

  Contract.currentProvider = null;

  Contract.setProvider = function(provider) {
    var wrapped = new Provider(provider);
    this.web3.setProvider(wrapped);
    this.currentProvider = provider;
  };

  Contract.new = function() {
    if (this.currentProvider == null) {
      throw new Error("DynamicToken error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("DynamicToken error: contract binary not set. Can't deploy new instance.");
    }

    var regex = /__[^_]+_+/g;
    var unlinked_libraries = this.binary.match(regex);

    if (unlinked_libraries != null) {
      unlinked_libraries = unlinked_libraries.map(function(name) {
        // Remove underscores
        return name.replace(/_/g, "");
      }).sort().filter(function(name, index, arr) {
        // Remove duplicates
        if (index + 1 >= arr.length) {
          return true;
        }

        return name != arr[index + 1];
      }).join(", ");

      throw new Error("DynamicToken contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of DynamicToken: " + unlinked_libraries);
    }

    var self = this;

    return new Promise(function(accept, reject) {
      var contract_class = self.web3.eth.contract(self.abi);
      var tx_params = {};
      var last_arg = args[args.length - 1];

      // It's only tx_params if it's an object and not a BigNumber.
      if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
        tx_params = args.pop();
      }

      tx_params = Utils.merge(self.class_defaults, tx_params);

      if (tx_params.data == null) {
        tx_params.data = self.binary;
      }

      // web3 0.9.0 and above calls new twice this callback twice.
      // Why, I have no idea...
      var intermediary = function(err, web3_instance) {
        if (err != null) {
          reject(err);
          return;
        }

        if (err == null && web3_instance != null && web3_instance.address != null) {
          accept(new self(web3_instance));
        }
      };

      args.push(tx_params, intermediary);
      contract_class.new.apply(contract_class, args);
    });
  };

  Contract.at = function(address) {
    if (address == null || typeof address != "string" || address.length != 42) {
      throw new Error("Invalid address passed to DynamicToken.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: DynamicToken not deployed or address not set.");
    }

    return this.at(this.address);
  };

  Contract.defaults = function(class_defaults) {
    if (this.class_defaults == null) {
      this.class_defaults = {};
    }

    if (class_defaults == null) {
      class_defaults = {};
    }

    var self = this;
    Object.keys(class_defaults).forEach(function(key) {
      var value = class_defaults[key];
      self.class_defaults[key] = value;
    });

    return this.class_defaults;
  };

  Contract.extend = function() {
    var args = Array.prototype.slice.call(arguments);

    for (var i = 0; i < arguments.length; i++) {
      var object = arguments[i];
      var keys = Object.keys(object);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var value = object[key];
        this.prototype[key] = value;
      }
    }
  };

  Contract.all_networks = {
  "default": {
    "abi": [
      {
        "constant": false,
        "inputs": [
          {
            "name": "_upgradedContract",
            "type": "address"
          }
        ],
        "name": "upgrade",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "destroyContract",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_spender",
            "type": "address"
          },
          {
            "name": "_amount",
            "type": "uint256"
          }
        ],
        "name": "approve",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "totalSupply",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_from",
            "type": "address"
          },
          {
            "name": "_to",
            "type": "address"
          },
          {
            "name": "_amount",
            "type": "uint256"
          }
        ],
        "name": "transferFrom",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_amount",
            "type": "uint256"
          }
        ],
        "name": "burn",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "close",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "upgradedContract",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "isLockedOpen",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_maxSupply",
            "type": "uint256"
          }
        ],
        "name": "setMaxSupply",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "_owner",
            "type": "address"
          }
        ],
        "name": "balanceOf",
        "outputs": [
          {
            "name": "balance",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "name": "accountExists",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getAccounts",
        "outputs": [
          {
            "name": "_accounts",
            "type": "address[]"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_newOwner",
            "type": "address"
          }
        ],
        "name": "transferContractOwnership",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_to",
            "type": "address"
          },
          {
            "name": "_amount",
            "type": "uint256"
          }
        ],
        "name": "transfer",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "isMaxSupplyLocked",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "lockOpen",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "isClosed",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "proofIds",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "contractOwner",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "maxSupply",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "_owner",
            "type": "address"
          },
          {
            "name": "_spender",
            "type": "address"
          }
        ],
        "name": "allowance",
        "outputs": [
          {
            "name": "remaining",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_to",
            "type": "address"
          },
          {
            "name": "_amount",
            "type": "uint256"
          },
          {
            "name": "_proofId",
            "type": "string"
          }
        ],
        "name": "issue",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "accounts",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "lockMaxSupply",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "inputs": [],
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "_from",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "_to",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "_spender",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "_amount",
            "type": "uint256"
          }
        ],
        "name": "TransferFrom",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "_from",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "_to",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "_amount",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "_proofId",
            "type": "string"
          }
        ],
        "name": "Issue",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "_burnFrom",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "_amount",
            "type": "uint256"
          }
        ],
        "name": "Burn",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "_closedBy",
            "type": "address"
          }
        ],
        "name": "Close",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "_upgradedContract",
            "type": "address"
          }
        ],
        "name": "Upgrade",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "_by",
            "type": "address"
          }
        ],
        "name": "LockOpen",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "_from",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "_to",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "_amount",
            "type": "uint256"
          }
        ],
        "name": "Transfer",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "_owner",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "_spender",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "_amount",
            "type": "uint256"
          }
        ],
        "name": "Approval",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x606060405260068054600160a060020a031916331790556003805462ffffff191690556298968060045560006002556110ba8061003c6000396000f3606060405236156101275760e060020a60003504630900f010811461012f578063092a5cce1461014e578063095ea7b31461016757806318160ddd1461018357806323b872dd1461018c57806342966c68146101ab57806343d726d6146101c457806353b8e278146101e15780635ac77ad1146101f35780636f8b44b01461020557806370a082311461021e57806375cd51ed146102345780638a48ac031461024f578063a843c51f1461026e578063a9059cbb14610287578063b8ffc962146102a3578063bca1f81c146102b4578063c2b6b58c146102c7578063c7385f2e146102d3578063ce606ee014610368578063d5abeb011461037a578063dd62ed3e14610383578063ebf469dc1461039c578063f2a40db8146103fb578063fca76c2614610441575b610457610002565b61045960043560035460009062010000900460ff161561059257610002565b61045760035462010000900460ff16156105e657610002565b61045960043560243560035460009060ff161561068557610002565b61046d60025481565b61045960043560243560443560035460009060ff161561069357610002565b61045960043560035460009060ff16156107a757610002565b6104595b60035460009062010000900460ff16156108cf57610002565b61047f600554600160a060020a031681565b61045960035462010000900460ff1681565b61045960043560035460009060ff161561090957610002565b61046d6004356000600034111561096757610002565b61045960043560096020526000908152604090205460ff1681565b61049c6040805160208101909152600080825234111561098657610002565b61045960043560035460009060ff16156109ec57610002565b61045960043560243560035460009060ff1615610a3057610002565b610459600354610100900460ff1681565b61045760035460ff1615610a5057610002565b61045960035460ff1681565b6104e66004356008805482908110156100025750600052604080517ff3f7a9fe364faab93b216da50a3214154f22a0a2b415b23a84c8169e8b636ee39092018054602060026001831615610100026000190190921691909104601f8101829004820285018201909352828452909190830182828015610aec5780601f10610ac157610100808354040283529160200191610aec565b61047f600654600160a060020a031681565b61046d60045481565b61046d60043560243560006000341115610af457610002565b604080516020604435600481810135601f810184900484028501840190955284845261045994813594602480359593946064949293910191819084018382808284375094965050505050505060035460009060ff1615610b2057610002565b61047f60043560078054829081101561000257506000527fa66cc928b5edb82af9bd49922954155ab7b0942694bea4ce44661d9a8736c6880154600160a060020a031681565b61045960035460009060ff1615610cf357610002565b005b604080519115158252519081900360200190f35b60408051918252519081900360200190f35b60408051600160a060020a03929092168252519081900360200190f35b60405180806020018281038252838181518152602001915080519060200190602002808383829060006004602084601f0104600f02600301f1509050019250505060405180910390f35b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600f02600301f150905090810190601f1680156105465780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b50604051600160a060020a038316907ff78721226efe9a1bb678189a16d1554928b9f2192e2cb93eeda83b79fa40007d90600090a25060015b919050565b60035460ff16156105a257610002565b600654600160a060020a0390811633909116146105be57610002565b60003411156105cc57610002565b60058054600160a060020a031916831790556105546101c8565b600654600160a060020a03908116339091161461060257610002565b600034111561061057610002565b600654600160a060020a0316ff5b600160a060020a03338116600081815260016020908152604080832094881680845294825291829020869055815186815291517f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b9259281900390910190a35060015b92915050565b600034111561061e57610002565b60003411156106a157610002565b600160a060020a03848116600090815260016020908152604080832033909416835292905220548211156106d7575060006107a0565b600160a060020a038481166000908152600160209081526040808320339490941683529290522054828103111561070d57610002565b6107278484845b60035460009060ff1615610d3357610002565b1561079c57600160a060020a0384811660008181526001602090815260408083203386168085529083529281902080548890039055805187815290519294881693927f5f7542858008eeb041631f30e6109ae94b83a58e9a58261dd2c42c508850f939929181900390910190a45060016107a0565b5060005b9392505050565b60003411156107b557610002565b33600160a060020a03166000908152602081905260409020548211156107dd5750600061058d565b6002548211156107ec57610002565b33600160a060020a0316600090815260208190526040902054828103111561081357610002565b600254828103111561082457610002565b33600160a060020a03166000818152602081815260409182902080548690039055600280548690039055815185815291517fcc16f5dbb4873280815c1ee09dbd06736cffcc184412cf7a71a0fdb75d397ca59281900390910190a250600161058d565b6003805460ff1916600117905560405133600160a060020a0316907f5b19963bf6a9a00776cbf844c84e706258ed0ca06d00f699e9d99858942c750390600090a25060015b90565b60035460ff16156108df57610002565b600654600160a060020a0390811633909116146108fb57610002565b600034111561088757610002565b600654600160a060020a03908116339091161461092557610002565b600034111561093357610002565b60025482101561094257610002565b600354610100900460ff161561095a5750600061058d565b506004819055600161058d565b50600160a060020a03811660009081526020819052604090205461058d565b60076000508054806020026020016040519081016040528092919081815260200182805480156109e057602002820191906000526020600020905b8154600160a060020a03168152600191909101906020018083116109c1575b505050505090506108cc565b600654600160a060020a039081163390911614610a0857610002565b6000341115610a1657610002565b5060068054600160a060020a03191682179055600161058d565b6000341115610a3e57610002565b610a49338484610714565b905061067f565b600654600160a060020a039081163390911614610a6c57610002565b6000341115610a7a57610002565b6003805462ff000019166201000017905560405133600160a060020a0316907fd32e48c0900c6891ae610f3a319c7fb44b079df9c8c8544ceb6affd665da87c490600090a2565b820191906000526020600020905b815481529060010190602001808311610acf57829003601f168201915b505050505081565b50600160a060020a0382811660009081526001602090815260408083209385168352929052205461067f565b600654600160a060020a039081163390911614610b3c57610002565b6000341115610b4a57610002565b600160a060020a0384166000908152602081905260409020548381011015610b7157610002565b6002548381011015610b8257610002565b600a60005082604051808280519060200190808383829060006004602084601f0104600f02600301f150905001915050908152602001604051809103902060009054906101000a900460ff1615610bdb575060006107a0565b60045460025484011115610bf1575060006107a0565b600160a060020a03841660009081526020819052604090208054840190556002805484019055610c2c845b60035460ff1615610e5557610002565b610c408260035460ff1615610f0557610002565b83600160a060020a031633600160a060020a03167f0492600ee4c0def41b340097eee4bfb842453eb79af2c5f80abd41d8c65ee20b858560405180838152602001806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600f02600301f150905090810190601f168015610cdd5780820380516001836020036101000a031916815260200191505b50935050505060405180910390a35060016107a0565b60065433600160a060020a03908116911614610d0e57610002565b6000341115610d1c57610002565b506003805461ff00191661010017905560016108cc565b600160a060020a038416600090815260208190526040902054821115610d5b575060006107a0565b600160a060020a0383166000908152602081905260409020548083011015610d8257610002565b600160a060020a0384166000908152602081905260409020548281031115610da957610002565b600160a060020a0383811660009081526020819052604080822080548601905591861681522080548390039055610ddf83610c1c565b82600160a060020a031684600160a060020a03167fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef846040518082815260200191505060405180910390a35060016107a0565b5050506000928352506020909120018054600160a060020a031916821790555b50565b600160a060020a03811660009081526009602052604090205460ff1615610e7b57610e52565b600160a060020a0381166000908152600960205260409020805460ff19166001908117909155600780549182018082559091908281838015829011610e3257818360005260206000209182019101610e329190610eed565b601f01602090049060005260206000209081019061104c91905b80821115610f015760008155600101610eed565b5090565b600a60005081604051808280519060200190808383829060006004602084601f0104600f02600301f150905001915050908152602001604051809103902060009054906101000a900460ff1615610f5b57610e52565b6001600a60005082604051808280519060200190808383829060006004602084601f0104600f02600301f150905001915050908152602001604051809103902060006101000a81548160ff0219169083021790555060086000508054806001018281815481835581811511610fe357818360005260206000209182019101610fe39190611052565b5050509190906000526020600020900160008390919091509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061108457805160ff19168380011785555b506110b4929150610eed565b50506001015b80821115610f01576000818150805460018160011615610100020316600290046000825580601f10610ed3575061104c565b82800160010185558215611040579182015b82811115611040578251826000505591602001919060010190611096565b5050505056",
    "updated_at": 1469506604050,
    "links": {},
    "address": "0xd7d31f306fbefac7abb38a7486a5c37c6e0655b8"
  }
};

  Contract.checkNetwork = function(callback) {
    var self = this;

    if (this.network_id != null) {
      return callback();
    }

    this.web3.version.network(function(err, result) {
      if (err) return callback(err);

      var network_id = result.toString();

      // If we have the main network,
      if (network_id == "1") {
        var possible_ids = ["1", "live", "default"];

        for (var i = 0; i < possible_ids.length; i++) {
          var id = possible_ids[i];
          if (Contract.all_networks[id] != null) {
            network_id = id;
            break;
          }
        }
      }

      if (self.all_networks[network_id] == null) {
        return callback(new Error(self.name + " error: Can't find artifacts for network id '" + network_id + "'"));
      }

      self.setNetwork(network_id);
      callback();
    })
  };

  Contract.setNetwork = function(network_id) {
    var network = this.all_networks[network_id] || {};

    this.abi             = this.prototype.abi             = network.abi;
    this.unlinked_binary = this.prototype.unlinked_binary = network.unlinked_binary;
    this.address         = this.prototype.address         = network.address;
    this.updated_at      = this.prototype.updated_at      = network.updated_at;
    this.links           = this.prototype.links           = network.links || {};

    this.network_id = network_id;
  };

  Contract.networks = function() {
    return Object.keys(this.all_networks);
  };

  Contract.link = function(name, address) {
    if (typeof name == "object") {
      Object.keys(name).forEach(function(n) {
        var a = name[n];
        Contract.link(n, a);
      });
      return;
    }

    Contract.links[name] = address;
  };

  Contract.contract_name   = Contract.prototype.contract_name   = "DynamicToken";
  Contract.generated_with  = Contract.prototype.generated_with  = "3.1.2";

  var properties = {
    binary: function() {
      var binary = Contract.unlinked_binary;

      Object.keys(Contract.links).forEach(function(library_name) {
        var library_address = Contract.links[library_name];
        var regex = new RegExp("__" + library_name + "_*", "g");

        binary = binary.replace(regex, library_address.replace("0x", ""));
      });

      return binary;
    }
  };

  Object.keys(properties).forEach(function(key) {
    var getter = properties[key];

    var definition = {};
    definition.enumerable = true;
    definition.configurable = false;
    definition.get = getter;

    Object.defineProperty(Contract, key, definition);
    Object.defineProperty(Contract.prototype, key, definition);
  });

  bootstrap(Contract);

  if (typeof module != "undefined" && typeof module.exports != "undefined") {
    module.exports = Contract;
  } else {
    // There will only be one version of this contract in the browser,
    // and we can use that.
    window.DynamicToken = Contract;
  }
})();
