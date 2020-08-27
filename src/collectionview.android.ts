﻿import { ChangeType, ChangedData, GridLayout, Length, Property, ProxyViewContainer, Trace, View, paddingBottomProperty, paddingLeftProperty, paddingRightProperty, paddingTopProperty, profile, Utils } from '@nativescript/core';
import { CollectionViewItemEventData, Orientation, reverseLayoutProperty } from './collectionview';
import { CLog, CLogTypes, CollectionViewBase, ListViewViewTypes, isScrollEnabledProperty, orientationProperty } from './collectionview-common';

export * from './collectionview-common';

// Snapshot friendly GridViewAdapter
interface CellViewHolder extends com.nativescript.collectionview.CollectionViewCellHolder {
    // tslint:disable-next-line:no-misused-new
    new (owner: WeakRef<View>, collectionView: WeakRef<CollectionView>): CellViewHolder;
}
let CellViewHolder: CellViewHolder;

// function initCellViewHolder() {
//     if (CellViewHolder) {
//         return;
//     }
//     @Interfaces([android.view.View.OnClickListener])
//     class CellViewHolderImpl extends com.nativescript.collectionview.CollectionViewCellHolder implements android.view.View.OnClickListener {
//         constructor(private owner: WeakRef<View>, private collectionView: WeakRef<CollectionView>) {
//             super(owner.get().android);

//             const nativeThis = global.__native(this);
//             const nativeView = owner.get().android as android.view.View;
//             nativeView.setOnClickListener(nativeThis);

//             return nativeThis;
//         }

//         get view(): View {
//             return this.owner ? this.owner.get() : null;
//         }

//         public onClick(v: android.view.View) {
//             const collectionView = this.collectionView.get();
//             const position = this.getAdapterPosition();
//             collectionView.notify<CollectionViewItemEventData>({
//                 eventName: CollectionViewBase.itemTapEvent,
//                 object: collectionView,
//                 index: position,
//                 item: collectionView.getItem(position),
//                 view: this.view,
//             });
//         }
//     }
//     CellViewHolder = CellViewHolderImpl as any;
// }
const extraLayoutSpaceProperty = new Property<CollectionViewBase, number>({
    name: 'extraLayoutSpace',
});
const itemViewCacheSizeProperty = new Property<CollectionViewBase, number>({
    name: 'itemViewCacheSize',
});
export class CollectionView extends CollectionViewBase {
    public static DEFAULT_TEMPLATE_VIEW_TYPE = 0;
    public static CUSTOM_TEMPLATE_ITEM_TYPE = 1;
    public nativeViewProtected: CollectionViewRecyclerView & {
        scrollListener: com.nativescript.collectionview.OnScrollListener;
        layoutManager: androidx.recyclerview.widget.RecyclerView.LayoutManager;
        owner?: WeakRef<CollectionView>;
    };

    templateTypeNumberString = new Map<string, number>();
    templateStringTypeNumber = new Map<number, string>();
    _currentNativeItemType = 0;

    // used to store viewHolder and make sure they are not garbaged
    _viewHolders = new Array<CollectionViewCellHolder>();

    // used to "destroy" cells when possible
    _viewHolderChildren = new Array();

    private _listViewAdapter: com.nativescript.collectionview.Adapter;

    @profile
    public createNativeView() {
        // storing the class in a property for reuse in the future cause a materializing which is pretty slow!
        if (!CollectionViewRecyclerView) {
            CollectionViewRecyclerView = com.nativescript.collectionview.RecyclerView as any;
        }
        const recyclerView = (CollectionViewRecyclerView as any).createRecyclerView(this._context);
        // const expMgr = new RecyclerViewExpandableItemManager(null);
        // adapter.setDisplayHeadersAtStartUp(true).setStickyHeaders(true); //Make headers sticky
        // Endless scroll with 1 item threshold
        // .setLoadingMoreAtStartUp(true)
        // .setEndlessScrollListener(this, new ProgressItem())
        // .setEndlessScrollThreshold(1); //Default=1

        // const fastScroller = new com.l4digital.fastscroll.FastScroller(this._context);
        // fastScroller.setSectionIndexer(adapter);
        // fastScroller.attachRecyclerView(recyclerView);

        return recyclerView;
    }

