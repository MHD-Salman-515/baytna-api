import { envFilePath, assertValidEnv, describeConfiguredMongoUri } from '../config/load-env'; // MUST be the first import: loads .env as a side effect, before anything else reads process.env

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { applyDnsServersFromEnv } from '../config/apply-dns-servers';
import { preflightMongoDns } from '../config/preflight-mongo-dns';
import { redactMongoUrisInText } from '../config/redact-connection-string';
import { AppModule } from '../app.module';
import { Wallet, WalletDocument } from '../modules/wallets/schemas/wallet.schema';
import { WalletEntry, WalletEntryDocument } from '../modules/wallets/schemas/wallet-entry.schema';
import { assertLocalMongoUri } from './seeders/seed-guard';

const logger = new Logger('WalletVerify');

/**
 * The wallet document's cached `balance` is a read-side convenience only —
 * this script is the thing that actually audits the ledger. It recomputes
 * every wallet's balance from the sum of its wallet_entries and reports any
 * drift loudly (non-zero exit). Drift here means a bug, most plausibly the
 * narrow crash window WalletsService.recordEntry documents: a process
 * killed between its $inc on the wallet and the entry insert/undo, since
 * local MongoDB (no replica set) can't wrap that pair in a transaction.
 */
async function bootstrap(): Promise<void> {
  logger.log(`Env file: ${envFilePath}`);
  assertValidEnv();
  assertLocalMongoUri(process.env.MONGODB_URI as string);
  applyDnsServersFromEnv();
  await preflightMongoDns(process.env.MONGODB_URI as string);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  let ok = true;

  try {
    logger.log(`Verifying against ${describeConfiguredMongoUri()}`);

    const walletModel = app.get<Model<WalletDocument>>(getModelToken(Wallet.name));
    const entryModel = app.get<Model<WalletEntryDocument>>(getModelToken(WalletEntry.name));

    const wallets = await walletModel.find({}).exec();
    logger.log(`wallets: ${wallets.length} document(s)`);

    let driftCount = 0;
    for (const wallet of wallets) {
      const entries = await entryModel.find({ walletId: wallet.id }).sort({ createdAt: 1 }).exec();
      const recomputedBalance = entries.reduce((sum, entry) => sum + entry.amount, 0);

      if (recomputedBalance !== wallet.balance) {
        logger.error(
          `[DRIFT] wallet ${wallet.id as string} (worker ${wallet.workerProfileId.toString()}): ` +
            `cached balance ${wallet.balance} !== sum of ${entries.length} entries ${recomputedBalance}`,
        );
        driftCount++;
        ok = false;
        continue;
      }

      // The ledger must also agree with itself: each entry's own recorded
      // balanceAfter should equal the running sum up to and including it.
      let runningBalance = 0;
      for (const entry of entries) {
        runningBalance += entry.amount;
        if (entry.balanceAfter !== null && entry.balanceAfter !== runningBalance) {
          logger.error(
            `[DRIFT] wallet entry ${entry.id as string} (wallet ${wallet.id as string}): ` +
              `recorded balanceAfter ${entry.balanceAfter} !== running sum ${runningBalance}`,
          );
          driftCount++;
          ok = false;
        }
      }
    }

    logger.log(
      driftCount === 0
        ? `All ${wallets.length} wallet(s) verified — zero drift`
        : `${driftCount} drift issue(s) found across ${wallets.length} wallet(s)`,
    );
  } finally {
    await app.close();
  }

  if (!ok) {
    logger.error('wallet:verify FAILED');
    process.exit(1);
  }
  logger.log('wallet:verify PASSED');
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(redactMongoUrisInText(message));
  process.exit(1);
});
