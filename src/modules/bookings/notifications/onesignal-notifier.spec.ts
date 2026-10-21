import { ConfigService } from '@nestjs/config';
import { CountriesService } from '../../countries/countries.service';
import { DeviceTokensService } from '../../notifications/device-tokens.service';
import { NotificationLogService } from '../../notifications/notification-log.service';
import { NotificationEventType } from '../../notifications/notification-event';
import { NotificationPreferencesService } from '../../notifications/notification-preferences.service';
import { NotificationOutcome } from '../../notifications/schemas/notification-log.schema';
import { UsersService } from '../../users/users.service';
import { WorkerProfilesService } from '../../workers/worker-profiles.service';
import { OneSignalNotifier } from './onesignal-notifier';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('OneSignalNotifier', () => {
  let notifier: OneSignalNotifier;
  let deviceTokensService: { listActiveForUser: jest.Mock; deactivateToken: jest.Mock };
  let logService: { record: jest.Mock };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;

    const preferencesService = {
      getOwn: jest.fn().mockResolvedValue({
        mutedTypes: [],
        channels: { push: true, socket: true },
        quietHours: { enabled: false, startTime: '22:00', endTime: '07:00' },
      }),
    };
    logService = { record: jest.fn().mockResolvedValue(undefined) };
    deviceTokensService = {
      listActiveForUser: jest
        .fn()
        .mockResolvedValue([{ token: 'good-player-id' }, { token: 'dead-player-id' }]),
      deactivateToken: jest.fn().mockResolvedValue(undefined),
    };
    const usersService = {
      findById: jest.fn().mockResolvedValue({ locale: 'ar', countryId: 'country-1' }),
    };
    const countriesService = { findOne: jest.fn() };
    const workerProfilesService = { getForAdmin: jest.fn() };
    const moduleRef = { get: jest.fn().mockReturnValue({ emitToUser: jest.fn() }) };
    const configService = {
      get: jest.fn().mockReturnValue({ appId: 'app-123', restApiKey: 'key-456' }),
    };

    notifier = new OneSignalNotifier(
      preferencesService as unknown as NotificationPreferencesService,
      logService as unknown as NotificationLogService,
      deviceTokensService as unknown as DeviceTokensService,
      usersService as unknown as UsersService,
      countriesService as unknown as CountriesService,
      workerProfilesService as unknown as WorkerProfilesService,
      moduleRef as never,
      configService as unknown as ConfigService,
    );
  });

  function notify() {
    return notifier.notify({
      type: NotificationEventType.BOOKING_ACCEPTED,
      recipientUserId: 'user-1',
      bookingId: 'booking-1',
      context: {},
    });
  }

  it('sends to onesignal.com with include_player_ids, the rendered copy, and the {type, bookingId} data payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'notif-1' }));

    await notify();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://onesignal.com/api/v1/notifications',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Basic key-456' }),
      }),
    );
    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const sentBody = JSON.parse(options.body);
    expect(sentBody).toEqual(
      expect.objectContaining({
        app_id: 'app-123',
        include_player_ids: ['good-player-id', 'dead-player-id'],
        data: { type: 'BOOKING_ACCEPTED', bookingId: 'booking-1' },
      }),
    );
  });

  it('deactivates only the player ids OneSignal reports as invalid in a partial-success response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { id: 'notif-1', errors: { invalid_player_ids: ['dead-player-id'] } }),
    );

    await notify();

    expect(deviceTokensService.deactivateToken).toHaveBeenCalledWith('dead-player-id');
    expect(deviceTokensService.deactivateToken).not.toHaveBeenCalledWith('good-player-id');
    expect(logService.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: NotificationOutcome.SENT }),
    );
    expect(logService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: NotificationOutcome.FAILED,
        errorMessage: 'invalid or unsubscribed player id',
      }),
    );
  });

  it('deactivates every token in the batch when OneSignal reports the whole batch as unsubscribed', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { errors: ['All included players are not subscribed'] }),
    );

    await notify();

    expect(deviceTokensService.deactivateToken).toHaveBeenCalledWith('good-player-id');
    expect(deviceTokensService.deactivateToken).toHaveBeenCalledWith('dead-player-id');
  });

  it('does not deactivate anything for an ordinary transient failure (e.g. bad app id)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { errors: ['App not found'] }));

    await notify();

    expect(deviceTokensService.deactivateToken).not.toHaveBeenCalled();
    expect(logService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: NotificationOutcome.FAILED,
        errorMessage: 'App not found',
      }),
    );
  });
});