    @profile
    public initNativeView() {
        super.initNativeView();

        const nativeView = this.nativeViewProtected;
        nativeView.owner = new WeakRef(this);
        nativeView.sizeChangedListener = new com.nativescript.collectionview.SizeChangedListener({
            onSizeChanged: (w, h, oldW, oldH) => {
                this.onSizeChanged(w, h);
            },
        });

        // const orientation = this._getLayoutManagarOrientation();

        // initGridLayoutManager();
        let layoutManager: androidx.recyclerview.widget.RecyclerView.LayoutManager;
        if (CollectionViewBase.layoutStyles[this.layoutStyle]) {
            layoutManager = CollectionViewBase.layoutStyles[this.layoutStyle].createLayout(this);
        } else {
            layoutManager = new com.nativescript.collectionview.PreCachingGridLayoutManager(this._context, 1);
        }
        // this.spanSize
        nativeView.setLayoutManager(layoutManager);
        nativeView.layoutManager = layoutManager;
        this.spanSize = this._getSpanSize;

        const animator = new com.h6ah4i.android.widget.advrecyclerview.animator.RefactoredDefaultItemAnimator();

        // Change animations are enabled by default since support-v7-recyclerview v22.
        // Need to disable them when using animation indicator.
        animator.setSupportsChangeAnimations(false);

        nativeView.setItemAnimator(animator);
        this.refresh();

        // colWidthProperty.coerce(this);
        // rowHeightProperty.coerce(this);
    }
    _getSpanSize: (position: number) => number;
    set spanSize(inter: (position: number) => number) {
        if (!(typeof inter === 'function')) {
            return;
        }
        this._getSpanSize = inter;
        const layoutManager = this.layoutManager;
        if (layoutManager && layoutManager['setSpanSizeLookup']) {
            layoutManager['setSpanSizeLookup'](
                inter
                    ? new com.nativescript.collectionview.SpanSizeLookup(
                        new com.nativescript.collectionview.SpanSizeLookup.Interface({
                            getSpanSize: inter,
                        })
                    )
                    : null
            );
        }
    }
    get spanSize() {
        return this._getSpanSize;
    }
    onLoaded() {
        super.onLoaded();
        this.attachScrollListener();
    }

    _scrollOrLoadMoreChangeCount = 0;
    _nScrollListener: com.nativescript.collectionview.OnScrollListener.Listener;
    scrolling = false;
    private attachScrollListener() {
        if (this._scrollOrLoadMoreChangeCount > 0 && this.isLoaded) {
            const nativeView = this.nativeViewProtected;
            if (!nativeView.scrollListener) {
                this._nScrollListener = new com.nativescript.collectionview.OnScrollListener.Listener({
                    onScrollStateChanged: this.onScrollStateChanged.bind(this),
                    onScrolled: this.onScrolled.bind(this),
                });
                const scrollListener = new com.nativescript.collectionview.OnScrollListener(this._nScrollListener);
                nativeView.addOnScrollListener(scrollListener);
                nativeView.scrollListener = scrollListener;
            }
        }
    }

    private dettachScrollListener() {
        if (this._scrollOrLoadMoreChangeCount === 0 && this.isLoaded) {
            const nativeView = this.nativeViewProtected;
            if (nativeView.scrollListener) {
                this.nativeView.removeOnScrollListener(nativeView.scrollListener);
                nativeView.scrollListener = null;
            }
        }
    }

