import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationLogService } from './notification-log.service';
import {
  NotificationChannel,
  NotificationLog,
  NotificationOutcome,
} from './schemas/notification-log.schema';

function chainable(resolvedValue: unknown) {
  const chain: Record<string, jest.Mock> = {};
  ['sort', 'skip', 'limit'].forEach((m) => (chain[m] = jest.fn().mockReturnValue(chain)));
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

describe('NotificationLogService', () => {
  let service: NotificationLogService;
  let logModel: { create: jest.Mock; find: jest.Mock; countDocuments: jest.Mock };

  beforeEach(async () => {
    logModel = { create: jest.fn(), find: jest.fn(), countDocuments: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationLogService,
        { provide: getModelToken(NotificationLog.name), useValue: logModel },
      ],
    }).compile();

    service = module.get(NotificationLogService);
  });

  describe('record', () => {
    it('records every delivery attempt, not just failures', async () => {
      await service.record({
        userId: 'user-1',
        type: 'NEW_OFFER',
        channel: NotificationChannel.PUSH,
        outcome: NotificationOutcome.SENT,
        providerMessageId: 'fcm-msg-1',
      });

      expect(logModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: 'NEW_OFFER',
          channel: NotificationChannel.PUSH,
          outcome: NotificationOutcome.SENT,
          providerMessageId: 'fcm-msg-1',
        }),
      );
    });

    it('defaults providerMessageId/errorMessage to null and metadata to {}', async () => {
      await service.record({
        userId: 'user-1',
        type: 'NEW_OFFER',
        channel: NotificationChannel.SOCKET,
        outcome: NotificationOutcome.SUPPRESSED,
      });

      expect(logModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ providerMessageId: null, errorMessage: null, metadata: {} }),
      );
    });
  });

  describe('query', () => {
    it('filters by userId/type/outcome when given, paginating the rest', async () => {
      logModel.find.mockReturnValue(chainable([]));
      logModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.query({
        userId: 'user-1',
        type: 'NEW_OFFER',
        outcome: NotificationOutcome.FAILED,
        page: 1,
        limit: 20,
        skip: 0,
      });

      expect(logModel.find).toHaveBeenCalledWith({
        userId: 'user-1',
        type: 'NEW_OFFER',
        outcome: NotificationOutcome.FAILED,
      });
    });
  });
});
