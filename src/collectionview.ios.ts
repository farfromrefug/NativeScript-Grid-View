import {
    ChangeType,
    ChangedData,
    EventData,
    GridLayout,
    KeyedTemplate,
    Length,
    Observable,
    ProxyViewContainer,
    Trace,
    View,
    paddingBottomProperty,
    paddingLeftProperty,
    paddingRightProperty,
    paddingTopProperty,
    profile,
    Utils
} from '@nativescript/core';
import { CollectionViewItemEventData, Orientation, reverseLayoutProperty } from './collectionview';
import { CLog, CLogTypes, CollectionViewBase, ListViewViewTypes, isBounceEnabledProperty, isScrollEnabledProperty, itemTemplatesProperty, orientationProperty } from './collectionview-common';

export * from './collectionview-common';

const infinity = Utils.layout.makeMeasureSpec(0, Utils.layout.UNSPECIFIED);

export class CollectionView extends CollectionViewBase {
    private _layout: UICollectionViewLayout;
    private _dataSource: CollectionViewDataSource;
    private _delegate: UICollectionViewDelegateImpl;
    private _preparingCell: boolean = false;
    private _sizes: number[][];
    private _map: Map<CollectionViewCell, ItemView>;
    _measureCellMap: Map<string, { cell: CollectionViewCell; view: View }>;

    nativeViewProtected: UICollectionView;

    constructor() {
        super();
        this._map = new Map<CollectionViewCell, View>();
        this._sizes = new Array<number[]>();
    }

    public createNativeView() {
        let layout: UICollectionViewLayout;
        if (CollectionViewBase.layoutStyles[this.layoutStyle]) {
            layout = this._layout = CollectionViewBase.layoutStyles[this.layoutStyle].createLayout(this);
        } else {
            layout = this._layout = UICollectionViewFlowLayout.alloc().init();
        }
        if (layout instanceof UICollectionViewFlowLayout) {
            layout.minimumLineSpacing = 0;
            layout.minimumInteritemSpacing = 0;
        }
        const view = UICollectionView.alloc().initWithFrameCollectionViewLayout(CGRectMake(0, 0, 0, 0), layout);
        view.backgroundColor = UIColor.clearColor;
        this._itemTemplatesInternal.forEach((t) => {
            view.registerClassForCellWithReuseIdentifier(<any>CollectionViewCell.class(), t.key.toLowerCase());
        });
        view.autoresizesSubviews = false;
        view.autoresizingMask = UIViewAutoresizing.None;

        return view;
    }

    onTemplateAdded(t) {
        super.onTemplateAdded(t);
        if (this.nativeViewProtected) {
            this.nativeViewProtected.registerClassForCellWithReuseIdentifier(<any>CollectionViewCell.class(), t.key.toLowerCase());
        }
    }

    public initNativeView() {
        super.initNativeView();

        const nativeView = this.nativeView;
        this._dataSource = CollectionViewDataSource.initWithOwner(this);
        nativeView.dataSource = this._dataSource;

        const layoutStyle = CollectionViewBase.layoutStyles[this.layoutStyle];
        if (layoutStyle && layoutStyle.createDelegate) {
            this._delegate = layoutStyle.createDelegate();
        } else {
            this._delegate = UICollectionViewDelegateImpl.initWithOwner(this);
        }
        this._delegate._owner = new WeakRef(this);
        this._measureCellMap = new Map<string, { cell: CollectionViewCell; view: View }>();
        this.nativeView.delegate = this._delegate;

        this._setNativeClipToBounds();
    }

    public disposeNativeView() {
        if (Trace.isEnabled()) {
            CLog(CLogTypes.log, 'disposeNativeView');
        }
        const nativeView = this.nativeView;
        nativeView.delegate = null;
        this._delegate = null;
        nativeView.dataSource = null;
        this._dataSource = null;
        this._layout = null;
        this.clearRealizedCells();
        super.disposeNativeView();
    }

    _onSizeChanged() {
        super._onSizeChanged();
        this.onSizeChanged(this.getMeasuredWidth(), this.getMeasuredHeight());
    }

