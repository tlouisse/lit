/**
 * @license
 * Copyright 2018 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as ReactModule from 'react';

const reservedReactProperties = new Set([
  'children',
  'localName',
  'ref',
  'style',
  'className',
]);

const listenedEvents: WeakMap<
  Element,
  Map<string, EventListenerObject>
> = new WeakMap();

/**
 * Adds an event listener for the specified event to the given node. In the
 * React setup, there should only ever be one event listener. Thus, for
 * efficiency only one listener is added and the handler for that listener is
 * updated to point to the given listener function.
 */
const addOrUpdateEventListener = (
  node: Element,
  event: string,
  listener: (event?: Event) => void
) => {
  let events = listenedEvents.get(node);
  if (events === undefined) {
    listenedEvents.set(node, (events = new Map()));
  }
  let handler = events.get(event);
  if (listener !== undefined) {
    // If necessary, add listener and track handler
    if (handler === undefined) {
      events.set(event, (handler = {handleEvent: listener}));
      node.addEventListener(event, handler);
      // Otherwise just update the listener with new value
    } else {
      handler.handleEvent = listener;
    }
    // Remove listener if one exists and value is undefined
  } else if (handler !== undefined) {
    events.delete(event);
    node.removeEventListener(event, handler);
  }
};

/**
 * Sets properties and events on custom elements. These properties and events
 * have been pre-filtered so we know they should apply to the custom element.
 */
const setProperty = <E extends Element, T>(
  node: E,
  name: string,
  value: unknown,
  old: unknown,
  events?: StringValued<T>
) => {
  const event = events?.[name as keyof T];
  if (event !== undefined) {
    // Dirty check event value.
    if (value !== old) {
      addOrUpdateEventListener(node, event, value as (e?: Event) => void);
    }
  } else {
    // But don't dirty check properties; elements are assumed to do this.
    node[name as keyof E] = value as E[keyof E];
  }
};

// Set a React ref. Note, there are 2 kinds of refs and there's no built in
// React API to set a ref.
const setRef = (ref: React.Ref<unknown>, value: Element | null) => {
  if (typeof ref === 'function') {
    (ref as (e: Element | null) => void)(value);
  } else {
    (ref as {current: Element | null}).current = value;
  }
};

type StringValued<T> = {
  [P in keyof T]: string;
};

type Constructor<T> = {new (): T};

/***
 * Typecast that curries an Event type through a string. The goal of the type
 * cast is to match a prop name to a typed event callback.
 */
export type EventName<T extends Event = Event> = string & {
  __event_type: T;
};

type Events = Record<string, EventName | string>;

type EventProps<R extends Events> = {
  [K in keyof R]: R[K] extends EventName
    ? (e: R[K]['__event_type']) => void
    : (e: Event) => void;
};

/**
 * Creates a React component for a custom element. Properties are distinguished
 * from attributes automatically, and events can be configured so they are
 * added to the custom element as event listeners.
 *
 * @param React The React module, typically imported from the `react` npm
 * package.
 * @param tagName The custom element tag name registered via
 * `customElements.define`.
 * @param elementClass The custom element class registered via
 * `customElements.define`.
 * @param events An object listing events to which the component can listen. The
 * object keys are the event property names passed in via React props and the
 * object values are the names of the corresponding events generated by the
 * custom element. For example, given `{onactivate: 'activate'}` an event
 * function may be passed via the component's `onactivate` prop and will be
 * called when the custom element fires its `activate` event.
 * @param displayName A React component display name, used in debugging
 * messages. Default value is inferred from the name of custom element class
 * registered via `customElements.define`.
 */
