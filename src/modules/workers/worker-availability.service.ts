import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model } from 'mongoose';
import {
  DateOverrideDto,
  SetAvailabilityWindowsDto,
  WeeklyWindowDto,
} from './dto/set-availability-windows.dto';
import {
  DateOverride,
  DateOverrideType,
  WeeklyWindow,
  WorkerAvailability,
  WorkerAvailabilityDocument,
} from './schemas/worker-availability.schema';

export interface TimeWindowUtc {
  start: Date;
  end: Date;
}

export interface OwnAvailability {
  weeklyWindows: WeeklyWindow[];
  dateOverrides: DateOverride[];
}

const EMPTY_AVAILABILITY: OwnAvailability = { weeklyWindows: [], dateOverrides: [] };

@Injectable()
export class WorkerAvailabilityService {
  constructor(
    @InjectModel(WorkerAvailability.name)
    private readonly availabilityModel: Model<WorkerAvailabilityDocument>,
  ) {}

  async getOwn(workerProfileId: string): Promise<OwnAvailability> {
    const doc = await this.availabilityModel.findOne({ workerProfileId, isDeleted: false }).exec();
    return doc
      ? { weeklyWindows: doc.weeklyWindows, dateOverrides: doc.dateOverrides }
      : EMPTY_AVAILABILITY;
  }

  /** Full replace, by design — PUT always sends the whole set, never a partial patch. */
  async replaceOwn(
    workerProfileId: string,
    dto: SetAvailabilityWindowsDto,
  ): Promise<WorkerAvailabilityDocument> {
    this.assertValidWeeklyWindows(dto.weeklyWindows);
    this.assertValidDateOverrides(dto.dateOverrides);

    // BLOCKED overrides never carry a start/end time, regardless of what the
    // client sent — the DTO only validates startTime/endTime when EXTRA.
    const dateOverrides: DateOverride[] = dto.dateOverrides.map((o) => ({
      date: o.date,
      type: o.type,
      startTime: o.type === DateOverrideType.EXTRA ? (o.startTime as string) : null,
      endTime: o.type === DateOverrideType.EXTRA ? (o.endTime as string) : null,
    }));

    const doc = await this.availabilityModel
      .findOneAndUpdate(
        { workerProfileId, isDeleted: false },
        { workerProfileId, weeklyWindows: dto.weeklyWindows, dateOverrides },
        { new: true, upsert: true },
      )
      .exec();
    return doc as WorkerAvailabilityDocument;
  }

  /**
   * Resolves the windows she's available in on one calendar date, in her
   * country's timezone, as UTC instants ready to compare against bookings.
   * A date override — if one exists for this date — entirely REPLACES the
   * weekly pattern (either blocks the day outright, or defines the single
   * window that applies); otherwise the weekly windows for that weekday
   * apply. Used both by the public slots endpoint and by booking creation
   * to validate scheduledFor.
   */
  async getWindowsForDate(
    workerProfileId: string,
    isoDate: string,
    timezone: string,
  ): Promise<TimeWindowUtc[]> {
    const { weeklyWindows, dateOverrides } = await this.getOwn(workerProfileId);
    const override = dateOverrides.find((o) => o.date === isoDate);

    if (override) {
      if (override.type === DateOverrideType.BLOCKED) {
        return [];
      }
      return [
        this.toUtcWindow(
          isoDate,
          override.startTime as string,
          override.endTime as string,
          timezone,
        ),
      ];
    }

    // luxon weekday: 1 (Monday) ... 7 (Sunday). Schema dayOfWeek: 0 (Sunday) ... 6 (Saturday).
    const luxonWeekday = DateTime.fromISO(isoDate, { zone: timezone }).weekday;
    const dayOfWeek = luxonWeekday % 7;

    return weeklyWindows
      .filter((w) => w.dayOfWeek === dayOfWeek)
      .map((w) => this.toUtcWindow(isoDate, w.startTime, w.endTime, timezone));
  }

  private toUtcWindow(
    isoDate: string,
    startTime: string,
    endTime: string,
    timezone: string,
  ): TimeWindowUtc {
    const start = DateTime.fromISO(`${isoDate}T${startTime}`, { zone: timezone });
    const end = DateTime.fromISO(`${isoDate}T${endTime}`, { zone: timezone });
    return { start: start.toJSDate(), end: end.toJSDate() };
  }

  private assertValidWeeklyWindows(windows: WeeklyWindowDto[]): void {
    const byDay = new Map<number, WeeklyWindowDto[]>();
    for (const w of windows) {
      if (w.startTime >= w.endTime) {
        throw new BadRequestException(
          `startTime (${w.startTime}) must be before endTime (${w.endTime})`,
        );
      }
      const existing = byDay.get(w.dayOfWeek) ?? [];
      existing.push(w);
      byDay.set(w.dayOfWeek, existing);
    }

    for (const [dayOfWeek, dayWindows] of byDay) {
      const sorted = [...dayWindows].sort((a, b) => (a.startTime < b.startTime ? -1 : 1));
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].startTime < sorted[i - 1].endTime) {
          throw new BadRequestException(
            `Overlapping windows for dayOfWeek ${dayOfWeek}: ` +
              `${sorted[i - 1].startTime}-${sorted[i - 1].endTime} and ${sorted[i].startTime}-${sorted[i].endTime}`,
          );
        }
      }
    }
  }

  private assertValidDateOverrides(overrides: DateOverrideDto[]): void {
    const seenDates = new Set<string>();
    for (const o of overrides) {
      if (seenDates.has(o.date)) {
        throw new BadRequestException(`Duplicate override for date ${o.date}`);
      }
      seenDates.add(o.date);

      if (o.type === DateOverrideType.EXTRA) {
        if (!o.startTime || !o.endTime) {
          throw new BadRequestException(
            `EXTRA override for ${o.date} requires both startTime and endTime`,
          );
        }
        if (o.startTime >= o.endTime) {
          throw new BadRequestException(
            `startTime (${o.startTime}) must be before endTime (${o.endTime}) for ${o.date}`,
          );
        }
      }
    }
  }
}