    get _childrenCount(): number {
        return this._map.size;
    }

    public [paddingTopProperty.setNative](value: Length) {
        this._setPadding({ top: Utils.layout.toDeviceIndependentPixels(this.effectivePaddingTop) });
    }

    public [paddingRightProperty.setNative](value: Length) {
        this._setPadding({ right: Utils.layout.toDeviceIndependentPixels(this.effectivePaddingRight) });
    }

    public [paddingBottomProperty.setNative](value: Length) {
        this._setPadding({ bottom: Utils.layout.toDeviceIndependentPixels(this.effectivePaddingBottom) });
    }

    public [paddingLeftProperty.setNative](value: Length) {
        this._setPadding({ left: Utils.layout.toDeviceIndependentPixels(this.effectivePaddingLeft) });
    }

    public [orientationProperty.setNative](value: Orientation) {
        const layout = this._layout;
        if (layout instanceof UICollectionViewFlowLayout) {
            if (value === 'horizontal') {
              layout.scrollDirection = UICollectionViewScrollDirection.Horizontal;
            } else {
              layout.scrollDirection = UICollectionViewScrollDirection.Vertical;
            }
        }
    }
    public [isScrollEnabledProperty.setNative](value: boolean) {
        this.nativeViewProtected.scrollEnabled = value;
    }
    public [isBounceEnabledProperty.setNative](value: boolean) {
        this.nativeViewProtected.bounces = value;
        // this.nativeViewProtected.alwaysBounceHorizontal = value;
    }

    public [itemTemplatesProperty.getDefault](): KeyedTemplate[] {
        return null;
    }
    public [reverseLayoutProperty.setNative](value: boolean) {
        this.nativeViewProtected.transform = value ? CGAffineTransformMakeRotation(-Math.PI) : null;
    }

    public eachChildView(callback: (child: View) => boolean): void {
        this._map.forEach((view, key) => {
            callback(view);
        });
    }

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

