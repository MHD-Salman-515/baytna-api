import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { DateOverrideType, WorkerAvailability } from './schemas/worker-availability.schema';
import { WorkerAvailabilityService } from './worker-availability.service';

describe('WorkerAvailabilityService', () => {
  let service: WorkerAvailabilityService;
  let availabilityModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock };

  const workerProfileId = 'profile-1';

  beforeEach(async () => {
    availabilityModel = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerAvailabilityService,
        { provide: getModelToken(WorkerAvailability.name), useValue: availabilityModel },
      ],
    }).compile();

    service = module.get(WorkerAvailabilityService);
  });

  describe('getOwn', () => {
    it('returns an empty default when she has no document yet', async () => {
      availabilityModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(service.getOwn(workerProfileId)).resolves.toEqual({
        weeklyWindows: [],
        dateOverrides: [],
      });
    });

    it('returns her existing windows and overrides', async () => {
      const doc = {
        weeklyWindows: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }],
        dateOverrides: [],
      };
      availabilityModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      await expect(service.getOwn(workerProfileId)).resolves.toEqual(doc);
    });
  });

  describe('replaceOwn', () => {
    function expectSaved() {
      availabilityModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ workerProfileId }),
      });
    }

    it('rejects a window where startTime is not before endTime', async () => {
      const dto = {
        weeklyWindows: [{ dayOfWeek: 1, startTime: '17:00', endTime: '09:00' }],
        dateOverrides: [],
      };
      await expect(service.replaceOwn(workerProfileId, dto)).rejects.toThrow(BadRequestException);
      expect(availabilityModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects overlapping windows on the same dayOfWeek', async () => {
      const dto = {
        weeklyWindows: [
          { dayOfWeek: 1, startTime: '09:00', endTime: '13:00' },
          { dayOfWeek: 1, startTime: '12:00', endTime: '17:00' },
        ],
        dateOverrides: [],
      };
      await expect(service.replaceOwn(workerProfileId, dto)).rejects.toThrow(BadRequestException);
    });

    it('accepts back-to-back (non-overlapping) windows on the same day', async () => {
      expectSaved();
      const dto = {
        weeklyWindows: [
          { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
          { dayOfWeek: 1, startTime: '12:00', endTime: '17:00' },
        ],
        dateOverrides: [],
      };
      await expect(service.replaceOwn(workerProfileId, dto)).resolves.toBeDefined();
    });

    it('rejects duplicate date overrides for the same date', async () => {
      const dto = {
        weeklyWindows: [],
        dateOverrides: [
          { date: '2026-11-01', type: DateOverrideType.BLOCKED },
          { date: '2026-11-01', type: DateOverrideType.BLOCKED },
        ],
      };
      await expect(service.replaceOwn(workerProfileId, dto)).rejects.toThrow(BadRequestException);
    });

    it('rejects an EXTRA override missing startTime/endTime', async () => {
      const dto = {
        weeklyWindows: [],
        dateOverrides: [{ date: '2026-11-01', type: DateOverrideType.EXTRA }],
      };
      await expect(service.replaceOwn(workerProfileId, dto)).rejects.toThrow(BadRequestException);
    });

    it('forces startTime/endTime to null for a BLOCKED override even if the client sent them', async () => {
      expectSaved();
      const dto = {
        weeklyWindows: [],
        dateOverrides: [
          {
            date: '2026-11-01',
            type: DateOverrideType.BLOCKED,
            startTime: '09:00',
            endTime: '17:00',
          },
        ],
      };
      await service.replaceOwn(workerProfileId, dto);

      expect(availabilityModel.findOneAndUpdate).toHaveBeenCalledWith(
        { workerProfileId, isDeleted: false },
        expect.objectContaining({
          dateOverrides: [
            { date: '2026-11-01', type: DateOverrideType.BLOCKED, startTime: null, endTime: null },
          ],
        }),
        { new: true, upsert: true },
      );
    });
  });

  describe('getWindowsForDate', () => {
    it('resolves a weekly window to the correct UTC instant for a non-UTC timezone', async () => {
      // 2026-11-02 is a Monday. dayOfWeek 1 = Monday under the 0=Sunday convention.
      availabilityModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          weeklyWindows: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }],
          dateOverrides: [],
        }),
      });

      const windows = await service.getWindowsForDate(
        workerProfileId,
        '2026-11-02',
        'Asia/Damascus',
      );

      expect(windows).toHaveLength(1);
      // Asia/Damascus is UTC+3 year-round -> 09:00 local = 06:00 UTC.
      expect(windows[0].start.toISOString()).toBe('2026-11-02T06:00:00.000Z');
      expect(windows[0].end.toISOString()).toBe('2026-11-02T14:00:00.000Z');
    });

    it('returns no windows for a BLOCKED date, even if a weekly window would otherwise apply', async () => {
      availabilityModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          weeklyWindows: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }],
          dateOverrides: [
            { date: '2026-11-02', type: DateOverrideType.BLOCKED, startTime: null, endTime: null },
          ],
        }),
      });

      await expect(
        service.getWindowsForDate(workerProfileId, '2026-11-02', 'Asia/Damascus'),
      ).resolves.toEqual([]);
    });

    it('an EXTRA override entirely replaces the weekly window for that date', async () => {
      availabilityModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          weeklyWindows: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }],
          dateOverrides: [
            {
              date: '2026-11-02',
              type: DateOverrideType.EXTRA,
              startTime: '06:00',
              endTime: '08:00',
            },
          ],
        }),
      });

      const windows = await service.getWindowsForDate(
        workerProfileId,
        '2026-11-02',
        'Asia/Damascus',
      );

      expect(windows).toHaveLength(1);
      expect(windows[0].start.toISOString()).toBe('2026-11-02T03:00:00.000Z');
      expect(windows[0].end.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    });

    it('returns no windows for a weekday with no matching weekly window', async () => {
      availabilityModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          weeklyWindows: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }],
          dateOverrides: [],
        }),
      });

      // 2026-11-03 is a Tuesday (dayOfWeek 2) — no window defined for it.
      await expect(
        service.getWindowsForDate(workerProfileId, '2026-11-03', 'Asia/Damascus'),
      ).resolves.toEqual([]);
    });
  });
});
