/*
 * Copyright Elastic Technologies Inc. and/or licensed to
 * Elastic Technologies Inc. under one or more contributor license
 * agreements. See the NOTICE file distributed with this work for
 * additional information regarding copyright ownership.
 * Elastic Technologies Inc. licenses this file to you under the Apache
 * License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
  /** Blocking and synchronous on purpose; returns whether it recorded. */
  recordJavaScriptCrash(
    type: string,
    message: string,
    stacktrace: string,
    timestamp: number,
  ): boolean;
};

function bridge(): NativeBridge {
  const nativeBridge = NativeModules.ElasticOtelReactNative as
    NativeBridge | undefined;
  if (!nativeBridge) {
    throw new Error(
      '@elastic/otel-react-native is unavailable. Native autolinking must be enabled and the app rebuilt.',
    );
  }

  return nativeBridge;
}

export type LogSeverity =
  'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type OtelStatus = {
  ready: boolean;
};

export type InitializeOptions = {
  /**
   * Record uncaught fatal JavaScript exceptions as `app.crash` records.
   * Defaults to `true`.
   */
  captureErrors?: boolean;
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

function isPlainObject(value: unknown): value is object {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function optionalHandle(
  options: unknown,
  key: 'parentSpanHandle' | 'spanHandle',
): string | null {
  if (options === undefined) {
    return null;
  }
  if (!isPlainObject(options)) {
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

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

// React Native defines this global in every supported version; the type is
// declared here so the SDK does not depend on a version's own declaration.
declare const ErrorUtils: {
  getGlobalHandler(): GlobalErrorHandler;
  setGlobalHandler(handler: GlobalErrorHandler): void;
};

let errorCaptureInstalled = false;

function initializeOptions(options: unknown): { captureErrors: boolean } {
  if (options === undefined) {
    return { captureErrors: true };
  }
  if (!isPlainObject(options)) {
    throw new TypeError('Initialize options must be a plain object.');
  }
  if (Object.keys(options).some((key) => key !== 'captureErrors')) {
    throw new TypeError('Initialize options may contain only captureErrors.');
  }

  const { captureErrors } = options as Record<string, unknown>;
  if (captureErrors !== undefined && typeof captureErrors !== 'boolean') {
    throw new TypeError('captureErrors must be a boolean when provided.');
  }
  return { captureErrors: captureErrors ?? true };
}

function crashDetails(error: unknown): {
  type: string;
  message: string;
  stacktrace: string;
} {
  if (error instanceof Error) {
    return {
      type:
        typeof error.name === 'string' && error.name.trim() !== ''
          ? error.name
          : 'Error',
      message: String(error.message),
      stacktrace: typeof error.stack === 'string' ? error.stack : '',
    };
  }
  return { type: 'Error', message: String(error), stacktrace: '' };
}

function installErrorCapture(): void {
  if (errorCaptureInstalled) {
    return;
  }

  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    if (isFatal === true) {
      try {
        const { type, message, stacktrace } = crashDetails(error);
        bridge().recordJavaScriptCrash(type, message, stacktrace, Date.now());
      } catch {
        // Recording must never change what happens to the app.
      }
    }
    previous(error, isFatal);
  });
  errorCaptureInstalled = true;
}

/**
 * Switches on the JavaScript-side features once native bootstrap has run. It
 * never initializes the native SDK. Call it in the app entry file, before
 * `AppRegistry.registerComponent`.
 */
export async function initialize(options?: InitializeOptions): Promise<void> {
  const { captureErrors } = initializeOptions(options);
  const status = await getStatus();
  if (!status.ready) {
    throw new Error(
      '@elastic/otel-react-native native bootstrap has not run. Initialize the native SDK at app start.',
    );
  }
  if (captureErrors) {
    installErrorCapture();
  }
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

type PressHandler = (...args: never[]) => unknown;

// One wrapper per handler, widget id, and widget name, so a memoized
// component keeps a stable prop while each element records its own identity.
// Each handler's map keeps its most recently used MAX_WRAPPERS_PER_HANDLER
// entries, in Map insertion order.
const pressWrappers = new WeakMap<object, Map<string, PressHandler>>();

// A long-lived handler would otherwise keep one wrapper per distinct identity
// for its whole lifetime. 500 is above the rows a default-window FlatList keeps
// mounted, so eviction normally touches only unmounted rows.
const MAX_WRAPPERS_PER_HANDLER = 500;

function firstValue(candidates: readonly unknown[]): string | null {
  const value = candidates.find(
    (candidate) => typeof candidate === 'string' && candidate.trim() !== '',
  );
  return value === undefined ? null : (value as string);
}

/** The element's visible text: strings and finite numbers, space-joined. */
export function __widgetContent(...parts: unknown[]): string {
  return parts
    .flatMap((part) => {
      if (typeof part === 'string') {
        const text = part.trim();
        return text ? [text] : [];
      }
      return typeof part === 'number' && Number.isFinite(part)
        ? [String(part)]
        : [];
    })
    .join(' ');
}

export function __wrapPressHandler<T>(
  handler: T,
  componentName: string,
  widgetIdCandidates: readonly unknown[],
  widgetNameCandidates: readonly unknown[],
): T {
  if (typeof handler !== 'function') {
    return handler;
  }

  const widgetId = firstValue(widgetIdCandidates) ?? componentName;
  const widgetName = firstValue(widgetNameCandidates);
  let wrappers = pressWrappers.get(handler);
  if (!wrappers) {
    wrappers = new Map();
    pressWrappers.set(handler, wrappers);
  }

  const key = JSON.stringify([widgetId, widgetName]);
  let wrapper = wrappers.get(key);
  if (wrapper) {
    // Re-insert the entry to mark it as the most recently used.
    wrappers.delete(key);
  } else {
    wrapper = function (this: unknown, ...args: never[]) {
      void recordWidgetClick({
        widgetId,
        ...(widgetName === null ? {} : { widgetName }),
        timestamp: Date.now(),
      }).catch(() => {});
      return Reflect.apply(handler, this, args);
    };
  }
  wrappers.set(key, wrapper);
  if (wrappers.size > MAX_WRAPPERS_PER_HANDLER) {
    wrappers.delete(wrappers.keys().next().value as string);
  }
  return wrapper as T;
}

function widgetClickOptions(options: unknown): {
  widgetId: string;
  widgetName: string | null;
  timestamp: number;
} {
  if (!isPlainObject(options)) {
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