        const layoutView = this.nativeViewProtected.collectionViewLayout;
        if ((layoutView instanceof UICollectionViewFlowLayout && this._effectiveColWidth) || this._effectiveRowHeight) {
            // @ts-ignore
            layoutView.estimatedItemSize = layoutView.itemSize = CGSizeMake(Utils.layout.toDeviceIndependentPixels(this._effectiveColWidth), Utils.layout.toDeviceIndependentPixels(this._effectiveRowHeight));
        }
        this._map.forEach((cellView, cell) => {
            if (Trace.isEnabled()) {
                CLog(CLogTypes.log, 'onLayout', 'cell', cellView._listViewItemIndex);
            }
            this.layoutCell(cellView._listViewItemIndex, cell, cellView);
        });
    }

    public isHorizontal() {
        return this.orientation === 'horizontal';
    }

    public onSourceCollectionChanged(event: ChangedData<any>) {
        if (!this.nativeViewProtected) {
            return;
        }
        if (Trace.isEnabled()) {
            CLog(CLogTypes.log, 'onItemsChanged', event.action, event.index, event.addedCount, event.removed && event.removed.length);
        }
        // we need to clear stored cell sizes and it wont be correct anymore
        this.clearCellSize();

        switch (event.action) {
            case ChangeType.Delete: {
                const indexes = NSMutableArray.new<NSIndexPath>();
                for (let index = 0; index < event.addedCount; index++) {
                    indexes.addObject(NSIndexPath.indexPathForRowInSection(event.index + index, 0));
                }
                this.unbindUnusedCells(event.removed);
                if (Trace.isEnabled()) {
                    CLog(CLogTypes.info, 'deleteItemsAtIndexPaths', indexes.count);
                }
                this.nativeViewProtected.performBatchUpdatesCompletion(() => {
                    this.nativeViewProtected.deleteItemsAtIndexPaths(indexes);
                }, null);
                return;
            }
            case ChangeType.Update: {
                const indexes = NSMutableArray.new<NSIndexPath>();
                indexes.addObject(NSIndexPath.indexPathForRowInSection(event.index, 0));
                if (Trace.isEnabled()) {
                    CLog(CLogTypes.info, 'reloadItemsAtIndexPaths', indexes.count);
                }
                this.nativeViewProtected.performBatchUpdatesCompletion(() => {
                    this.nativeViewProtected.reloadItemsAtIndexPaths(indexes);
                }, null);
                return;
            }
            case ChangeType.Add: {
                const indexes = NSMutableArray.new<NSIndexPath>();
                for (let index = 0; index < event.addedCount; index++) {
                    indexes.addObject(NSIndexPath.indexPathForRowInSection(event.index + index, 0));
                }
                if (Trace.isEnabled()) {
                    CLog(CLogTypes.info, 'insertItemsAtIndexPaths', indexes.count);
                }
                this.nativeViewProtected.performBatchUpdatesCompletion(() => {
                    this.nativeViewProtected.insertItemsAtIndexPaths(indexes);
                }, null);
                // Reload the items to avoid duplicate Load on Demand indicators:
                return;
            }
            case ChangeType.Splice: {
                this.nativeViewProtected.performBatchUpdatesCompletion(() => {
                    if (event.addedCount > 0) {
                        const indexes = NSMutableArray.alloc<NSIndexPath>().init();
                        for (let index = 0; index < event.addedCount; index++) {
                            indexes.addObject(NSIndexPath.indexPathForItemInSection(event.index + index, 0));
                        }
                        this.nativeViewProtected.insertItemsAtIndexPaths(indexes);
                    }
                    if (event.removed && event.removed.length > 0) {
                        const indexes = NSMutableArray.new<NSIndexPath>();
                        for (let index = 0; index < event.removed.length; index++) {
                            indexes.addObject(NSIndexPath.indexPathForItemInSection(event.index + index, 0));
                        }
                        this.unbindUnusedCells(event.removed);
                        if (Trace.isEnabled()) {
                            CLog(CLogTypes.info, 'deleteItemsAtIndexPaths', indexes.count);
                        }
                        this.nativeViewProtected.performBatchUpdatesCompletion(() => {
                            this.nativeViewProtected.deleteItemsAtIndexPaths(indexes);
                        }, null);
                    }
                }, null);

                return;
            }
            // break;
        }
        this.refresh();
    }

    onItemTemplatesChanged(oldValue, newValue) {
        super.onItemTemplatesChanged(oldValue, newValue);
        if (!this.nativeViewProtected) {
            return;
        }
        const view = this.nativeViewProtected;
        this._itemTemplatesInternal.forEach((t) => {
            view.registerClassForCellWithReuseIdentifier(<any>CollectionViewCell.class(), t.key.toLowerCase());
        });
    }

    private unbindUnusedCells(removedDataItems) {
        this._map.forEach((view, nativeView, map) => {
            if (!view || !view.bindingContext) {
                return;
            }
            if (removedDataItems.indexOf(view.bindingContext) !== -1) {
                view.bindingContext = undefined;
            }
        }, this);
    }
    @profile
    public refresh() {
        if (!this.isLoaded || !this.nativeView) {
            this._isDataDirty = true;
            return;
        }
        this._isDataDirty = false;
        if (Trace.isEnabled()) {
            CLog(CLogTypes.info, 'refresh');
        }
        // we need to clear stored cell sizes and it wont be correct anymore
        this.clearCellSize();

        // clear bindingContext when it is not observable because otherwise bindings to items won't reevaluate
        this._map.forEach((view, nativeView, map) => {
            if (!(view.bindingContext instanceof Observable)) {
                view.bindingContext = null;
            }
        });

        // TODO: this is ugly look here: https://github.com/nativescript-vue/nativescript-vue/issues/525
        // this.clearRealizedCells();
        this.nativeViewProtected.reloadData();

        const args = {
            eventName: CollectionViewBase.dataPopulatedEvent,
            object: this,
        };
        this.notify(args);
    }

    public scrollToIndex(index: number, animated: boolean = true) {
        this.nativeViewProtected.scrollToItemAtIndexPathAtScrollPositionAnimated(
            NSIndexPath.indexPathForItemInSection(index, 0),
            this.orientation === 'vertical' ? UICollectionViewScrollPosition.Top : UICollectionViewScrollPosition.Left,
            animated
        );
    }

    public requestLayout(): void {
        // When preparing cell don't call super - no need to invalidate our measure when cell desiredSize is changed.
        if (!this._preparingCell) {
            super.requestLayout();
        }
    }

    public measure(widthMeasureSpec: number, heightMeasureSpec: number): void {
        const changed = (this as any)._setCurrentMeasureSpecs(widthMeasureSpec, heightMeasureSpec);
        super.measure(widthMeasureSpec, heightMeasureSpec);
        if (changed && this.nativeView) {
            this.nativeView.reloadData();
        }
    }

    public _setNativeClipToBounds() {
        this.nativeView.clipsToBounds = true;
    }
    notifyForItemAtIndex(listView: CollectionViewBase, cell: any, view: View, eventName: string, indexPath: NSIndexPath, bindingContext?) {
        const args = { eventName, object: listView, index: indexPath.row, view, ios: cell, bindingContext };
        listView.notify(args);
        return args;
    }
    _getItemTemplateType(indexPath) {
        const selector = this._itemTemplateSelector;
        let type = this._defaultTemplate.key;
        if (selector) {
            type = selector(this.getItemAtIndex(indexPath.item), indexPath.item, this.items);
        }
        return type.toLowerCase();
    }
    getItemTemplateContent(index, templateType) {
        return this.getViewForViewType(ListViewViewTypes.ItemView, templateType);
    }
    public _prepareCell(cell: CollectionViewCell, indexPath: NSIndexPath, templateType: string, addToMap = true) {
        let cellSize: [number, number];
        try {
            this._preparingCell = true;
            let view = cell.view;
            const index = indexPath.row;
            let needsLayout = false;
            if (!view) {
                needsLayout = true;
                view = this.getItemTemplateContent(index, templateType);
            }
            const oldBindingContext = view && view.bindingContext;
            const bindingContext = this._prepareItem(view, index);
            needsLayout = needsLayout || oldBindingContext !== bindingContext;

            if (Trace.isEnabled()) {
                CLog(CLogTypes.log, '_prepareCell', index, !!cell.view, !!view, cell.view !== view, needsLayout);
            }
            const args = this.notifyForItemAtIndex(this, cell, view, CollectionViewBase.itemLoadingEvent, indexPath, bindingContext);
            view = args.view;

            if (view instanceof ProxyViewContainer) {
                const sp = new GridLayout();
                sp.addChild(view);
                view = sp;
            }

            if (!cell.view) {
                cell.owner = new WeakRef(view);
            } else if (cell.view !== view) {
                this._removeContainer(cell);
                cell.view.nativeViewProtected.removeFromSuperview();
                cell.owner = new WeakRef(view);
            }
            view._listViewItemIndex = index;

            if (addToMap) {
                this._map.set(cell, view);
            }

            if (view && !view.parent) {
                this._addView(view);
                cell.contentView.addSubview(view.nativeViewProtected);
            }

            cellSize = this.measureCell(cell, view, indexPath);

            if (needsLayout) {
                view.requestLayout();
            }

            if (Trace.isEnabled()) {
                CLog(CLogTypes.log, '_prepareCell done', index, cellSize);
            }
        } finally {
            this._preparingCell = false;
        }
        return cellSize;
    }
    public getCellSize(index: number) {
        let result = this._sizes[index];
        // CLog(CLogTypes.log, 'getCellSize', index, result, this._effectiveColWidth, this._effectiveRowHeight, this.getMeasuredWidth(), this.getMeasuredHeight());
        if (!result) {
            let width = this._effectiveColWidth;
            let height = this._effectiveRowHeight;
            if (this.spanSize) {
                const spanSize = this.spanSize(index);
                const horizontal = this.isHorizontal();
                if (horizontal) {
                    height *= spanSize;
                } else {
                    width *= spanSize;
                }
            }
            if (width && height) {
                result = [width, height];
            } else if (height && this.orientation === 'vertical') {
                result = [this.getMeasuredWidth(), height];
            } else if (width && this.orientation === 'horizontal') {
                result = [width, this.getMeasuredHeight()];
            }
        }

        // return undefined;
        return result;
    }
    public storeCellSize(index: number, value) {
        this._sizes[index] = value;
    }
    public clearCellSize() {
        this._sizes = new Array<number[]>();
    }
    private measureCell(cell: CollectionViewCell, cellView: View, index: NSIndexPath): [number, number] {
        if (cellView) {
            let width = this._effectiveColWidth;
            let height = this._effectiveRowHeight;
            const horizontal = this.isHorizontal();
            if (this.spanSize) {
                const spanSize = this.spanSize(index.row);
                if (horizontal) {
                    height *= spanSize;
                } else {
                    width *= spanSize;
                }
            }

            const widthMeasureSpec = width ? Utils.layout.makeMeasureSpec(width, Utils.layout.EXACTLY) : horizontal ? infinity : Utils.layout.makeMeasureSpec(this._innerWidth, Utils.layout.UNSPECIFIED);
            const heightMeasureSpec = height ? Utils.layout.makeMeasureSpec(height, Utils.layout.EXACTLY) : horizontal ? Utils.layout.makeMeasureSpec(this._innerHeight, Utils.layout.UNSPECIFIED) : infinity;
            if (Trace.isEnabled()) {
                CLog(CLogTypes.log, 'measureCell', width, height, widthMeasureSpec, heightMeasureSpec);
            }
            const measuredSize = View.measureChild(this, cellView, widthMeasureSpec, heightMeasureSpec);
            const result: [number, number] = [measuredSize.measuredWidth, measuredSize.measuredHeight];

            this.storeCellSize(index.row, result);
            return result;
        }
        return undefined;
    }
    layoutCell(index: number, cell: any, cellView: View): any {
        const cellSize = this.getCellSize(index);
        cellView.iosOverflowSafeAreaEnabled = false;
        View.layoutChild(this, cellView, 0, 0, cellSize[0], cellSize[1]);
        if (Trace.isEnabled()) {
            CLog(CLogTypes.log, 'layoutCell', index, cellSize[0], cellSize[1], cellView.getMeasuredWidth(), cellView.getMeasuredHeight());
        }
    }

    private clearRealizedCells() {
        const that = new WeakRef<CollectionView>(this);
        this._map.forEach(function (value, key: CollectionViewCell) {
            that.get()._removeContainer(key);
            that.get()._clearCellViews(key);
        }, that);
        this._map.clear();
    }

    private _clearCellViews(cell: CollectionViewCell) {
        if (cell && cell.view) {
            if (cell.view.nativeViewProtected) {
                cell.view.nativeViewProtected.removeFromSuperview();
            }

            cell.owner = undefined;
        }
    }

    private _removeContainer(cell: CollectionViewCell): void {
        const view = cell.view;
        // This is to clear the StackLayout that is used to wrap ProxyViewContainer instances.
        if (!(view.parent instanceof CollectionView)) {
            this._removeView(view.parent);
        }
        // No need to request layout when we are removing cells.
        const preparing = this._preparingCell;
        this._preparingCell = true;
        view.parent._removeView(view);
        view._listViewItemIndex = undefined;
        this._preparingCell = preparing;
        this._map.delete(cell);
    }

    private _setPadding(newPadding: { top?: number; right?: number; bottom?: number; left?: number }) {
        const layout = this._layout;
        if (Utils.layout.hasOwnProperty('sectionInset')) {
            const padding = {
                top: layout['sectionInset'].top,
                right: layout['sectionInset'].right,
                bottom: layout['sectionInset'].bottom,
                left: layout['sectionInset'].left,
            };
            // tslint:disable-next-line:prefer-object-spread
            const newValue = Object.assign(padding, newPadding);
            layout['sectionInset'] = UIEdgeInsetsFromString(`{${newValue.top},${newValue.left},${newValue.bottom},${newValue.right}}`);
        }
    }

    numberOfSectionsInCollectionView(collectionView: UICollectionView) {
        return 1;
    }

    collectionViewNumberOfItemsInSection(collectionView: UICollectionView, section: number) {
        return this.items ? this.items.length : 0;
    }

    collectionViewCellForItemAtIndexPath(collectionView: UICollectionView, indexPath: NSIndexPath): UICollectionViewCell {
        const templateType = this._getItemTemplateType(indexPath);
        let cell: any = collectionView.dequeueReusableCellWithReuseIdentifierForIndexPath(templateType, indexPath);
        if (!cell) {
            cell = CollectionViewCell.new();
        }
        if (Trace.isEnabled()) {
            CLog(CLogTypes.log, 'collectionViewCellForItemAtIndexPath', indexPath.row, templateType, !!cell.view, cell);
        }
        this._prepareCell(cell, indexPath, templateType);

        const cellView: View = cell.view;
        if (cellView && cellView['isLayoutRequired']) {
            this.layoutCell(indexPath.row, cell, cellView);
        }

        return cell;
    }
    collectionViewWillDisplayCellForItemAtIndexPath(collectionView: UICollectionView, cell: UICollectionViewCell, indexPath: NSIndexPath) {
        if (this.reverseLayout) {
            cell.transform = CGAffineTransformMakeRotation(-Math.PI);
        }

        if (this.hasListeners(CollectionViewBase.loadMoreItemsEvent) && indexPath.row === this.items.length - 1) {
            this.notify<EventData>({
                eventName: CollectionViewBase.loadMoreItemsEvent,
                object: this,
            });
        }
        // if (this.hasListeners(CollectionViewBase.displayItemEvent) ) {
        //     this.notify<CollectionViewItemDisplayEventData>({
        //         eventName: CollectionViewBase.displayItemEvent,
        //         index:indexPath.row,
        //         object: this,
        //     });
        // }

        if (cell.preservesSuperviewLayoutMargins) {
            cell.preservesSuperviewLayoutMargins = false;
        }

        if (cell.layoutMargins) {
            cell.layoutMargins = UIEdgeInsetsZero;
        }
    }
    collectionViewDidSelectItemAtIndexPath(collectionView: UICollectionView, indexPath: NSIndexPath) {
        const cell = collectionView.cellForItemAtIndexPath(indexPath) as CollectionViewCell;
        const position = indexPath.row;
        this.notify<CollectionViewItemEventData>({
            eventName: CollectionViewBase.itemTapEvent,
            object: this,
            item: this.getItemAtIndex(position),
            index: position,
            view: cell.view,
        });

        cell.highlighted = false;

        return indexPath;
    }
    collectionViewLayoutSizeForItemAtIndexPath(collectionView: UICollectionView, collectionViewLayout: UICollectionViewLayout, indexPath: NSIndexPath) {
        const row = indexPath.row;
        const dataItem = this.getItemAtIndex(row);
        // if (dataItem.visible === false) {
        //     return CGSizeZero;
        // }

        let measuredSize = this.getCellSize(row);
        if (!measuredSize) {
            if (Trace.isEnabled()) {
                CLog(CLogTypes.log, 'collectionViewLayoutSizeForItemAtIndexPath', row);
            }
            const templateType = this._getItemTemplateType(indexPath);
            if (templateType) {
                const measureData: any = this._measureCellMap.get(templateType);
                let cell: any = measureData && measureData.cell;
                if (!cell) {
                    cell = CollectionViewCell.new();
                } else if (!cell.view) {
                    cell.owner = new WeakRef(measureData.view);
                }
                measuredSize = this._prepareCell(cell, indexPath, templateType, false);
                this._measureCellMap.set(templateType, { cell, view: cell.view });
            }
        }
        if (Trace.isEnabled()) {
            CLog(CLogTypes.log, 'collectionViewLayoutSizeForItemAtIndexPath', row, measuredSize);
        }
        if (measuredSize) {
            return CGSizeMake(Utils.layout.toDeviceIndependentPixels(measuredSize[0]), Utils.layout.toDeviceIndependentPixels(measuredSize[1]));
        }
        return CGSizeZero;
    }
    scrollViewDidScroll(scrollView: UIScrollView): void {
        this.notify({
            object: this,
            eventName: CollectionViewBase.scrollEvent,
            scrollOffset: this.isHorizontal() ? scrollView.contentOffset.x : scrollView.contentOffset.y,
        });
    }
    scrollViewDidEndDecelerating(scrollView: UIScrollView) {
        this.notify({
            object: this,
            eventName: CollectionViewBase.scrollEndEvent,
            scrollOffset: this.isHorizontal() ? scrollView.contentOffset.x : scrollView.contentOffset.y,
        });
    }
}

