/* eslint-disable no-restricted-syntax */
/* eslint-disable no-loop-func */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-continue */
const { Scalar } = require('ffjavascript');

const ethers = require('ethers');
const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { argv } = require('yargs');
const {
    MemDB, stateUtils, ZkEVMDB, processorUtils, smtUtils, getPoseidon,
} = require('@0xpolygonhermez/zkevm-commonjs');

const { rawTxToCustomRawTx } = processorUtils;

// load list test-vectors
const { pathTestVectors } = require('../../helpers/helpers');

const folderStateTransition = path.join(pathTestVectors, './state-transition/no-data');
const folderInputsExecutor = path.join(pathTestVectors, './inputs-executor/no-data');
let listTests = fs.readdirSync(folderStateTransition);
listTests = listTests.filter((fileName) => path.extname(fileName) === '.json');

describe('Run state-transition tests', function () {
    this.timeout(20000);

    let update;
    let poseidon;
    let F;

    before(async () => {
        poseidon = await getPoseidon();
        F = poseidon.F;
        update = argv.update === true;
    });

    for (let i = 0; i < listTests.length; i++) {
        it(`check test vectors: ${listTests[i]}`, async () => {
            const pathTestVector = path.join(folderStateTransition, listTests[i]);
            const testVectors = JSON.parse(fs.readFileSync(pathTestVector));

            for (let j = 0; j < testVectors.length; j++) {
                const {
                    id,
                    genesis,
                    expectedOldRoot,
                    txs,
                    expectedNewRoot,
                    sequencerAddress,
                    expectedNewLeafs,
                    batchL2Data,
                    oldLocalExitRoot,
                    globalExitRoot,
                    batchHashData,
                    inputHash,
                    timestamp,
                    chainID,
                } = testVectors[j];

                const db = new MemDB(F);

                const walletMap = {};
                const addressArray = [];
                const amountArray = [];
                const nonceArray = [];

                // create genesis block
                for (let k = 0; k < genesis.length; k++) {
                    const {
                        address, pvtKey, balance, nonce,
                    } = genesis[k];

                    const newWallet = new ethers.Wallet(pvtKey);
                    expect(address).to.be.equal(newWallet.address);

                    walletMap[address] = newWallet;
                    addressArray.push(address);
                    amountArray.push(Scalar.e(balance));
                    nonceArray.push(Scalar.e(nonce));
                }

                /*
                * build, sign transaction and generate rawTxs
                * rawTxs would be the calldata inserted in the contract
                */
                const txProcessed = [];
                const rawTxs = [];
                for (let k = 0; k < txs.length; k++) {
                    const txData = txs[k];
                    const tx = {
                        to: txData.to,
                        nonce: txData.nonce,
                        value: ethers.utils.parseUnits(txData.value, 'wei'),
                        gasLimit: txData.gasLimit,
                        gasPrice: ethers.utils.parseUnits(txData.gasPrice, 'wei'),
                        chainId: txData.chainId,
                        data: txData.data || '0x',
                    };

                    try {
                        let rawTxEthers = await walletMap[txData.from].signTransaction(tx);
                        // apply overwrite
                        if (txData.overwrite) {
                            const txFields = ethers.utils.RLP.decode(rawTxEthers);
                            const txDecoded = {
                                nonce: txFields[0],
                                gasPrice: txFields[1],
                                gasLimit: txFields[2],
                                to: txFields[3],
                                value: txFields[4],
                                data: txFields[5],
                                v: txFields[6],
                                r: txFields[7],
                                s: txFields[8],
                            };

                            for (const paramOverwrite of Object.keys(txData.overwrite)) {
                                txDecoded[paramOverwrite] = txData.overwrite[paramOverwrite];
                            }

                            rawTxEthers = ethers.utils.RLP.encode([
                                txDecoded.nonce,
                                txDecoded.gasPrice,
                                txDecoded.gasLimit,
                                txDecoded.to,
                                txDecoded.value,
                                txDecoded.data,
                                txDecoded.v,
                                txDecoded.r,
                                txDecoded.s,
                            ]);
                        }

                        const customRawTx = rawTxToCustomRawTx(rawTxEthers);

                        if (update) {
                            testVectors[j].txs[k].customRawTx = customRawTx;
                            testVectors[j].txs[k].rawTx = rawTxEthers;
                        } else {
                            expect(txData.rawTx).to.equal(rawTxEthers);
                            expect(txData.customRawTx).to.equal(customRawTx);
                        }
                        rawTxs.push(customRawTx);
                        txProcessed.push(txData);
                    } catch (error) {
                        expect(txData.customRawTx).to.equal(undefined);
                    }
                }

                // create a zkEVMDB and build a batch
                const zkEVMDB = await ZkEVMDB.newZkEVM(
                    db,
                    poseidon,
                    [F.zero, F.zero, F.zero, F.zero],
                    smtUtils.stringToH4(oldLocalExitRoot),
                    genesis,
                    null,
                    null,
                    chainID,
                );

                // check genesis root
                for (let k = 0; k < addressArray.length; k++) {
                    const currentState = await stateUtils.getState(addressArray[k], zkEVMDB.smt, zkEVMDB.stateRoot);

                    expect(currentState.balance).to.be.equal(amountArray[k]);
                    expect(currentState.nonce).to.be.equal(nonceArray[k]);
                }

                if (update) {
                    testVectors[j].expectedOldRoot = smtUtils.h4toString(zkEVMDB.stateRoot);
                } else {
                    expect(smtUtils.h4toString(zkEVMDB.stateRoot)).to.be.equal(expectedOldRoot);
                }

                const batch = await zkEVMDB.buildBatch(timestamp, sequencerAddress, smtUtils.stringToH4(globalExitRoot));
                for (let k = 0; k < rawTxs.length; k++) {
                    batch.addRawTx(rawTxs[k]);
                }

                // execute the transactions added to the batch
                await batch.executeTxs();

                const newRoot = batch.currentStateRoot;

                if (update) {
                    testVectors[j].expectedNewRoot = smtUtils.h4toString(newRoot);
                    testVectors[j].chainID = 1000;
                } else {
                    expect(smtUtils.h4toString(newRoot)).to.be.equal(expectedNewRoot);
                }

                // consoldate state
                await zkEVMDB.consolidate(batch);

                // Check balances and nonces
                for (const [address, leaf] of Object.entries(expectedNewLeafs)) { // eslint-disable-line
                    const newLeaf = await zkEVMDB.getCurrentAccountState(address);

                    if (update) {
                        const newLeafState = { balance: newLeaf.balance.toString(), nonce: newLeaf.nonce.toString() };
                        testVectors[j].expectedNewLeafs[address] = newLeafState;
                    } else {
                        expect(newLeaf.balance.toString()).to.equal(leaf.balance);
                        expect(newLeaf.nonce.toString()).to.equal(leaf.nonce);
                    }
                }

                // Check errors on decode transactions
                const decodedTx = await batch.getDecodedTxs();

                for (let k = 0; k < decodedTx.length; k++) {
                    const currentTx = decodedTx[k];
                    const expectedTx = txProcessed[k];
                    try {
                        if (update) {
                            testVectors[j].txs[k].reason = currentTx.reason;
                        } else {
                            expect(currentTx.reason).to.be.equal(expectedTx.reason);
                        }
                    } catch (error) {
                        // eslint-disable-next-line no-console
                        console.log({ currentTx }, { expectedTx });
                        throw new Error(`Batch Id : ${id} TxId:${expectedTx.id} ${error}`);
                    }
                }

                // Check the circuit input
                const circuitInput = await batch.getStarkInput();

                if (update) {
                    testVectors[j].batchL2Data = batch.getBatchL2Data();
                    testVectors[j].batchHashData = circuitInput.batchHashData;
                    testVectors[j].inputHash = circuitInput.inputHash;
                    testVectors[j].globalExitRoot = circuitInput.globalExitRoot;
                    testVectors[j].oldLocalExitRoot = circuitInput.oldLocalExitRoot;
                    testVectors[j].newLocalExitRoot = circuitInput.newLocalExitRoot;

                    const fileName = path.join(folderInputsExecutor, `${path.parse(listTests[i]).name}_${id}.json`);
                    await fs.writeFileSync(fileName, JSON.stringify(circuitInput, null, 2));
                } else {
                    // Check the encode transaction match with the vector test
                    expect(batchL2Data).to.be.equal(batch.getBatchL2Data());

                    // Check the batchHashData and the input hash
                    expect(batchHashData).to.be.equal(circuitInput.batchHashData);
                    expect(inputHash).to.be.equal(circuitInput.inputHash);
                }
            }

            if (update) {
                fs.writeFileSync(pathTestVector, JSON.stringify(testVectors, null, 2));
            }
        });
    }
});