    public onScrolled(view: androidx.recyclerview.widget.RecyclerView, dx: number, dy: number) {
        if (!this || !this.scrolling) {
            return;
        }

        if (this.hasListeners(CollectionViewBase.scrollEvent)) {
            this.notify({
                object: this,
                eventName: CollectionViewBase.scrollEvent,
                scrollOffset: (this.isHorizontal() ? view.computeHorizontalScrollOffset() : view.computeVerticalScrollOffset()) / Utils.layout.getDisplayDensity(),
            });
        }

        if (this.hasListeners(CollectionViewBase.loadMoreItemsEvent) && this.items) {
            const layoutManager = view.getLayoutManager();
            if (layoutManager['findLastCompletelyVisibleItemPosition']) {
                const lastVisibleItemPos = layoutManager['findLastCompletelyVisibleItemPosition']();
                const itemCount = this.items.length - 1;
                if (lastVisibleItemPos === itemCount) {
                    this.notify({
                        eventName: CollectionViewBase.loadMoreItemsEvent,
                        object: this,
                    });
                }
            }
        }
    }

    public onScrollStateChanged(view: androidx.recyclerview.widget.RecyclerView, newState: number) {
        if (this.scrolling && newState === 0) {
            // SCROLL_STATE_IDLE
            this.scrolling = false;

            if (this.hasListeners(CollectionViewBase.scrollEndEvent)) {
                this.notify({
                    object: this,
                    eventName: CollectionViewBase.scrollEndEvent,
                    scrollOffset: (this.isHorizontal() ? view.computeHorizontalScrollOffset() : view.computeVerticalScrollOffset()) / Utils.layout.getDisplayDensity(),
                });
            }
        } else if (!this.scrolling && newState === 1) {
            //SCROLL_STATE_DRAGGING
            this.scrolling = true;
        }
    }

    public addEventListener(arg: string, callback: any, thisArg?: any) {
        super.addEventListener(arg, callback, thisArg);
        if (arg === CollectionViewBase.scrollEvent || arg === CollectionViewBase.loadMoreItemsEvent) {
            this._scrollOrLoadMoreChangeCount++;
            this.attachScrollListener();
        }
    }

    public removeEventListener(arg: string, callback: any, thisArg?: any) {
        super.removeEventListener(arg, callback, thisArg);

        if (arg === CollectionViewBase.scrollEvent || arg === CollectionViewBase.loadMoreItemsEvent) {
            this._scrollOrLoadMoreChangeCount--;
            this.dettachScrollListener();
        }
    }

    public disposeNativeView() {
        // clear the cache
        this.eachChildView((view) => {
            view.parent._removeView(view);
            return true;
        });
        // this._realizedItems.clear();

        const nativeView = this.nativeView;

        if (nativeView.scrollListener) {
            this.nativeView.removeOnScrollListener(nativeView.scrollListener);
            nativeView.scrollListener = null;
        }
        nativeView.layoutManager = null;

        super.disposeNativeView();
    }

    get android(): androidx.recyclerview.widget.RecyclerView {
        return this.nativeView;
    }
    get layoutManager() {
        return this.nativeViewProtected && this.nativeViewProtected.layoutManager;
    }
    _layoutParams: org.nativescript.widgets.CommonLayoutParams;
    _getViewLayoutParams() {
        if (!this._layoutParams) {
            const layoutParams = (this._layoutParams = new org.nativescript.widgets.CommonLayoutParams());
            // if (this.listViewLayout instanceof ListViewLinearLayout) {
            // if (this.listViewLayout.scrollDirection.toLowerCase() === listViewCommonModule.ListViewScrollDirection.Vertical.toLowerCase()) {
            layoutParams.width = org.nativescript.widgets.CommonLayoutParams.WRAP_CONTENT;
            layoutParams.height = org.nativescript.widgets.CommonLayoutParams.WRAP_CONTENT;
        }
        // }
        // else if (this.listViewLayout.scrollDirection.toLowerCase() === listViewCommonModule.ListViewScrollDirection.Horizontal.toLowerCase()) {
        //     layoutParams.width = org.nativescript.widgets.CommonLayoutParams.WRAP_CONTENT;
        //     layoutParams.height = org.nativescript.widgets.CommonLayoutParams.MATCH_PARENT;
        // }
        // }
        return this._layoutParams;
    }
    //     private listViewItemHeights = new java.util.Hashtable<java.util.Integer, Integer>();
    //    private listViewItemWidth = new java.util.Hashtable<Integer, Integer>();
    //     getScroll() {
    //         const firstVisibleItem = this.layoutManager.findFirstVisibleItemPosition();

