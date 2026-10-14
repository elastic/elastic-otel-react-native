const mockNativeBridge = {
  emitLog: jest.fn(),
  endSpan: jest.fn(),
  getStatus: jest.fn(),
  recordWidgetClick: jest.fn(),
  startSpan: jest.fn(),
};

jest.mock('react-native', () => ({
  NativeModules: {
    ElasticOtelReactNative: mockNativeBridge,
  },
}));

import { NativeModules } from 'react-native';
import {
  __widgetContent,
  __wrapPressHandler,
  emitLog,
  getStatus,
  recordWidgetClick,
  startSpan,
} from '../src';

beforeEach(() => {
  jest.clearAllMocks();
  mockNativeBridge.startSpan.mockResolvedValue('span-1');
  mockNativeBridge.emitLog.mockResolvedValue(undefined);
  mockNativeBridge.recordWidgetClick.mockResolvedValue(undefined);
});

test('legacy and omitted span options create a root span', async () => {
  await expect(startSpan('legacy')).resolves.toBe('span-1');
  await expect(startSpan('omitted', {})).resolves.toBe('span-1');

  expect(mockNativeBridge.startSpan).toHaveBeenNthCalledWith(1, 'legacy', null);
  expect(mockNativeBridge.startSpan).toHaveBeenNthCalledWith(
    2,
    'omitted',
    null,
  );
});

test('parent and log options delegate only their opaque handles', async () => {
  await startSpan('child', { parentSpanHandle: 'span-7' });
  await emitLog('correlated', 'warn', { spanHandle: 'span-8' });

  expect(mockNativeBridge.startSpan).toHaveBeenCalledWith('child', 'span-7');
  expect(mockNativeBridge.emitLog).toHaveBeenCalledWith(
    'correlated',
    'warn',
    'span-8',
  );
});

test('legacy and omitted log options remain independent', async () => {
  await emitLog('legacy', 'error');
  await emitLog('default severity');
  await emitLog('omitted', 'info', {});

  expect(mockNativeBridge.emitLog).toHaveBeenNthCalledWith(
    1,
    'legacy',
    'error',
    null,
  );
  expect(mockNativeBridge.emitLog).toHaveBeenNthCalledWith(
    2,
    'default severity',
    'info',
    null,
  );
  expect(mockNativeBridge.emitLog).toHaveBeenNthCalledWith(
    3,
    'omitted',
    'info',
    null,
  );
});

test.each([
  ['not an object', 'span-1'],
  ['an array', []],
  ['null', null],
  ['a non-plain object', new Date()],
  ['an unknown field', { parentSpanHandle: 'span-1', traceId: 'trace' }],
  ['a non-string handle', { parentSpanHandle: 1 }],
  ['a blank handle', { parentSpanHandle: ' ' }],
])('startSpan rejects %s without invoking native', async (_name, options) => {
  await expect(startSpan('child', options as never)).rejects.toBeInstanceOf(
    TypeError,
  );
  expect(mockNativeBridge.startSpan).not.toHaveBeenCalled();
});

test.each([
  ['an unknown field', { spanHandle: 'span-1', spanId: 'span-id' }],
  ['a non-string handle', { spanHandle: false }],
  ['a blank handle', { spanHandle: '' }],
])('emitLog rejects %s without invoking native', async (_name, options) => {
  await expect(
    emitLog('body', 'info', options as never),
  ).rejects.toBeInstanceOf(TypeError);
  expect(mockNativeBridge.emitLog).not.toHaveBeenCalled();
});

test('native promise rejections propagate unchanged', async () => {
  const error = new Error('Unknown or already-ended span handle');
  mockNativeBridge.startSpan.mockRejectedValueOnce(error);
  mockNativeBridge.emitLog.mockRejectedValueOnce(error);

  await expect(
    startSpan('child', { parentSpanHandle: 'span-404' }),
  ).rejects.toBe(error);
  await expect(
    emitLog('body', 'info', { spanHandle: 'span-404' }),
  ).rejects.toBe(error);
});

