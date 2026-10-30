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
