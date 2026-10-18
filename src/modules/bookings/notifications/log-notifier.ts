import { Injectable, Logger } from '@nestjs/common';
import { NotificationCopy } from '../../notifications/notification-localization';
import { BaseNotifier } from './base-notifier';
import { PushSendOutcome } from './push-send-outcome';

/** DEV/TEST DEFAULT — logs what would have been sent instead of calling a real push provider. No Firebase credentials required. */
@Injectable()
export class LogNotifier extends BaseNotifier {
  private readonly logger = new Logger(LogNotifier.name);

  protected async sendPush(tokens: string[], copy: NotificationCopy): Promise<PushSendOutcome[]> {
    return tokens.map((token) => {
      this.logger.log(
        `[LogNotifier (DEV ONLY)] -> ...${token.slice(-6)}: "${copy.title}" — "${copy.body}" ` +
          `data=${JSON.stringify(copy.data)}`,
      );
      return {
        token,
        success: true,
        providerMessageId: null,
        shouldDeactivate: false,
        errorMessage: null,
      };
    });
  }
}
