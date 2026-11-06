---
navigation_title: Automatic instrumentation
description: Instrument React Native applications automatically using the Elastic Distribution of OpenTelemetry React Native (EDOT React Native).
applies_to:
  stack:
  serverless:
    observability:
  product:
    edot_react_native: preview 0.1.0
products:
  - id: cloud-serverless
  - id: observability
  - id: edot-sdk
---

# Automatic instrumentation for React Native with EDOT SDK

EDOT React Native can generate telemetry on your behalf, so you get HTTP spans,
crash reports, and widget tap events without writing
[manual instrumentation](manual-instrumentation.md).

## Installation

The native instrumentations start with
[native bootstrap](getting-started.md#bootstrap-before-react-native), before
React Native starts:

- On Android, `setup-android` applies the `co.elastic.otel.android.agent`
  plugin, which wires the EDOT Android agent, and the
  `co.elastic.otel.android.instrumentation.okhttp` and
  `co.elastic.otel.android.instrumentation.crash` plugins; see
  [Run automated Android setup](getting-started.md#run-automated-android-setup).
- On iOS, EDOT iOS records URLSession, view-controller, application lifecycle,
  CPU and memory system metric, session, and crash telemetry with its default
  configuration. See the
  [EDOT iOS documentation](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/ios)
  for what each one records.

Widget tap events are opt-in. To record them, add the package plugin to
`babel.config.js`:

```js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: ['@elastic/otel-react-native/babel-plugin'],
};
```

With no options, each tap that runs the `onPress` handler of a `Button`,
`Pressable`, `TouchableOpacity`, `TouchableHighlight`,
`TouchableWithoutFeedback`, or `TouchableNativeFeedback` imported from
`react-native` records an `app.widget.click` event, on Android and on iOS.
After you add the plugin or change its options, rebuild the bundle with the
Metro cache reset, for example `npx react-native start --reset-cache` or
`npx expo start --clear`.

## Configuration

The native instrumentations use the EDOT Android and EDOT iOS defaults. The
Babel plugin takes options. These are the plugin options with their effective
defaults written out:

<!-- prettier-ignore -->
```js
plugins: [['@elastic/otel-react-native/babel-plugin', {
  debug: false,
  interactions: {
    enabled: true,
    widgetId: ['widget-id', 'testID', 'accessibilityLabel', '@component'],
    widgetName: ['@content'],
    components: [
      { name: 'Button', from: 'react-native', widgetName: ['title'],
        instrumentations: { click: { handlers: ['onPress'] } } },
      { name: 'Pressable', from: 'react-native',
        instrumentations: { click: { handlers: ['onPress'] } } },
      { name: 'TouchableOpacity', from: 'react-native',
        instrumentations: { click: { handlers: ['onPress'] } } },
      { name: 'TouchableHighlight', from: 'react-native',
        instrumentations: { click: { handlers: ['onPress'] } } },
      { name: 'TouchableWithoutFeedback', from: 'react-native',
        instrumentations: { click: { handlers: ['onPress'] } } },
      { name: 'TouchableNativeFeedback', from: 'react-native',
        instrumentations: { click: { handlers: ['onPress'] } } },
    ],
  },
}]]
```

The `PluginOptions` type exported by `@elastic/otel-react-native/babel-plugin`
describes every option. Invalid options fail the build with an error that
names the option.

## Supported instrumentations

### HTTP requests

On Android, the EDOT Android OkHttp instrumentation creates spans for requests
through compatible OkHttp clients and propagates W3C trace context. On iOS,
EDOT iOS creates spans for URLSession requests and propagates W3C trace
context. Requests that your app makes with React Native's `fetch` produce these
spans on both platforms.

### Crash reporting

EDOT Android and EDOT iOS capture native crashes. See
[Crash reporting](configuration.md#crash-reporting) for configuration.

### Widget tap events

The Babel plugin records an `app.widget.click` event for each tap on the
components it tracks; see [Installation](#installation) to add it and
[Configuration](#configuration) for its options.

#### Widget id and name

`widgetId` and `widgetName` list where the event's `app.widget.id` and
`app.widget.name` come from, in order; the first source with a non-empty
string value wins. A plain entry is a prop of the tapped element, such as
`testID`. An entry that starts with `@` is a macro the plugin computes:
`@content` is the element's visible text, read from the text and the
side-effect-free expressions among its JSX children, and `@component` is the
component's name. When no source has a value, the widget id is the
component's name, so every tracked tap records an event, and the widget name
is omitted. A source listed after `@component` is never used and fails the
build.

`widget-id` is a prop the plugin reads. TypeScript does not type-check
hyphenated JSX attributes, so it works on any component, and the plugin never
removes a prop from the element:

```tsx
<Pressable widget-id="checkout.submit" onPress={submitOrder}>
  <Text>Submit order</Text>
</Pressable>
```

This tap records `app.widget.id` `checkout.submit` and `app.widget.name`
`Submit order`. A prop used as a source can hold any side-effect-free
expression: a literal, a template literal, a variable, a property read, or a
conditional, logical, unary, or binary expression of those. The same forms
apply to `@content`: it reads the literal text and the side-effect-free
expressions among the element's JSX children. The plugin does not read a
source whose expression has side effects, such as a function call, so an
inline translation call such as `<Text>{t('pay')}</Text>` gives no default
widget name; store the translated string in a variable and render the
variable to get one. The plugin copies each source expression into the tap
wrapper, so a source expression is evaluated once more per render. Keep
sources free of side effects, including objects with a custom string
conversion interpolated into a template literal, or the recorded value can
differ from the rendered one. The plugin reads the sources when the element
renders, so the event records the values on screen when the tap happened.

Set `widgetId` or `widgetName` under `interactions` to change the lists for
every component, or on a component entry to change them for that component.
An entry's list replaces the list under `interactions`.

#### Track your own and third-party components

List the components your app taps under `interactions.components`, each with
the instrumentations to apply. `click: {}` records a click when `onPress`
runs:

```js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      '@elastic/otel-react-native/babel-plugin',
      {
        interactions: {
          components: [
            // A design-system button defined in the app
            { name: 'AppButton', instrumentations: { click: {} } },
            // A component library's button, identified by its label
            {
              name: 'Button',
              from: 'react-native-paper',
              widgetId: ['label', '@component'],
              instrumentations: { click: {} },
            },
          ],
        },
      },
    ],
  ],
};
```

`name` is the component's exported name, so
`import { Button as PaperButton } from 'react-native-paper'` matches
`name: 'Button'`. A default import and a component defined in the same file
match by the name used in JSX. `from` is the module as written in the import,
such as a package name or a path alias. Without `from`, the entry matches
the name imported from any module. An entry with the same `name` and `from` as
a default component replaces it.

Components used as namespace members, such as `<Paper.Button>`, or bound with
`require` are not matched.

A component defined in the same file matches only an entry without `from`, so
list a component defined in the app without `from`. The plugin instruments
nothing inside the declaration of such a component, so a component that passes
`onPress` to an inner `Pressable` records one event per tap.

`click.handlers` lists the props that record a click; all of them count:

```js
{ name: 'MyButton', instrumentations: { click: { handlers: ['myClick'] } } }
```

Long presses are not recorded by default. Listing `onLongPress` in
`click.handlers` records them as `app.widget.click`; there is no separate
long-press event.

`enabled: false` on an entry turns that component off, for example
`{ name: 'Pressable', from: 'react-native', enabled: false }`.
`interactions.enabled: false` turns tap events off.

An element is skipped when a spread attribute, such as `{...props}`, follows
its handler or an id prop such as `testID`, because the spread can replace
that value. A spread after a name prop, such as `title`, only stops the plugin
from reading that prop.

#### Report skipped elements

Set `debug: true` to print each element the plugin skips, and each source it
does not read, to the Metro terminal, with its file, line, component, and
reason:

```text
[elastic-otel-react-native] src/Checkout.tsx:42 Pressable skipped: a spread attribute follows onPress
[elastic-otel-react-native] src/Checkout.tsx:57 Pressable source testID is a call expression; not read
```

Metro caches transformed files, so reset the Metro cache to report files it
already transformed.

#### What a tap records

Recording a tap never delays or changes the tapped component's handler. The
handler runs immediately with the same arguments, return value, and errors,
and only once, even when telemetry is unavailable or export fails.

The tap is recorded as an OpenTelemetry event named `app.widget.click` with
instrumentation scope `@elastic/otel-react-native.interactions`, the required
attribute `app.widget.id`, and the optional attribute `app.widget.name`. The
event has no log body and no span context. On both platforms, it carries the
EventRecord name `app.widget.click` and the attribute
`otel.event.name=app.widget.click`.

`app.widget.click`, `app.widget.id`, and `app.widget.name` are Development
OpenTelemetry semantic conventions and can change in a future OpenTelemetry
release.

To record a tap that the plugin does not instrument, call
[`recordWidgetClick`](manual-instrumentation.md#record-widget-clicks). If
events are absent, set `debug: true`, confirm that native bootstrap completed,
and rebuild the bundle with the Metro cache reset.

## Understanding automatic-instrumentation scope

Automatic HTTP spans cover the requests that pass through OkHttp on Android
and URLSession on iOS. Validate representative application requests on both
platforms.

EDOT React Native does not add automatic React Navigation, Redux, gesture,
screen-coordinate, or JavaScript exception instrumentation, and does not process
source maps.