interface ViewItemIndex {
    _listViewItemIndex?: number;
}

type ItemView = View & ViewItemIndex;
@NativeClass
class CollectionViewCell extends UICollectionViewCell {
    owner: WeakRef<ItemView>;
    static class(): any {
      return CollectionViewCell;
    }
    get view(): ItemView {
        return this.owner ? this.owner.get() : null;
    }
}

@NativeClass
class CollectionViewDataSource extends NSObject implements UICollectionViewDataSource {
    _owner: WeakRef<CollectionView>;
    public static ObjCProtocols = [UICollectionViewDataSource];

    static initWithOwner(owner: CollectionView) {
        const delegate = CollectionViewDataSource.new() as CollectionViewDataSource;
        delegate._owner = new WeakRef(owner);
        return delegate;
    }
    numberOfSectionsInCollectionView(collectionView: UICollectionView) {
        const owner = this._owner.get();
        if (owner) {
            return owner.numberOfSectionsInCollectionView(collectionView);
        }
        return 0;
    }

    collectionViewNumberOfItemsInSection(collectionView: UICollectionView, section: number) {
        const owner = this._owner.get();
        if (owner) {
            return owner.collectionViewNumberOfItemsInSection(collectionView, section);
        }
        return 0;
    }

    collectionViewCellForItemAtIndexPath(collectionView: UICollectionView, indexPath: NSIndexPath): UICollectionViewCell {
        const owner = this._owner.get();
        if (owner) {
            return owner.collectionViewCellForItemAtIndexPath(collectionView, indexPath);
        }
        return null;
    }
}
@NativeClass
class UICollectionViewDelegateImpl extends NSObject implements UICollectionViewDelegate, UICollectionViewDelegateFlowLayout {
    _owner: WeakRef<CollectionView>;
    public static ObjCProtocols = [UICollectionViewDelegate, UICollectionViewDelegateFlowLayout];

