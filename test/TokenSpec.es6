import {expect} from 'chai'
import {d} from 'lightsaber'

/* global Token */
/* global contract */
/* global it */
/* global describe */

const contractIt = (name, func) => {
  contract('', () => {
    it(name, func)
  })
}

const contractItOnly = (name, func) => {
  contract('', () => {
    it.only(name, func)
  })
}

contract('Token', (accounts) => {
  let anyone = accounts[9]

  let getUsers = (token) => {
    let alice = {address: accounts[0]}
    let bob = {address: accounts[1]}
    let charlie = {address: accounts[2]}

    return Promise.resolve().then(() => {
      return token.balanceOf.call(accounts[0])
    }).then((balance) => {
      alice.balance = balance.toNumber()
      return token.balanceOf.call(accounts[1])
    }).then((balance) => {
      bob.balance = balance.toNumber()
      return token.balanceOf.call(accounts[2])
    }).then((balance) => {
      charlie.balance = balance.toNumber()
    }).then(() => {
      // sometimes convenient to identify users by name, other times by role
      let manager = alice
      let spender = bob
      let recipient = charlie
      return {alice, bob, charlie,
        manager, spender, recipient}
    })
  }

  describe('expected test conditions', () => {
    contractIt('token balances of all accounts are zero', (done) => {
      const token = Token.deployed()
      Promise.resolve().then(() => {
        return getUsers(token)
      }).then(({alice, bob}) => {
        expect(alice.balance).to.equal(0)
        expect(bob.balance).to.equal(0)
      }).then(done).catch(done)
    })

    contractIt('allowances of all accounts are zero', (done) => {
      const token = Token.deployed()
      let alice, bob
      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        alice = users.alice
        bob = users.bob
        return token.allowance.call(alice.address, bob.address)
      }).then((allowance) => {
        expect(allowance.toNumber()).to.equal(0)
        return token.allowance.call(bob.address, alice.address)
      }).then((allowance) => {
        expect(allowance.toNumber()).to.equal(0)
        return token.allowance.call(alice.address, alice.address)
      }).then((allowance) => {
        expect(allowance.toNumber()).to.equal(0)
      }).then(done).catch(done)
    })
  })

  describe('Token#issue', () => {
    contractIt('should issue tokens from owner to a user', (done) => {
      const token = Token.deployed()
      const amount = 10
      let starting

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        starting = users
        token.issue(starting.bob.address, amount, {from: starting.alice.address})
      }).then(() => {
        return getUsers(token)
      }).then((ending) => {
        expect(ending.alice.balance).to.equal(0)
        expect(ending.bob.balance).to.equal(amount)
      }).then(done).catch(done)
    })

    contractIt('should only allow contract owner to issue new tokens', (done) => {
      const token = Token.deployed()
      const amount = 10
      let starting

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        starting = users
        return token.issue(starting.bob.address, amount, {from: starting.bob.address})
      }).then(() => {
        return getUsers(token)
      }).then((ending) => {
        expect(ending.alice.balance).to.equal(0)
        expect(ending.bob.balance).to.equal(0)
      }).then(done).catch(done)
    })
  })

  describe('Token#transfer', () => {
    contractIt('should transfer tokens from owner to a user', (done) => {
      const token = Token.deployed()
      let starting

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        starting = users
        token.issue(starting.alice.address, 20, {from: starting.alice.address})
      }).then(() => {
        token.transfer(starting.bob.address, 5, {from: starting.alice.address})
      }).then(() => {
        return getUsers(token)
      }).then((ending) => {
        expect(ending.alice.balance).to.equal(15)
        expect(ending.bob.balance).to.equal(5)
      }).then(done).catch(done)
    })

    contractIt('should transfer tokens from user to a user', (done) => {
      const token = Token.deployed()
      let starting

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        starting = users
        token.issue(starting.alice.address, 20, {from: starting.alice.address})
      }).then(() => {
        token.transfer(starting.bob.address, 5, {from: starting.alice.address})
      }).then(() => {
        token.transfer(starting.charlie.address, 5, {from: starting.bob.address})
      }).then(() => {
        return getUsers(token)
      }).then((ending) => {
        expect(ending.alice.balance).to.equal(15)
        expect(ending.bob.balance).to.equal(0)
        expect(ending.charlie.balance).to.equal(5)
      }).then(done).catch(done)
    })

    contractIt('should allow to token owner to transfer tokens to other users', (done) => {
      const token = Token.deployed()
      let starting

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        starting = users
        token.issue(starting.alice.address, 20, {from: starting.alice.address})
      }).then(() => {
        token.transfer(starting.bob.address, 5, {from: starting.alice.address})
      }).then(() => {
        token.transfer(starting.charlie.address, 5, {from: starting.bob.address})
      }).then(() => {
        return getUsers(token)
      }).then((ending) => {
        expect(ending.alice.balance).to.equal(15)
        expect(ending.bob.balance).to.equal(0)
        expect(ending.charlie.balance).to.equal(5)
      }).then(done).catch(done)
    })

    contractIt('should fire a Transfer event when a tranfer is sucessful', (done) => {
      const token = Token.deployed()
      let starting
      let events = token.allEvents()

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        starting = users
      }).then(() => {
        return token.issue(starting.alice.address, 20, {from: starting.alice.address})
      }).then(() => {
        return token.transfer(starting.bob.address, 5, {from: starting.alice.address})
      }).then(() => {
        return new Promise((resolve, reject) => {
          events.watch((error, log) => {
            if (error) reject(error)
            resolve(log)
          })
        })
      }).then((log) => {
        expect(log.args._from).to.equal(starting.alice.address)
        expect(log.args._to).to.equal(starting.bob.address)
        expect(log.args._amount.toNumber()).to.equal(5)
        done()  // we have completed successfully ONLY if we logged an event
      })
    })

    contractIt('should do nothing if sender does not have enough tokens', (done) => {
      const token = Token.deployed()
      const amount = 10
      let starting

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        starting = users
        token.transfer(starting.alice.address, amount, {from: starting.bob.address})
      }).then(() => {
        return getUsers(token)
      }).then((ending) => {
        expect(ending.alice.balance).to.equal(starting.alice.balance)
        expect(ending.bob.balance).to.equal(starting.bob.balance)
      }).then(done).catch(done)
    })

    contractIt('should do nothing if a the send value is a negative number', (done) => {
      const token = Token.deployed()
      const amount = -1
      let starting

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        starting = users
        token.transfer(starting.bob.address, amount, {from: starting.alice.address})
      }).then(() => {
        return getUsers(token)
      }).then((ending) => {
        expect(ending.alice.balance).to.equal(starting.alice.balance)
        expect(ending.bob.balance).to.equal(starting.bob.balance)
      }).then(done).catch(done)
    })
  })

  describe('Token#transferFrom', () => {
    contractIt('spender can spend within allowance set by manager', (done) => {
      const token = Token.deployed()
      let manager, spender, recipient

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        manager = users.manager.address
        spender = users.spender.address
        recipient = users.recipient.address
        token.issue(manager, 200, {from: manager})
      }).then(() => {
        token.approve(spender, 100, {from: manager})
      }).then(() => {
        return token.transferFrom(manager, recipient, 40, {from: spender})
      }).then(() => {
        return getUsers(token)
      }).then((ending) => {
        expect(ending.manager.balance).to.equal(160)
        expect(ending.spender.balance).to.equal(0)
        expect(ending.recipient.balance).to.equal(40)
      }).then(() => {
        return token.allowance.call(manager, spender, {from: anyone})
      }).then((allowance) => {
        expect(allowance.toNumber()).to.equal(60)
      }).then(done).catch(done)
    })

    contractIt('spender cannot spend more than allowance set by manager', (done) => {
      const token = Token.deployed()
      let manager, spender, recipient

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        manager = users.manager.address
        spender = users.spender.address
        recipient = users.recipient.address
        token.issue(manager, 200, {from: manager})
      }).then(() => {
        token.approve(spender, 100, {from: manager})
      }).then(() => {
        token.transferFrom(manager, recipient, 101, {from: spender})
      }).then(() => {
        return getUsers(token)
      }).then((ending) => {
        expect(ending.manager.balance).to.equal(200)
        expect(ending.spender.balance).to.equal(0)
        expect(ending.recipient.balance).to.equal(0)
      }).then(() => {
        return token.allowance.call(manager, spender, {from: anyone})
      }).then((allowance) => {
        expect(allowance.toNumber()).to.equal(100)
      }).then(done).catch(done)
    })

    contractIt('spender cannot spend more than current balance of manager', (done) => {
      const token = Token.deployed()
      let manager, spender, recipient

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        manager = users.manager.address
        spender = users.spender.address
        recipient = users.recipient.address
        token.issue(manager, 100, {from: manager})
      }).then(() => {
        token.approve(spender, 300, {from: manager})
      }).then(() => {
        return token.transferFrom(manager, recipient, 200, {from: spender})
      }).then(() => {
        return getUsers(token)
      }).then((ending) => {
        expect(ending.manager.balance).to.equal(100)
        expect(ending.spender.balance).to.equal(0)
        expect(ending.recipient.balance).to.equal(0)
      }).then(() => {
        return token.allowance.call(manager, spender, {from: anyone})
      }).then((allowance) => {
        expect(allowance.toNumber()).to.equal(300)
      }).then(done).catch(done)
    })

    contractIt('spender cannot send a negative token amount', (done) => {
      const token = Token.deployed()
      let manager, spender, recipient

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        manager = users.manager.address
        spender = users.spender.address
        recipient = users.recipient.address
        token.issue(manager, 100, {from: manager})
      }).then(() => {
        token.issue(recipient, 100, {from: manager})
      }).then(() => {
        token.approve(spender, 100, {from: manager})
      }).then(() => {
        token.approve(spender, 100, {from: recipient})
      }).then(() => {
        return token.transferFrom(manager, recipient, -1, {from: spender})
      }).then(() => {
        return getUsers(token)
      }).then((ending) => {
        expect(ending.manager.balance).to.equal(100)
        expect(ending.spender.balance).to.equal(0)
        expect(ending.recipient.balance).to.equal(100)
      }).then(() => {
        return token.allowance.call(manager, spender, {from: anyone})
      }).then((allowance) => {
        expect(allowance.toNumber()).to.equal(100)
      }).then(() => {
        return token.allowance.call(recipient, spender, {from: anyone})
      }).then((allowance) => {
        expect(allowance.toNumber()).to.equal(100)
      }).then(done).catch(done)
    })
  })

  describe('Token#approve', () => {
    contractIt('manager can approve allowance for spender to spend', (done) => {
      const token = Token.deployed()
      let manager, spender

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        manager = users.alice.address
        spender = users.bob.address
        token.approve(spender, 100, {from: manager})
      }).then(() => {
        return token.allowance.call(manager, spender, {from: anyone})
      }).then((allowance) => {
        expect(allowance.toNumber()).to.equal(100)
      }).then(done).catch(done)
    })
  })

  describe('Token#totalSupply', () => {
    contractIt('should default to 10 million total supply', (done) => {
      const token = Token.deployed()
      Promise.resolve().then(() => {
        return token.totalSupply()
      }).then((max) => {
        expect(max.toNumber()).to.equal(10e6)
      }).then(done).catch(done)
    })

    contractIt('should not allow owner to issue more than max tokens', (done) => {
      const token = Token.deployed()
      const amount = 10e6 + 1
      let starting

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        starting = users
        return token.issue(starting.bob.address, amount, {from: starting.alice.address})
      }).then(() => {
        return getUsers(token)
      }).then((ending) => {
        expect(ending.alice.balance).to.equal(0)
        expect(ending.bob.balance).to.equal(0)
      }).then(done).catch(done)
    })

    contractIt('should allow owner to issue max tokens', (done) => {
      const token = Token.deployed()
      const amount = 10e6
      let starting

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        starting = users
        return token.issue(starting.bob.address, amount, {from: starting.alice.address})
      }).then(() => {
        return getUsers(token)
      }).then((ending) => {
        expect(ending.alice.balance).to.equal(0)
        expect(ending.bob.balance).to.equal(10e6)
      }).then(done).catch(done)
    })
  })

  describe('Token#setTotalSupply', () => {
    contractIt('should allow owner to set totalSupply', (done) => {
      const token = Token.deployed()
      const newTotalSupply = 117

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        token.setTotalSupply(newTotalSupply, {from: users.alice.address})
      }).then(() => {
        return token.totalSupply()
      }).then((max) => {
        expect(max.toNumber()).to.equal(117)
      }).then(done).catch(done)
    })

    contractIt('should forbid non-owner from setting totalSupply', (done) => {
      const token = Token.deployed()
      const newTotalSupply = 117

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((users) => {
        token.setTotalSupply(newTotalSupply, {from: users.bob.address})
      }).then(() => {
        return token.totalSupply()
      }).then((max) => {
        expect(max.toNumber()).to.equal(10e6)
      }).then(done).catch(done)
    })
  })

  describe('Token#setOwner', () => {
    contractIt('should allow the owner to set a new owner', (done) => {
      const token = Token.deployed()
      let users

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((data) => {
        users = data
        token.setOwner(users.bob.address, {from: users.alice.address})
        return token.owner()
      }).then((newOwner) => {
        expect(newOwner.toString()).to.equal(users.bob.address)
      }).then(done).catch(done)
    })

    contractIt('should not allow other users to set a new owner', (done) => {
      const token = Token.deployed()
      let users

      Promise.resolve().then(() => {
        return getUsers(token)
      }).then((data) => {
        users = data
        token.setOwner(users.bob.address, {from: users.charlie.address})
        return token.owner()
      }).then((newOwner) => {
        expect(newOwner.toString()).to.not.equal(users.bob.address)
      }).then(done).catch(done)
    })
  })
})