export const createComponent = <I extends HTMLElement, E extends Events>(
  React: typeof ReactModule,
  tagName: string,
  elementClass: Constructor<I>,
  events?: E,
  displayName?: string
) => {
  const Component = React.Component;
  const createElement = React.createElement;

  // Props the user is allowed to use, includes standard attributes, children,
  // ref, as well as special event and element properties.
  // TODO: we might need to omit more properties from HTMLElement than just
  // 'children', but 'children' is special to JSX, so we must at least do that.
  type UserProps = React.PropsWithChildren<
    React.PropsWithRef<
      Partial<Omit<I, 'children'>> &
        Partial<EventProps<E>> &
        Omit<React.HTMLAttributes<HTMLElement>, keyof E>
    >
  >;

  // Props used by this component wrapper. This is the UserProps and the
  // special `__forwardedRef` property. Note, this ref is special because
  // it's both needed in this component to get access to the rendered element
  // and must fulfill any ref passed by the user.
  type ComponentProps = UserProps & {
    __forwardedRef?: React.Ref<unknown>;
  };

  // Set of properties/events which should be specially handled by the wrapper
  // and not handled directly by React.
  const elementClassProps = new Set(Object.keys(events ?? {}));
  for (const p in elementClass.prototype) {
    if (!(p in HTMLElement.prototype)) {
      if (reservedReactProperties.has(p)) {
        // Note, this effectively warns only for `ref` since the other
        // reserved props are on HTMLElement.prototype. To address this
        // would require crawling down the prototype, which doesn't feel worth
        // it since implementing these properties on an element is extremely
        // rare.
        console.warn(
          `${tagName} contains property ${p} which is a React ` +
            `reserved property. It will be used by React and not set on ` +
            `the element.`
        );
      } else {
        elementClassProps.add(p);
      }
    }
  }

  class ReactComponent extends Component<ComponentProps> {
    private _element: I | null = null;
    private _elementProps!: {[index: string]: unknown};
    private _userRef?: React.Ref<unknown>;
    private _ref?: React.RefCallback<I>;

    static displayName = displayName ?? elementClass.name;

    private _updateElement(oldProps?: ComponentProps) {
      if (this._element === null) {
        return;
      }
      // Set element properties to the values in `this.props`
      for (const prop in this._elementProps) {
        setProperty(
          this._element,
          prop,
          this.props[prop as keyof ComponentProps],
          oldProps ? oldProps[prop as keyof ComponentProps] : undefined,
          events
        );
      }
      // Note, the spirit of React might be to "unset" any old values that
      // are no longer included; however, there's no reasonable value to set
      // them to so we just leave the previous state as is.
    }

    /**
     * Updates element properties correctly setting properties
     * on mount.
     */
    override componentDidMount() {
      this._updateElement();
    }

    /**
     * Updates element properties correctly setting properties
     * on every update. Note, this does not include mount.
     */
    override componentDidUpdate(old: ComponentProps) {
      this._updateElement(old);
    }

    /**
     * Renders the custom element with a `ref` prop which allows this
     * component to reference the custom element.
     *
     * Standard attributes are passed to React and element properties and events
     * are updated in componentDidMount/componentDidUpdate.
     *
     */
    override render() {
      // Since refs only get fulfilled once, pass a new one if the user's
      // ref changed. This allows refs to be fulfilled as expected, going from
      // having a value to null.
      const userRef = this.props.__forwardedRef as React.Ref<unknown>;
      if (this._ref === undefined || this._userRef !== userRef) {
        this._ref = (value: I | null) => {
          if (this._element === null) {
            this._element = value;
          }
          if (userRef !== null) {
            setRef(userRef, value);
          }
          this._userRef = userRef;
        };
      }
      // Filters class properties out and passes the remaining
      // attributes to React. This allows attributes to use framework rules
      // for setting attributes and render correctly under SSR.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props: any = {ref: this._ref};
      // Note, save element props while iterating to avoid the need to
      // iterate again when setting properties.
      this._elementProps = {};
      for (const [k, v] of Object.entries(this.props)) {
        if (k === '__forwardedRef') continue;

        if (elementClassProps.has(k)) {
          this._elementProps[k] = v;
        } else {
          // React does *not* handle `className` for custom elements so
          // coerce it to `class` so it's handled correctly.
          props[k === 'className' ? 'class' : k] = v;
        }
      }
      return createElement(tagName, props);
    }
  }

  const ForwardedComponent = React.forwardRef(
    (props?: UserProps, ref?: React.Ref<unknown>) =>
      createElement(
        ReactComponent,
        {...props, __forwardedRef: ref} as ComponentProps,
        props?.children
      )
  );

  // To ease debugging in the React Developer Tools
  ForwardedComponent.displayName = ReactComponent.displayName;

  return ForwardedComponent;
};
