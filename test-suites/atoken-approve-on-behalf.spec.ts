import { expect } from 'chai';
import rawBRE from 'hardhat';
import { MAX_UINT_AMOUNT, ZERO_ADDRESS } from '../helpers/constants';
import { ProtocolErrors } from '../helpers/types';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { makeSuite, TestEnv, initializeMakeSuite } from './helpers/make-suite';

makeSuite('AToken: approveOnBehalf', (testEnv: TestEnv) => {
  const { CALLER_NOT_POOL_ADMIN, ZERO_ADDRESS_NOT_VALID } = ProtocolErrors;

  before(async () => {
    await rawBRE.deployments.fixture(['market']);
    await initializeMakeSuite();
  });

  it('Pool admin can successfully execute approveOnBehalf', async () => {
    const { poolAdmin, users, aDai } = testEnv;
    const owner = users[0].address;
    const spender = users[1].address;
    const amount = await convertToCurrencyDecimals(aDai.address, '1000');

    await expect(aDai.connect(poolAdmin.signer).approveOnBehalf(owner, spender, amount))
      .to.emit(aDai, 'Approval')
      .withArgs(owner, spender, amount);

    expect(await aDai.allowance(owner, spender)).to.be.eq(amount);
  });

  it('Non pool admin role should fail', async () => {
    const { users, aDai } = testEnv;
    const nonPoolAdmin = users[3];
    const owner = users[0].address;
    const spender = users[1].address;
    const amount = await convertToCurrencyDecimals(aDai.address, '1000');

    await expect(
      aDai.connect(nonPoolAdmin.signer).approveOnBehalf(owner, spender, amount)
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Zero address owner parameter validation', async () => {
    const { poolAdmin, users, aDai } = testEnv;
    const spender = users[1].address;
    const amount = await convertToCurrencyDecimals(aDai.address, '1000');

    await expect(
      aDai.connect(poolAdmin.signer).approveOnBehalf(ZERO_ADDRESS, spender, amount)
    ).to.be.revertedWith(ZERO_ADDRESS_NOT_VALID);
  });

  it('Zero address spender parameter validation', async () => {
    const { poolAdmin, users, aDai } = testEnv;
    const owner = users[0].address;
    const amount = await convertToCurrencyDecimals(aDai.address, '1000');

    await expect(
      aDai.connect(poolAdmin.signer).approveOnBehalf(owner, ZERO_ADDRESS, amount)
    ).to.be.revertedWith(ZERO_ADDRESS_NOT_VALID);
  });

  it('Zero amount test', async () => {
    const { poolAdmin, users, aDai } = testEnv;
    const owner = users[0].address;
    const spender = users[1].address;
    const amount = 0;

    await expect(aDai.connect(poolAdmin.signer).approveOnBehalf(owner, spender, amount))
      .to.emit(aDai, 'Approval')
      .withArgs(owner, spender, amount);

    expect(await aDai.allowance(owner, spender)).to.be.eq(0);
  });

  it('Maximum amount test', async () => {
    const { poolAdmin, users, aDai } = testEnv;
    const owner = users[0].address;
    const spender = users[1].address;
    const amount = MAX_UINT_AMOUNT;

    await expect(aDai.connect(poolAdmin.signer).approveOnBehalf(owner, spender, amount))
      .to.emit(aDai, 'Approval')
      .withArgs(owner, spender, amount);

    expect(await aDai.allowance(owner, spender)).to.be.eq(MAX_UINT_AMOUNT);
  });

  it('Cover existing allowance', async () => {
    const { poolAdmin, users, aDai } = testEnv;
    const owner = users[0].address;
    const spender = users[1].address;

    // First approve a smaller amount
    const initialAmount = await convertToCurrencyDecimals(aDai.address, '500');
    await aDai.connect(poolAdmin.signer).approveOnBehalf(owner, spender, initialAmount);
    expect(await aDai.allowance(owner, spender)).to.be.eq(initialAmount);

    // Then approve a larger amount to cover the existing allowance
    const largerAmount = await convertToCurrencyDecimals(aDai.address, '1500');
    await expect(aDai.connect(poolAdmin.signer).approveOnBehalf(owner, spender, largerAmount))
      .to.emit(aDai, 'Approval')
      .withArgs(owner, spender, largerAmount);

    expect(await aDai.allowance(owner, spender)).to.be.eq(largerAmount);
  });

  it('Emergency admin permission check', async () => {
    const { emergencyAdmin, users, aDai } = testEnv;
    const owner = users[0].address;
    const spender = users[1].address;
    const amount = await convertToCurrencyDecimals(aDai.address, '1000');

    await expect(
      aDai.connect(emergencyAdmin.signer).approveOnBehalf(owner, spender, amount)
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Risk admin permission check', async () => {
    const { riskAdmin, users, aDai } = testEnv;
    const owner = users[0].address;
    const spender = users[1].address;
    const amount = await convertToCurrencyDecimals(aDai.address, '1000');

    await expect(
      aDai.connect(riskAdmin.signer).approveOnBehalf(owner, spender, amount)
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Multiple consecutive approveOnBehalf calls', async () => {
    const { poolAdmin, users, aDai } = testEnv;
    const owner = users[0].address;
    const spender1 = users[1].address;
    const spender2 = users[2].address;

    const amount1 = await convertToCurrencyDecimals(aDai.address, '1000');
    const amount2 = await convertToCurrencyDecimals(aDai.address, '2000');

    // First approval
    await expect(aDai.connect(poolAdmin.signer).approveOnBehalf(owner, spender1, amount1))
      .to.emit(aDai, 'Approval')
      .withArgs(owner, spender1, amount1);

    // Second approval
    await expect(aDai.connect(poolAdmin.signer).approveOnBehalf(owner, spender2, amount2))
      .to.emit(aDai, 'Approval')
      .withArgs(owner, spender2, amount2);

    expect(await aDai.allowance(owner, spender1)).to.be.eq(amount1);
    expect(await aDai.allowance(owner, spender2)).to.be.eq(amount2);
  });

  it('ApproveOnBehalf with same owner and spender', async () => {
    const { poolAdmin, users, aDai } = testEnv;
    const owner = users[0].address;
    const amount = await convertToCurrencyDecimals(aDai.address, '1000');

    await expect(aDai.connect(poolAdmin.signer).approveOnBehalf(owner, owner, amount))
      .to.emit(aDai, 'Approval')
      .withArgs(owner, owner, amount);

    expect(await aDai.allowance(owner, owner)).to.be.eq(amount);
  });

  it('Update existing allowance to zero', async () => {
    const { poolAdmin, users, aDai } = testEnv;
    const owner = users[0].address;
    const spender = users[1].address;

    // First approve a non-zero amount
    const initialAmount = await convertToCurrencyDecimals(aDai.address, '1000');
    await aDai.connect(poolAdmin.signer).approveOnBehalf(owner, spender, initialAmount);
    expect(await aDai.allowance(owner, spender)).to.be.eq(initialAmount);

    // Then update to zero
    await expect(aDai.connect(poolAdmin.signer).approveOnBehalf(owner, spender, 0))
      .to.emit(aDai, 'Approval')
      .withArgs(owner, spender, 0);

    expect(await aDai.allowance(owner, spender)).to.be.eq(0);
  });
});