    //         const c = this.nativeViewProtected.getChildAt(0); //this is the first visible row
    //         let scrollX = -c.getLeft();
    //         let scrollY = -c.getTop();
    //         listViewItemHeights.put(firstVisibleItem, c.getHeight());
    //         listViewItemWidth.put(firstVisibleItem, c.getWidth());
    //         for (let i = 0; i < firstVisibleItem; ++i) {
    //             if (this.listViewItemWidth.get(i) != null) { // (this is a sanity check)
    //                 scrollX += this.listViewItemWidth.get(i); //add all heights of the views that are gone
    //             }
    //             if (this.listViewItemHeights.get(i) != null) { // (this is a sanity check)
    //                 scrollY += this.listViewItemHeights.get(i); //add all heights of the views that are gone
    //             }
    //         }
    //         return [scrollX, scrollY];
    //     }

    // get _childrenCount(): number {
    //     return this._realizedItems.size;
    // }

    public [paddingTopProperty.getDefault](): number {
        return (this.nativeView as android.view.View).getPaddingTop();
    }
    public [paddingTopProperty.setNative](value: Length) {
        this._setPadding({ top: this.effectivePaddingTop });
    }

    public [paddingRightProperty.getDefault](): number {
        return (this.nativeView as android.view.View).getPaddingRight();
    }
    public [paddingRightProperty.setNative](value: Length) {
        this._setPadding({ right: this.effectivePaddingRight });
    }

    public [paddingBottomProperty.getDefault](): number {
        return (this.nativeView as android.view.View).getPaddingBottom();
    }
    public [paddingBottomProperty.setNative](value: Length) {
        this._setPadding({ bottom: this.effectivePaddingBottom });
    }

    public [paddingLeftProperty.getDefault](): number {
        return (this.nativeView as android.view.View).getPaddingLeft();
    }
    public [paddingLeftProperty.setNative](value: Length) {
        this._setPadding({ left: this.effectivePaddingLeft });
    }

    // public [orientationProperty.getDefault](): Orientation {
    //     const layoutManager = this.layoutManager;
    //     if (layoutManager.getOrientation() === androidx.recyclerview.widget.LinearLayoutManager.HORIZONTAL) {
    //         return 'horizontal';
    //     }

    //     return 'vertical';
    // }
    public [orientationProperty.setNative](value: Orientation) {
        const layoutManager = this.layoutManager;
        if (!layoutManager || !layoutManager['setOrientation']) {
            return;
        }
        if (this.isHorizontal()) {
            layoutManager['setOrientation'](0);
        } else {
            layoutManager['setOrientation'](1);
        }
    }
    // isScrollEnabled = true;
    public [isScrollEnabledProperty.setNative](value: boolean) {
        // this.isScrollEnabled = value;
        const layoutManager = this.layoutManager;
        if (layoutManager && layoutManager['isScrollEnabled']) {
            layoutManager['isScrollEnabled'] = value;
        }
    }
    public [reverseLayoutProperty.setNative](value: boolean) {
        // this.isScrollEnabled = value;
        const layoutManager = this.layoutManager;
        if (layoutManager && layoutManager['setReverseLayout']) {
            layoutManager['setReverseLayout'](value);
            // layoutManager['setStackFromEnd'](value);
        }
    }
    public [extraLayoutSpaceProperty.setNative](value: number) {
        const layoutManager = this.layoutManager;
        if (layoutManager && layoutManager['setExtraLayoutSpace']) {
            layoutManager['setExtraLayoutSpace'](value);
        }
    }
    public [itemViewCacheSizeProperty.setNative](value: number) {
        this.nativeViewProtected.setItemViewCacheSize(value);
    }

    onItemViewLoaderChanged() {
        if (this.itemViewLoader) {
            this.refresh();
        }
    }
    onItemTemplateSelectorChanged(oldValue, newValue) {
        super.onItemTemplateSelectorChanged(oldValue, newValue);
        this.clearTemplateTypes();
        this.refresh();
    }

