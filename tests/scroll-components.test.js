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

const { createRequire } = require('node:module');
const React = require('react');
const { act, create } = require('react-test-renderer');
const { NativeModules } = require('react-native');
const { transformSync } = createRequire(
  require.resolve('@react-native/babel-preset'),
)('@babel/core');
const plugin = require('../babel-plugin.cjs');

// Exercise ScrollView's real forwarding code rather than the preset's mock.
jest.unmock('react-native/Libraries/Components/ScrollView/ScrollView');

const recordWidgetScroll = jest.fn().mockResolvedValue(undefined);
NativeModules.ElasticOtelReactNative = { recordWidgetScroll };

const source = `
  import React from 'react';
  import { ScrollView, FlatList, Text } from 'react-native';
  export default function Screen({ onDrag, onOther }) {
    return <>
      <ScrollView testID="plain" accessibilityLabel="Plain" onScroll={onOther}
        onMomentumScrollBegin={onOther} onMomentumScrollEnd={onOther} />
      <ScrollView testID="handled" accessibilityLabel="Handled" onScrollEndDrag={onDrag}
        onScroll={onOther} onMomentumScrollBegin={onOther} onMomentumScrollEnd={onOther} />
      <FlatList testID="list" accessibilityLabel="List" data={[{ key: 'row' }]}
        renderItem={() => <Text>Row</Text>} onScroll={onOther}
        onMomentumScrollBegin={onOther} onMomentumScrollEnd={onOther} />
    </>;
  }
`;

function compile(instrumented) {
  const { code } = transformSync(source, {
    filename: '/app/Screen.jsx',
    babelrc: false,
    configFile: false,
    presets: [require.resolve('@react-native/babel-preset')],
    plugins: instrumented
      ? [[plugin, { interactions: { widgetName: ['accessibilityLabel'] } }]]
      : [],
  });
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    require,
    compiled,
    compiled.exports,
  );
  return compiled.exports.default;
}

test.each([true, false])(
  'real ScrollView and FlatList forward gestures (plugin=%s)',
  (instrumented) => {
    const Screen = compile(instrumented);
    const onDrag = jest.fn();
    const onOther = jest.fn();
    let screen;
    act(() => {
      screen = create(React.createElement(Screen, { onDrag, onOther }));
    });
    try {
      const hosts = screen.root.findAllByType('RCTScrollView');
      expect(hosts).toHaveLength(3);
      const event = {
        nativeEvent: {
          contentInset: { top: 0, left: 0, bottom: 0, right: 0 },
          contentOffset: { x: 0, y: 10 },
          contentSize: { width: 100, height: 300 },
          layoutMeasurement: { width: 100, height: 100 },
          velocity: { x: 0, y: 0 },
        },
      };
      for (const host of hosts) {
        recordWidgetScroll.mockClear();
        act(() => host.props.onScrollEndDrag(event));
        if (instrumented) {
          expect(recordWidgetScroll).toHaveBeenCalledTimes(1);
          expect(recordWidgetScroll).toHaveBeenCalledWith(
            host.props.testID,
            host.props.accessibilityLabel,
            expect.any(Number),
          );
        } else {
          expect(recordWidgetScroll).not.toHaveBeenCalled();
        }
        recordWidgetScroll.mockClear();
        act(() => {
          host.props.onScroll(event);
          host.props.onMomentumScrollBegin(event);
          host.props.onMomentumScrollEnd(event);
        });
        expect(recordWidgetScroll).not.toHaveBeenCalled();
      }
      expect(onDrag).toHaveBeenCalledTimes(1);
      expect(onDrag).toHaveBeenCalledWith(event);
      expect(onOther).toHaveBeenCalledTimes(9);
    } finally {
      act(() => screen.unmount());
      recordWidgetScroll.mockClear();
    }
  },
);