test('recordWidgetClick validates and delegates a true interaction request', async () => {
  await recordWidgetClick({
    widgetId: 'forecast.fetch',
    widgetName: 'Fetch forecast',
    timestamp: 1234,
  });

  expect(mockNativeBridge.recordWidgetClick).toHaveBeenCalledWith(
    'forecast.fetch',
    'Fetch forecast',
    1234,
  );
});

test.each([
  ['not an object', 'options'],
  ['an array', []],
  ['an unknown field', { widgetId: 'id', timestamp: 1, extra: true }],
  ['a missing ID', { timestamp: 1 }],
  ['a blank ID', { widgetId: ' ', timestamp: 1 }],
  ['a blank name', { widgetId: 'id', widgetName: '', timestamp: 1 }],
  ['a non-finite timestamp', { widgetId: 'id', timestamp: Infinity }],
])(
  'recordWidgetClick rejects %s without invoking native',
  async (_name, value) => {
    await expect(recordWidgetClick(value as never)).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(mockNativeBridge.recordWidgetClick).not.toHaveBeenCalled();
  },
);

test('wrapped handlers emit fire-and-forget telemetry and preserve semantics', () => {
  const unresolved = new Promise<void>(() => {});
  mockNativeBridge.recordWidgetClick.mockReturnValueOnce(unresolved);
  jest.spyOn(Date, 'now').mockReturnValue(2468);
  const receiver = { value: 7 };
  function handler(this: typeof receiver, increment: number) {
    return this.value + increment;
  }

  const wrapped = __wrapPressHandler(
    handler,
    'Pressable',
    ['forecast.fetch'],
    ['Fetch'],
  );
  const result = wrapped.call(receiver, 5);

  expect(result).toBe(12);
  expect(mockNativeBridge.recordWidgetClick).toHaveBeenCalledWith(
    'forecast.fetch',
    'Fetch',
    2468,
  );
});

test('wrapped handlers preserve throws, returned promises, and invocation count', async () => {
  const rejection = new Error('telemetry unavailable');
  mockNativeBridge.recordWidgetClick.mockRejectedValue(rejection);
  const expected = Promise.resolve('result');
  const promiseHandler = jest.fn(() => expected);
  const wrappedPromise = __wrapPressHandler(
    promiseHandler,
    'Pressable',
    ['promise'],
    [],
  );

  expect(wrappedPromise()).toBe(expected);
  expect(promiseHandler).toHaveBeenCalledTimes(1);
  await expect(expected).resolves.toBe('result');

  const handlerError = new Error('handler failed');
  const throwingHandler = jest.fn(() => {
    throw handlerError;
  });
  const wrappedThrow = __wrapPressHandler(
    throwingHandler,
    'Pressable',
    ['throw'],
    [],
  );
  expect(() => wrappedThrow()).toThrow(handlerError);
  expect(throwingHandler).toHaveBeenCalledTimes(1);
  await Promise.resolve();
});

test('wrapped handlers still run when the native bridge is unavailable', () => {
  const saved = NativeModules.ElasticOtelReactNative;
  delete NativeModules.ElasticOtelReactNative;
  const handler = jest.fn((value: string) => value);
  try {
    expect(
      __wrapPressHandler(handler, 'Pressable', ['offline'], [])('ok'),
    ).toBe('ok');
    expect(handler).toHaveBeenCalledWith('ok');
  } finally {
    NativeModules.ElasticOtelReactNative = saved;
  }
});

test('the first candidate that is a non-empty string wins', () => {
  const wrapped = __wrapPressHandler(
    () => {},
    'Pressable',
    [undefined, null, '', '  ', 7, ['id'], 'save', 'later'],
    [false, ' Save order ', 'later'],
  );
  wrapped();

  expect(mockNativeBridge.recordWidgetClick).toHaveBeenCalledWith(
    'save',
    ' Save order ',
    expect.any(Number),
  );
});

test('the widget id falls back to the component name and the name is omitted', () => {
  __wrapPressHandler(() => {}, 'DemoButton', [undefined, ' '], [null, ''])();

  expect(mockNativeBridge.recordWidgetClick).toHaveBeenCalledWith(
    'DemoButton',
    null,
    expect.any(Number),
  );
});

