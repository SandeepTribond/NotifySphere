/**
 * NotifySphere unit tests
 *
 * Run with: yarn test
 */

import { PermissionsAndroid, Platform } from 'react-native';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetToken = jest.fn().mockResolvedValue('mock-fcm-token');
const mockRequestPermission = jest
  .fn()
  .mockResolvedValue(/* AUTHORIZED */ 1);
const mockOnMessage = jest.fn().mockReturnValue(() => {});
const mockOnNotificationOpenedApp = jest.fn().mockReturnValue(() => {});
const mockGetInitialNotification = jest.fn().mockResolvedValue(null);
const mockSetBackgroundMessageHandler = jest.fn();

jest.mock('@react-native-firebase/messaging', () => {
  const fn = () => ({
    getToken: mockGetToken,
    requestPermission: mockRequestPermission,
    onMessage: mockOnMessage,
    onNotificationOpenedApp: mockOnNotificationOpenedApp,
    getInitialNotification: mockGetInitialNotification,
    setBackgroundMessageHandler: mockSetBackgroundMessageHandler,
  });
  fn.AuthorizationStatus = { AUTHORIZED: 1, PROVISIONAL: 2 };
  return fn;
});

const mockCreateChannel = jest.fn().mockResolvedValue(undefined);
const mockDisplayNotification = jest.fn().mockResolvedValue(undefined);
const mockOnForegroundEvent = jest.fn().mockReturnValue(() => {});
const mockOnBackgroundEvent = jest.fn();

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    createChannel: mockCreateChannel,
    displayNotification: mockDisplayNotification,
    onForegroundEvent: mockOnForegroundEvent,
    onBackgroundEvent: mockOnBackgroundEvent,
  },
  AndroidImportance: { HIGH: 4 },
  AndroidStyle: { BIGPICTURE: 'bigPicture' },
  EventType: { PRESS: 1, DISMISSED: 2 },
}));

const mockAxiosPost = jest.fn().mockResolvedValue({
  data: { subscription_id: 'sub-abc-123' },
});

jest.mock('axios', () => ({
  post: (...args: unknown[]) => mockAxiosPost(...args),
  request: jest.fn().mockResolvedValue({ data: {} }),
}));

// ─── Import subject under test ────────────────────────────────────────────────

import NotifySphere from '../index';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BASE_CONFIG = {
  applicationUserId: 42,
  type: 'AndroidPush',
  appId: 'test-app-id',
  name: 'Test User',
  phone: '9876543210',
  debug: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Reset internal state between tests by calling destroy
  NotifySphere.destroy();
});

describe('checkApplicationPermission', () => {
  it('grants permission on Android API 33+ when the user accepts', async () => {
    Platform.OS = 'android';
    (Platform as any).Version = 33;

    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValueOnce(PermissionsAndroid.RESULTS.GRANTED);

    const result = await NotifySphere.checkApplicationPermission();
    expect(result).toBe(true);
  });

  it('denies permission on Android API 33+ when the user rejects', async () => {
    Platform.OS = 'android';
    (Platform as any).Version = 33;

    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValueOnce(PermissionsAndroid.RESULTS.DENIED);

    const result = await NotifySphere.checkApplicationPermission();
    expect(result).toBe(false);
  });

  it('grants permission on iOS when status is AUTHORIZED', async () => {
    Platform.OS = 'ios';
    mockRequestPermission.mockResolvedValueOnce(1 /* AUTHORIZED */);

    const result = await NotifySphere.checkApplicationPermission();
    expect(result).toBe(true);
  });

  it('returns false and logs error when permission request throws', async () => {
    Platform.OS = 'android';
    (Platform as any).Version = 33;

    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockRejectedValueOnce(new Error('permission error'));

    const result = await NotifySphere.checkApplicationPermission();
    expect(result).toBe(false);
  });
});

