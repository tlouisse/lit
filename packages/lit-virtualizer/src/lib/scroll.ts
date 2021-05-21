import { TemplateResult, nothing, ChildPart, html } from 'lit';
import { directive, PartInfo, PartType } from 'lit/directive.js';
import { AsyncDirective } from 'lit/async-directive.js';
import { repeat } from 'lit/directives/repeat.js';
import { Layout, LayoutConstructor, LayoutSpecifier } from './uni-virtualizer/lib/layouts/Layout.js';
import { VirtualScroller, ScrollToIndexValue } from './uni-virtualizer/lib/VirtualScroller.js';

/**
 * Configuration options for the scroll directive.
 */
interface ScrollConfig {
    /**
     * A function that returns a lit-html TemplateResult. It will be used
     * to generate the DOM for each item in the virtual list.
     */
    renderItem?: (item: any, index?: number) => TemplateResult;

    keyFunction?: (item: any) => unknown;
  
    // TODO (graynorton): Document...
    layout?: Layout | LayoutConstructor | LayoutSpecifier | null;
  
    /**
     * An element that receives scroll events for the virtual scroller.
     */
    scrollTarget?: Element | Window;
  
    /**
     * The list of items to display via the renderItem function.
     */
    items?: Array<any>;
  
    /**
     * Limit for the number of items to display. Defaults to the length of the
     * items array.
     */
    totalItems?: number;
  
    /**
     * Index and position of the item to scroll to.
     */
    scrollToIndex?: ScrollToIndexValue;
  }
  
export const defaultKeyFunction = (item: any) => item;
export const defaultRenderItem = (item: any) => html`${JSON.stringify(item, null, 2)}`;

class ScrollDirective extends AsyncDirective {
    container: HTMLElement | null = null
    scroller: VirtualScroller | null = null
    first = 0
    last = -1
    renderItem: (item: any, index?: number) => TemplateResult = defaultRenderItem;
    keyFunction: (item: any) => unknown = defaultKeyFunction;
    items: Array<unknown> = []

    constructor(part: PartInfo) {
        super(part);
        if (part.type !== PartType.CHILD) {
            throw new Error('The scroll directive can only be used in child expressions');
        }
    }
    
    render(config?: ScrollConfig) {
        if (config) {
            this.renderItem = config.renderItem || this.renderItem;
            this.keyFunction = config.keyFunction || this.keyFunction;
        }
        const itemsToRender = [];
        if (this.first >= 0 && this.last >= this.first) {
            for (let i = this.first; i < this.last + 1; i++) {
                itemsToRender.push(this.items[i]);
            }    
        }
        return repeat(itemsToRender, this.keyFunction || defaultKeyFunction, this.renderItem);
    }

    update(part: ChildPart, [config]: [ScrollConfig]) {
        if (this.scroller || this._initialize(part, config)) {
            const { scroller } = this;
            this.items = scroller!.items = config.items || [];
            scroller!.totalItems = config.totalItems || config.items?.length || 0;
            scroller!.layout = config.layout || null;
            scroller!.scrollTarget = config.scrollTarget || this.container;
            if (config.scrollToIndex) {
                scroller!.scrollToIndex = config.scrollToIndex;
            }
            return this.render(config);    
        }
        return nothing;
    }

    private _initialize(part: ChildPart, config: ScrollConfig) {
        const container = this.container = part.parentNode as HTMLElement;
        if (container && container.nodeType === 1) {
            this.scroller = new VirtualScroller({ container });
            container.addEventListener('rangeChanged', (e: Event) => {
                this.first = (e as CustomEvent).detail.first;
                this.last = (e as CustomEvent).detail.last;
                this.setValue(this.render());
            });
            return true;
        }
        // TODO (GN): This seems to be needed in the case where the `scroll`
        // directive is used within the `LitVirtualizer` element. Figure out why
        // and see if there's a cleaner solution.
        Promise.resolve().then(() => this.update(part, [config]));
        return false;
    }
}

export const scroll = directive(ScrollDirective);