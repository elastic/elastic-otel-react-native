declare namespace elasticOtelReactNativeBabelPlugin {
  /**
   * Where a widget id or widget name comes from: a prop name, such as
   * `'testID'`, whose value is read when it is any side-effect-free
   * expression, or a macro the plugin computes. `'@content'` is the element's
   * visible text, read from the text and the side-effect-free expressions
   * among its JSX children; `'@component'` is the component's name. A call
   * expression is not read, so an inline `{t('pay')}` child gives `'@content'`
   * no value. A source expression is evaluated once more per render, so it
   * must stay free of side effects.
   */
  type WidgetSource = string;

  /** Options of `@elastic/otel-react-native/babel-plugin`. */
  interface PluginOptions {
    /**
     * Print each element the plugin skips, and each source it does not read,
     * to the Metro terminal, with its file, line, component, and reason.
     * @default false
     */
    debug?: boolean;
    /** Automatic interaction events for the components the app taps. */
    interactions?: InteractionsOptions;
  }

  interface InteractionsOptions {
    /**
     * `false` turns automatic interaction events off; the plugin transforms
     * nothing.
     * @default true
     */
    enabled?: boolean;
    /**
     * Where each component's widget id comes from. The first source with a
     * value wins. When none has a value, the id is the component's name.
     * A component entry's `widgetId` overrides this list.
     * @default ['widget-id', 'testID', 'accessibilityLabel', '@component']
     */
    widgetId?: WidgetSource[];
    /**
     * Where each component's widget name comes from. The first source with a
     * value wins. When none has a value, the event has no widget name.
     * A component entry's `widgetName` overrides this list.
     * @default ['@content']
     */
    widgetName?: WidgetSource[];
    /**
     * The components to instrument, in addition to `Button`, `Pressable`,
     * `TouchableOpacity`, `TouchableHighlight`, `TouchableWithoutFeedback`,
     * and `TouchableNativeFeedback` from `react-native`. An entry with the
     * same `name` and `from` as one of those replaces it.
     */
    components?: ComponentOptions[];
  }

  /**
   * A component entry. An enabled entry lists its instrumentations; an entry
   * with `enabled: false` may omit them.
   */
  type ComponentOptions = EnabledComponentOptions | DisabledComponentOptions;

  interface BaseComponentOptions {
    /**
     * The component's exported name. A default import or a component defined
     * in the same file matches by its JSX name.
     */
    name: string;
    /**
     * The module the component is imported from, as written in the import.
     * Without `from`, the entry matches the name from any module.
     */
    from?: string;
    /** Overrides `interactions.widgetId` for this component. */
    widgetId?: WidgetSource[];
    /** Overrides `interactions.widgetName` for this component. */
    widgetName?: WidgetSource[];
  }

  interface EnabledComponentOptions extends BaseComponentOptions {
    /** @default true */
    enabled?: true;
    /** The instrumentations to apply to this component. */
    instrumentations: ComponentInstrumentations;
  }

  interface DisabledComponentOptions extends BaseComponentOptions {
    /** `false` leaves the component uninstrumented. */
    enabled: false;
    /** The instrumentations to apply to this component. */
    instrumentations?: Partial<ComponentInstrumentations>;
  }

  interface ComponentInstrumentations {
    /** Record an `app.widget.click` event when a handler runs. */
    click: ClickInstrumentation;
  }

  interface ClickInstrumentation {
    /**
     * The handler props that record a click. All of them count.
     * @default ['onPress']
     */
    handlers?: string[];
  }
}

declare function elasticOtelReactNativeBabelPlugin(api: object): object;

export = elasticOtelReactNativeBabelPlugin;