    onItemTemplateChanged(oldValue, newValue) {
        super.onItemTemplateChanged(oldValue, newValue); // TODO: update current template with the new one
        this.refresh();
    }
    onItemTemplatesChanged(oldValue, newValue) {
        super.onItemTemplatesChanged(oldValue, newValue); // TODO: update current template with the new one
        this.refresh();
    }
    // public eachChildView(callback: (child: View) => boolean): void {
    //     this._realizedItems.forEach((view, key) => {
    //         callback(view);
    //     });
    // }

    public onLayout(left: number, top: number, right: number, bottom: number) {
        super.onLayout(left, top, right, bottom);
        const p = CollectionViewBase.plugins[this.layoutStyle];
        if (p && p.onLayout) {
            p.onLayout(this, left, top, right, bottom);
        }
        this.plugins.forEach((k) => {
            const p = CollectionViewBase.plugins[k];
            p.onLayout && p.onLayout(this, left, top, right, bottom);
        });
        if (this.layoutManager && this.layoutManager['setSpanCount']) {
            this.layoutManager['setSpanCount'](this.computeSpanCount());
        }
    }
    public onSourceCollectionChanged(event: ChangedData<any>) {
        if (!this._listViewAdapter) {
            return;
        }
        if (Trace.isEnabled()) {
            CLog(CLogTypes.log, 'onItemsChanged', event.action, event.index, event.addedCount, event.removed, event.removed && event.removed.length);
        }
        switch (event.action) {
            case ChangeType.Delete: {
                this._listViewAdapter.notifyItemRangeRemoved(event.index, event.removed.length);
                return;
            }
            case ChangeType.Add: {
                if (event.addedCount > 0) {
                    this._listViewAdapter.notifyItemRangeInserted(event.index, event.addedCount);
                }
                // Reload the items to avoid duplicate Load on Demand indicators:
                return;
            }
            case ChangeType.Update: {
                if (event.addedCount > 0) {
                    this._listViewAdapter.notifyItemRangeChanged(event.index, event.addedCount);
                }
                // if (event.removed && event.removed.length > 0) {
                //     this._listViewAdapter.notifyItemRangeRemoved(event.index, event.removed.length);
                // }
                return;
            }
            case ChangeType.Splice: {
                if (event.addedCount > 0) {
                    this._listViewAdapter.notifyItemRangeInserted(event.index, event.addedCount);
                }
                if (event.removed && event.removed.length > 0) {
                    this._listViewAdapter.notifyItemRangeRemoved(event.index, event.removed.length);
                }
                return;
            }
        }
        this._listViewAdapter.notifyDataSetChanged();
    }

    @profile
    public refresh() {
        if (!this.nativeViewProtected) {
            return;
        }
        const view = this.nativeViewProtected;
        if (!this.isLoaded) {
            this._isDataDirty = true;
            return;
        }
        this._isDataDirty = false;
        let adapter = this._listViewAdapter;
        if (!adapter) {
            adapter = this._listViewAdapter = this.createComposedAdapter(this.nativeViewProtected);
            adapter.setHasStableIds(!!this._itemIdGenerator);
            view.setAdapter(adapter);
        } else if (!view.getAdapter()) {
            view.setAdapter(adapter);
        }

        // nativeView.adapter.owner = new WeakRef(this);

        const layoutManager = view.getLayoutManager();
        if (layoutManager['setSpanCount']) {
            layoutManager['setSpanCount'](this.computeSpanCount());
        }
        adapter.notifyDataSetChanged();
        const args = {
            eventName: CollectionViewBase.dataPopulatedEvent,
            object: this,
        };
        this.notify(args);
    }

    public scrollToIndex(index: number, animated: boolean = true) {
        if (!this.nativeView) {
            return;
        }
        if (animated) {
            this.nativeView.smoothScrollToPosition(index);
        } else {
            this.nativeView.scrollToPosition(index);
        }
    }

