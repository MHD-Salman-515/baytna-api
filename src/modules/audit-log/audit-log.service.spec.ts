import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from './audit-log.service';
import { AuditAction, AuditLog } from './schemas/audit-log.schema';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let model: { create: jest.Mock; find: jest.Mock; countDocuments: jest.Mock };

  beforeEach(async () => {
    model = { create: jest.fn(), find: jest.fn(), countDocuments: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditLogService, { provide: getModelToken(AuditLog.name), useValue: model }],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
  });

  describe('record', () => {
    it('creates an entry with defaults filled in for optional fields', async () => {
      await service.record({
        actorUserId: 'admin-1',
        action: AuditAction.DOCUMENT_VIEWED,
        targetType: 'WorkerDocument',
        targetId: 'doc-1',
      });

      expect(model.create).toHaveBeenCalledWith({
        actorUserId: 'admin-1',
        action: AuditAction.DOCUMENT_VIEWED,
        targetType: 'WorkerDocument',
        targetId: 'doc-1',
        ip: null,
        userAgent: null,
        metadata: {},
      });
    });

    it('allows a null actorUserId for system/script actions', async () => {
      await service.record({
        actorUserId: null,
        action: AuditAction.DOCUMENT_PURGED,
        targetType: 'WorkerDocument',
        targetId: 'doc-2',
        metadata: { reason: 'retention' },
      });

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: null, metadata: { reason: 'retention' } }),
      );
    });
  });

  describe('query', () => {
    function chainable(resolvedValue: unknown) {
      const chain: Record<string, jest.Mock> = {};
      ['sort', 'skip', 'limit'].forEach((m) => (chain[m] = jest.fn().mockReturnValue(chain)));
      chain.exec = jest.fn().mockResolvedValue(resolvedValue);
      return chain;
    }

    it('builds a Mongo filter from the provided criteria', async () => {
      model.find.mockReturnValue(chainable([]));
      model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.query({
        page: 1,
        limit: 20,
        skip: 0,
        action: AuditAction.DOCUMENT_VIEWED,
        actorUserId: 'admin-1',
        targetType: 'WorkerDocument',
        targetId: 'doc-1',
        from: '2026-01-01',
        to: '2026-01-31',
      } as never);

      expect(model.find).toHaveBeenCalledWith({
        action: AuditAction.DOCUMENT_VIEWED,
        actorUserId: 'admin-1',
        targetType: 'WorkerDocument',
        targetId: 'doc-1',
        timestamp: { $gte: new Date('2026-01-01'), $lte: new Date('2026-01-31') },
      });
    });

    it('builds an empty filter when no criteria are given', async () => {
      model.find.mockReturnValue(chainable([]));
      model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.query({ page: 1, limit: 20, skip: 0 } as never);

      expect(model.find).toHaveBeenCalledWith({});
    });
  });
});