    static initWithOwner(owner: CollectionView) {
        const delegate = UICollectionViewDelegateImpl.new() as UICollectionViewDelegateImpl;
        delegate._owner = new WeakRef(owner);
        return delegate;
    }
    collectionViewWillDisplayCellForItemAtIndexPath(collectionView: UICollectionView, cell: UICollectionViewCell, indexPath: NSIndexPath) {
        const owner = this._owner.get();
        if (owner) {
            owner.collectionViewWillDisplayCellForItemAtIndexPath(collectionView, cell, indexPath);
        }
    }
    collectionViewDidSelectItemAtIndexPath(collectionView: UICollectionView, indexPath: NSIndexPath) {
        const owner = this._owner.get();
        if (owner) {
            return owner.collectionViewDidSelectItemAtIndexPath(collectionView, indexPath);
        }
        return indexPath;
    }
    collectionViewLayoutSizeForItemAtIndexPath(collectionView: UICollectionView, collectionViewLayout: UICollectionViewLayout, indexPath: NSIndexPath) {
        const owner = this._owner.get();
        if (owner) {
            return owner.collectionViewLayoutSizeForItemAtIndexPath(collectionView, collectionViewLayout, indexPath);
        }
        return CGSizeZero;
    }
    scrollViewDidScroll(scrollView: UIScrollView): void {
        const owner = this._owner.get();
        if (owner) {
            owner.scrollViewDidScroll(scrollView);
        }
    }
    scrollViewDidEndDecelerating(scrollView: UIScrollView) {
        const owner = this._owner.get();
        if (owner) {
            owner.scrollViewDidEndDecelerating(scrollView);
        }
    }
}