    private _setPadding(newPadding: { top?: number; right?: number; bottom?: number; left?: number }) {
        const nativeView: android.view.View = this.nativeView;
        const padding = {
            top: nativeView.getPaddingTop(),
            right: nativeView.getPaddingRight(),
            bottom: nativeView.getPaddingBottom(),
            left: nativeView.getPaddingLeft(),
        };
        // tslint:disable-next-line:prefer-object-spread
        const newValue = Object.assign(padding, newPadding);
        nativeView.setPadding(newValue.left, newValue.top, newValue.right, newValue.bottom);
    }

    // private _getLayoutManagarOrientation() {
    //     let orientation = androidx.recyclerview.widget.LinearLayoutManager.VERTICAL;
    //     if (this.isHorizontal()) {
    //         orientation = androidx.recyclerview.widget.LinearLayoutManager.HORIZONTAL;
    //     }

    //     return orientation;
    // }
    private createComposedAdapter(recyclerView: CollectionViewRecyclerView) {
        const adapter = new com.nativescript.collectionview.Adapter();
        adapter.adapterInterface = new com.nativescript.collectionview.AdapterInterface({
            getItemId: this.getItemId.bind(this),
            getItemViewType: this.getItemViewType.bind(this),
            getItemCount: this.getItemCount.bind(this),
            onCreateViewHolder: this.onCreateViewHolder.bind(this),
            onBindViewHolder: this.onBindViewHolder.bind(this),
        });
        // const composedAdapter = new com.h6ah4i.android.widget.advrecyclerview.composedadapter.ComposedAdapter();
        // composedAdapter.addAdapter(new CollectionViewAdapter(new WeakRef(this)));
        return adapter;
    }

    public getItemCount() {
        return this.items ? this.items.length : 0;
    }

    public getItem(i: number) {
        if (this.items && i < this.items.length) {
            return this.getItemAtIndex(i);
        }
        return null;
    }

    public getItemId(i: number) {
        let id = i;
        if (this._itemIdGenerator && this.items) {
            const item = this.getItemAtIndex(i);
            id = this._itemIdGenerator(item, i, this.items);
        }
        return long(id);
    }
    onItemIdGeneratorChanged(oldValue, newValue) {
        super.onItemIdGeneratorChanged(oldValue, newValue);
        if (this._listViewAdapter) {
            this._listViewAdapter.setHasStableIds(!!newValue);
        }
    }

    public clearTemplateTypes() {
        this._currentNativeItemType = 0;
        this.templateTypeNumberString.clear();
        this.templateStringTypeNumber.clear();
    }

    // public notifyDataSetChanged() {
    //     this.disposeViewHolderViews();
    //     super.notifyDataSetChanged();
    // }

    @profile
    public getItemViewType(position: number) {
        let resultType = 0;
        let selectorType: string = 'default';
        if (this._itemTemplateSelector) {
            const selector = this._itemTemplateSelector;
            const dataItem = this.getItemAtIndex(position);
            if (dataItem) {
                selectorType = selector(dataItem, position, this.items);
            }
        }
        if (!this.templateTypeNumberString.has(selectorType)) {
            resultType = this._currentNativeItemType;
            this.templateTypeNumberString.set(selectorType, resultType);
            this.templateStringTypeNumber.set(resultType, selectorType);
            this._currentNativeItemType++;
        } else {
            resultType = this.templateTypeNumberString.get(selectorType);
        }
        return resultType;
    }

    @profile
    disposeViewHolderViews() {
        this._viewHolders.forEach((v) => {
            v.view = null;
            v.clickListener = null;
        });
        this._viewHolders = new Array();
        this._viewHolderChildren.forEach(this._removeViewCore);
    }
    @profile
    getKeyByValue(viewType: number) {
        return this.templateStringTypeNumber.get(viewType);
    }

    // private onClickListener;

