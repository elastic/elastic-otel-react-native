import { NativeModules } from 'react-native';

type NativeBridge = {
  getStatus(): Promise<OtelStatus>;
  startSpan(name: string, parentSpanHandle: string | null): Promise<string>;
  endSpan(handle: string): Promise<void>;
  emitLog(
    body: string,
    severity: LogSeverity,
    spanHandle: string | null,
  ): Promise<void>;
  recordWidgetClick(
    widgetId: string,
    widgetName: string | null,
    timestamp: number,
  ): Promise<void>;
};

function bridge(): NativeBridge {
  const nativeBridge = NativeModules.ElasticOtelReactNative as
    | NativeBridge
    | undefined;
  if (!nativeBridge) {
    throw new Error(
      '@elastic/otel-react-native is unavailable. Native autolinking must be enabled and the app rebuilt.',
    );
  }

  return nativeBridge;
}

export type LogSeverity =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal';

export type OtelStatus = {
  ready: boolean;
};

export type StartSpanOptions = {
  /** An active bridge handle, not an OpenTelemetry trace ID or span ID. */
  parentSpanHandle?: string;
};

export type EmitLogOptions = {
  /** An active bridge handle, not an OpenTelemetry trace ID or span ID. */
  spanHandle?: string;
};

export type RecordWidgetClickOptions = {
  widgetId: string;
  widgetName?: string;
  /** Epoch timestamp in milliseconds captured when the interaction occurred. */
  timestamp: number;
};

function optionalHandle(
  options: unknown,
  key: 'parentSpanHandle' | 'spanHandle',
): string | null {
  if (options === undefined) {
    return null;
  }
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options))
  ) {
    throw new TypeError(`Options must be an object containing only ${key}.`);
  }

  const keys = Object.keys(options);
  if (keys.some((optionKey) => optionKey !== key)) {
    throw new TypeError(`Options must contain only ${key}.`);
  }

  const handle = (options as Record<string, unknown>)[key];
  if (handle === undefined) {
    return null;
  }
  if (typeof handle !== 'string' || handle.trim() === '') {
    throw new TypeError(`${key} must be a non-blank opaque span handle.`);
  }
  return handle;
}

export function getStatus(): Promise<OtelStatus> {
  return bridge().getStatus();
}

export async function startSpan(
  name: string,
  options?: StartSpanOptions,
): Promise<string> {
  return bridge().startSpan(name, optionalHandle(options, 'parentSpanHandle'));
}

export function endSpan(handle: string): Promise<void> {
  return bridge().endSpan(handle);
}

export async function emitLog(
  body: string,
  severity: LogSeverity = 'info',
  options?: EmitLogOptions,
): Promise<void> {
  return bridge().emitLog(
    body,
    severity,
    optionalHandle(options, 'spanHandle'),
  );
}

export async function recordWidgetClick(
  options: RecordWidgetClickOptions,
): Promise<void> {
  const validated = widgetClickOptions(options);
  return bridge().recordWidgetClick(
    validated.widgetId,
    validated.widgetName,
    validated.timestamp,
  );
}

export function __wrapPressHandler<T extends (...args: never[]) => unknown>(
  handler: T,
  widgetId: string,
  widgetName: string | null,
): T {
  if (typeof handler !== 'function') {
    return handler;
  }

  return function (this: unknown, ...args: never[]) {
    void recordWidgetClick({
      widgetId,
      ...(widgetName === null ? {} : { widgetName }),
      timestamp: Date.now(),
    }).catch(() => {});
    return Reflect.apply(handler, this, args);
  } as T;
}

function widgetClickOptions(options: unknown): {
  widgetId: string;
  widgetName: string | null;
  timestamp: number;
} {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options))
  ) {
    throw new TypeError('Widget click options must be a plain object.');
  }

  const keys = Object.keys(options);
  if (
    keys.some((key) => !['widgetId', 'widgetName', 'timestamp'].includes(key))
  ) {
    throw new TypeError(
      'Widget click options may contain only widgetId, widgetName, and timestamp.',
    );
  }

  const values = options as Record<string, unknown>;
  if (typeof values.widgetId !== 'string' || values.widgetId.trim() === '') {
    throw new TypeError('widgetId must be a non-blank string.');
  }
  if (
    values.widgetName !== undefined &&
    (typeof values.widgetName !== 'string' || values.widgetName.trim() === '')
  ) {
    throw new TypeError('widgetName must be a non-blank string when provided.');
  }
  if (
    typeof values.timestamp !== 'number' ||
    !Number.isFinite(values.timestamp)
  ) {
    throw new TypeError('timestamp must be a finite epoch millisecond number.');
  }

  return {
    widgetId: values.widgetId,
    widgetName: values.widgetName === undefined ? null : values.widgetName,
    timestamp: values.timestamp,
  };
}
