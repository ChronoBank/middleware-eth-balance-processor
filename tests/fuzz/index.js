/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const models = require('../../models'),
  config = require('../../config'),
  _ = require('lodash'),
  expect = require('chai').expect,
  Promise = require('bluebird'),
  RMQTxModel = require('middleware-common-components/models/rmq/eth/txModel'),
  spawn = require('child_process').spawn;

module.exports = (ctx) => {

  before(async () => {
    await models.txModel.remove({});
    await models.txLogModel.remove({});
    await models.accountModel.remove({});
    await ctx.amqp.channel.deleteQueue(`${config.rabbit.serviceName}.balance_processor`);

    ctx.balanceProcessorPid = spawn('node', ['index.js'], {env: process.env, stdio: 'ignore'});
    await Promise.delay(5000);

    for (let address of _.take(ctx.accounts, 2))
      await models.accountModel.create({
        address: address,
        balance: '0',
        erc20token: [],
        isActive: true
      });
  });



  it('validate balance processor update balance ability', async () => {


    let txReceipt = await ctx.web3.eth.sendTransaction({
      from: ctx.accounts[0],
      to: ctx.accounts[1],
      value: 1000
    });


    let tx = await ctx.web3.eth.getTransaction(txReceipt.transactionHash);

    let transformedTransaction = {
      hash: tx.hash,
      blockNumber: tx.blockNumber,
      blockHash: tx.blockHash,
      transactionIndex: tx.transactionIndex,
      from: tx.from ? tx.from.toLowerCase() : null,
      to: tx.to ? tx.to.toLowerCase() : null,
      gas: tx.gas.toString(),
      gasPrice: tx.gasPrice.toString(),
      gasUsed: txReceipt.gasUsed ? txReceipt.gasUsed.toString() : '21000',
      logs: tx.logs,
      nonce: tx.nonce,
      value: tx.value
    };


    new RMQTxModel(transformedTransaction);

    await ctx.amqp.channel.assertQueue(`app_${config.rabbit.serviceName}_test_fuzz.balance`, {autoDelete: true});
    await ctx.amqp.channel.bindQueue(`app_${config.rabbit.serviceName}_test_fuzz.balance`, 'events', `${config.rabbit.serviceName}_balance.${ctx.accounts[0]}`);
    await ctx.amqp.channel.publish('events', `${config.rabbit.serviceName}_transaction.${ctx.accounts[0]}`, Buffer.from(JSON.stringify(transformedTransaction)));

    await new Promise((res) => {
      ctx.amqp.channel.consume(`app_${config.rabbit.serviceName}_test_fuzz.balance`, async data => {

        if (!data)
          return;

        const message = JSON.parse(data.content.toString());

        if (message.address === ctx.accounts[0]) {
          await ctx.amqp.channel.deleteQueue(`app_${config.rabbit.serviceName}_test_fuzz.balance`);
          res();
        }

      });
    });

    let account = await models.accountModel.findOne({address: ctx.accounts[0]});
    expect(parseInt(account.balance)).to.be.above(0);
  });


  it('kill balance processor', async () => {
    ctx.balanceProcessorPid.kill();
  });

  it('send notification and restart balance processor', async () => {
    let account = await models.accountModel.findOne({address: ctx.accounts[0]});


    let txReceipt = await ctx.web3.eth.sendTransaction({
      from: ctx.accounts[0],
      to: ctx.accounts[1],
      value: 1000
    });


    let tx = await ctx.web3.eth.getTransaction(txReceipt.transactionHash);

    let transformedTransaction = {
      hash: tx.hash,
      blockNumber: tx.blockNumber,
      blockHash: tx.blockHash,
      transactionIndex: tx.transactionIndex,
      from: tx.from ? tx.from.toLowerCase() : null,
      to: tx.to ? tx.to.toLowerCase() : null,
      gas: tx.gas.toString(),
      gasPrice: tx.gasPrice.toString(),
      gasUsed: txReceipt.gasUsed ? txReceipt.gasUsed.toString() : '21000',
      logs: tx.logs,
      nonce: tx.nonce,
      value: tx.value
    };


    new RMQTxModel(transformedTransaction);

    await ctx.amqp.channel.publish('events', `${config.rabbit.serviceName}_transaction.${ctx.accounts[0]}`, Buffer.from(JSON.stringify(tx)));


    ctx.balanceProcessorPid = spawn('node', ['index.js'], {env: process.env, stdio: 'ignore'});
    await Promise.delay(20000);
    let accountUpdated = await models.accountModel.findOne({address: ctx.accounts[0]});
    expect(account.balance).to.not.eq(accountUpdated.balance);
  });


  after(async () => {
    ctx.balanceProcessorPid.kill();
  });


};