    @profile
    public onCreateViewHolder(parent: android.view.ViewGroup, viewType: number) {
        let view: View = this.getViewForViewType(ListViewViewTypes.ItemView, this.getKeyByValue(viewType));
        const isNonSync = view === undefined;
        // dont create unecessary StackLayout if template.createView returns. Will happend when not using Vue or angular
        if (isNonSync || view instanceof ProxyViewContainer) {
            const parentView = new GridLayout();
            parentView.id = 'collectionViewHolder';
            view = parentView;
        }
        this._viewHolderChildren.push(view);
        this._addView(view);
        if (!CollectionViewCellHolder) {
            CollectionViewCellHolder = com.nativescript.collectionview.CollectionViewCellHolder as any;
        }

        const holder = new CollectionViewCellHolder(view.nativeView);

        const collectionView = this;
        const clickListener = new android.view.View.OnClickListener({
            onClick: () => {
                const position = holder.getAdapterPosition();
                collectionView.notify<CollectionViewItemEventData>({
                    eventName: CollectionViewBase.itemTapEvent,
                    object: collectionView,
                    index: position,
                    item: collectionView.getItem(position),
                    view: holder.view,
                });
            },
        });
        view.nativeView.setOnClickListener(clickListener);
        holder.clickListener = clickListener;
        holder.view = view;
        const layoutParams = this._getViewLayoutParams();
        view.nativeView.setLayoutParams(layoutParams);
        if (isNonSync) {
            holder['defaultItemView'] = true;
        }
        this._viewHolders.push(holder);

        return holder;
    }

    @profile
    public onBindViewHolder(holder: CollectionViewCellHolder, position: number) {
        if (Trace.isEnabled()) {
            CLog(CLogTypes.log, 'onBindViewHolder', position);
        }
        let view = holder.view;
        const bindingContext = this._prepareItem(view, position);
        const isNonSync = !!holder['defaultItemView'];

        view = isNonSync ? (view as GridLayout).getChildAt(0) : view;

        const args = {
            eventName: CollectionViewBase.itemLoadingEvent,
            index: position,
            object: this,
            view,
            bindingContext,
            android: holder,
        };
        this.notifyLoading(args);

        if (isNonSync && args.view !== view) {
            view = args.view;
            // the view has been changed on the event handler
            (holder.view as GridLayout).addChild(args.view);
        }
        let width = this._effectiveColWidth;
        let height = this._effectiveRowHeight;
        if (this._getSpanSize) {
            const spanSize = this._getSpanSize(position);
            const horizontal = this.isHorizontal();
            if (horizontal) {
                height *= spanSize;
            } else {
                width *= spanSize;
            }
        }
        if (width || !view.width) {
            view.width = Utils.layout.toDeviceIndependentPixels(width);
        }
        if (height || !view.height) {
            view.height = Utils.layout.toDeviceIndependentPixels(height);
        }

        // if (this.hasListeners(CollectionViewBase.displayItemEvent) ) {
        //     this.notify<CollectionViewItemDisplayEventData>({
        //         eventName: CollectionViewBase.displayItemEvent,
        //         index:position,
        //         object: this,
        //     });
        // }
        if (Trace.isEnabled()) {
            CLog(CLogTypes.log, 'onBindViewHolder done ', position);
        }
    }
}

// interface CollectionViewAdapter extends androidx.recyclerview.widget.RecyclerView.Adapter<any> {
//     // tslint:disable-next-line:no-misused-new
//     new (owner: WeakRef<CollectionView>): CollectionViewAdapter;
//     clearTemplateTypes();
//     disposeViewHolderViews();
// }
// let CollectionViewAdapter: CollectionViewAdapter;

// Snapshot friendly CollectionViewAdapter
interface CollectionViewCellHolder extends com.nativescript.collectionview.CollectionViewCellHolder {
    // tslint:disable-next-line:no-misused-new
    new (androidView: android.view.View): CollectionViewCellHolder;
    view: View;
    clickListener: android.view.View.OnClickListener;
}

let CollectionViewCellHolder: CollectionViewCellHolder;

export interface CollectionViewRecyclerView extends com.nativescript.collectionview.RecyclerView {
    // tslint:disable-next-line:no-misused-new
    // new (context: any, owner: WeakRef<CollectionView>): CollectionViewRecyclerView;
    new (context: any): CollectionViewRecyclerView;
}

let CollectionViewRecyclerView: CollectionViewRecyclerView;
itemViewCacheSizeProperty.register(CollectionViewBase);
extraLayoutSpaceProperty.register(CollectionViewBase);