test('a non-function handler passes through unchanged', () => {
  for (const handler of [undefined, null, 'save', { handleEvent() {} }]) {
    expect(__wrapPressHandler(handler, 'Pressable', ['id'], [])).toBe(handler);
  }
});

test('widget content joins strings and finite numbers with single spaces', () => {
  expect(
    __widgetContent(' Fetch ', 'forecast', 3, ' ', NaN, null, false, {}, [1]),
  ).toBe('Fetch forecast 3');
  expect(__widgetContent(undefined, Infinity, '')).toBe('');
});

test('the wrapper is stable for a stable handler and an unchanged identity', () => {
  const handler = jest.fn();
  const first = __wrapPressHandler(handler, 'Pressable', ['save'], ['Save']);
  const rerendered = __wrapPressHandler(
    handler,
    'Pressable',
    ['save'],
    ['Save'],
  );
  const renamed = __wrapPressHandler(handler, 'Pressable', ['save'], ['Saved']);
  const other = __wrapPressHandler(handler, 'Pressable', ['retry'], ['Retry']);

  expect(rerendered).toBe(first);
  expect(renamed).not.toBe(first);
  expect(other).not.toBe(first);

  renamed();
  other();
  expect(mockNativeBridge.recordWidgetClick).toHaveBeenNthCalledWith(
    1,
    'save',
    'Saved',
    expect.any(Number),
  );
  expect(mockNativeBridge.recordWidgetClick).toHaveBeenNthCalledWith(
    2,
    'retry',
    'Retry',
    expect.any(Number),
  );
  expect(handler).toHaveBeenCalledTimes(2);
});

test('elements sharing a handler and the fallback id keep their own names', () => {
  const handler = jest.fn();
  const save = __wrapPressHandler(handler, 'Pressable', [], ['Save']);
  const cancel = __wrapPressHandler(handler, 'Pressable', [], ['Cancel']);

  expect(cancel).not.toBe(save);
  expect(__wrapPressHandler(handler, 'Pressable', [], ['Save'])).toBe(save);

  save();
  cancel();
  expect(mockNativeBridge.recordWidgetClick).toHaveBeenNthCalledWith(
    1,
    'Pressable',
    'Save',
    expect.any(Number),
  );
  expect(mockNativeBridge.recordWidgetClick).toHaveBeenNthCalledWith(
    2,
    'Pressable',
    'Cancel',
    expect.any(Number),
  );
});

test('a stable handler keeps a cached wrapper for each of 500 identities', () => {
  const handler = jest.fn();
  const ids = Array.from({ length: 500 }, (_, index) => `row-${index}`);
  const first = ids.map((id) =>
    __wrapPressHandler(handler, 'Pressable', [id], []),
  );

  ids.forEach((id, index) => {
    expect(__wrapPressHandler(handler, 'Pressable', [id], [])).toBe(
      first[index],
    );
  });
});

test('past 500 identities the least recently used wrapper is evicted', () => {
  const handler = jest.fn();
  const ids = [
    'a',
    ...Array.from({ length: 500 }, (_, index) => `row-${index}`),
  ];
  const wrap = (id: string) =>
    __wrapPressHandler(handler, 'Pressable', [id], []);
  const first = ids.slice(0, 500).map(wrap);

  expect(wrap('a')).toBe(first[0]);
  wrap(ids[500]);

  expect(wrap('a')).toBe(first[0]);
  const recreated = wrap(ids[1]);
  expect(recreated).not.toBe(first[1]);

  recreated();
  expect(mockNativeBridge.recordWidgetClick).toHaveBeenCalledWith(
    ids[1],
    null,
    expect.any(Number),
  );
});

test('bridge-unavailable errors are platform-neutral', () => {
  const saved = NativeModules.ElasticOtelReactNative;
  delete NativeModules.ElasticOtelReactNative;
  try {
    expect(() => getStatus()).toThrow(
      'Native autolinking must be enabled and the app rebuilt.',
    );
  } finally {
    NativeModules.ElasticOtelReactNative = saved;
  }
});