describe('initialize', () => {
  beforeEach(() => {
    Platform.OS = 'android';
    (Platform as any).Version = 30; // Below 33 — auto-granted
  });

  it('returns the subscription_id from the API on success', async () => {
    mockAxiosPost.mockResolvedValueOnce({
      data: { subscription_id: 'sub-abc-123' },
    });

    const subId = await NotifySphere.initialize(BASE_CONFIG);
    expect(subId).toBe('sub-abc-123');
  });

  it('posts the FCM token and user data to the correct URL', async () => {
    await NotifySphere.initialize({
      ...BASE_CONFIG,
      baseUrl: 'https://my-server.example.com',
    });

    expect(mockAxiosPost).toHaveBeenCalledWith(
      'https://my-server.example.com/apps/test-app-id/users',
      expect.objectContaining({
        token: 'mock-fcm-token',
        applicationUserId: 42,
      }),
      expect.anything()
    );
  });

  it('creates the default notification channel', async () => {
    await NotifySphere.initialize(BASE_CONFIG);
    expect(mockCreateChannel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'channel_default' })
    );
  });

  it('registers message listeners', async () => {
    await NotifySphere.initialize(BASE_CONFIG);
    expect(mockOnMessage).toHaveBeenCalledTimes(1);
    expect(mockOnNotificationOpenedApp).toHaveBeenCalledTimes(1);
  });

  it('does not register duplicate listeners on multiple initialize calls', async () => {
    await NotifySphere.initialize(BASE_CONFIG);
    await NotifySphere.initialize(BASE_CONFIG);
    // onMessage should only be registered once
    expect(mockOnMessage).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when permission is denied', async () => {
    Platform.OS = 'android';
    (Platform as any).Version = 33;
    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValueOnce(PermissionsAndroid.RESULTS.DENIED);

    const result = await NotifySphere.initialize(BASE_CONFIG);
    expect(result).toBeUndefined();
  });

  it('returns undefined and does not throw when the API call fails', async () => {
    mockAxiosPost.mockRejectedValueOnce(new Error('network error'));

    const result = await NotifySphere.initialize(BASE_CONFIG);
    expect(result).toBeUndefined();
  });
});

describe('updateTags', () => {
  beforeEach(async () => {
    Platform.OS = 'android';
    (Platform as any).Version = 30;
    await NotifySphere.initialize(BASE_CONFIG);
    mockAxiosPost.mockClear();
  });

  it('posts updated tags to the stored appId without requiring it again', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: { success: true } });

    await NotifySphere.updateTags({
      applicationUserId: 42,
      type: 'AndroidPush',
      tags: { premium: 'true' },
    });

    expect(mockAxiosPost).toHaveBeenCalledWith(
      expect.stringContaining('/apps/test-app-id/users'),
      expect.objectContaining({
        user: expect.objectContaining({ tags: { premium: 'true' } }),
      }),
      expect.anything()
    );
  });

  it('returns null when FCM token is missing', async () => {
    // Simulate missing token by destroying state
    NotifySphere.destroy();
    const result = await NotifySphere.updateTags({
      applicationUserId: 42,
      type: 'AndroidPush',
      tags: { key: 'value' },
    });
    expect(result).toBeNull();
  });
});

describe('onNotification callback', () => {
  it('fires the callback with normalised data', async () => {
    Platform.OS = 'android';
    (Platform as any).Version = 30;
    await NotifySphere.initialize(BASE_CONFIG);

    const callback = jest.fn();
    NotifySphere.onNotification(callback);

    // Simulate a foreground Firebase message via the onMessage listener
    const messageHandler = mockOnMessage.mock.calls[0]?.[0];
    if (messageHandler) {
      await messageHandler({
        messageId: 'msg-1',
        notification: { title: 'Hello', body: 'World' },
        data: { sound: 'default', notification_id: 'notif-99' },
      });
    }

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Hello', body: 'World' }),
      'received'
    );
  });
});

describe('destroy', () => {
  it('cleans up listeners and allows re-initialization', async () => {
    Platform.OS = 'android';
    (Platform as any).Version = 30;

    await NotifySphere.initialize(BASE_CONFIG);
    expect(mockOnMessage).toHaveBeenCalledTimes(1);

    NotifySphere.destroy();
    mockAxiosPost.mockClear();

    // After destroy, a fresh initialize should register listeners again
    await NotifySphere.initialize(BASE_CONFIG);
    expect(mockOnMessage).toHaveBeenCalledTimes(2);
  });
});
