/**
 * Create a timeline visualization
 * @param {HTMLElement} container
 * @param {vis.DataSet | Array | DataTable} [items]
 * @param {Object} [options]  See Timeline.setOptions for the available options.
 * @constructor
 */
function Timeline (container, items, options) {
    var me = this;
    this.options = {
        orientation: 'bottom',
        zoomMin: 10,     // milliseconds
        zoomMax: 1000 * 60 * 60 * 24 * 365 * 10000, // milliseconds
        moveable: true,
        zoomable: true
    };

    // controller
    this.controller = new Controller();

    // main panel
    if (!container) {
        throw new Error('No container element provided');
    }
    this.main = new RootPanel(container, {
        autoResize: false
    });
    this.controller.add(this.main);

    // range
    var now = moment().hours(0).minutes(0).seconds(0).milliseconds(0);
    this.range = new Range({
        start: now.clone().add('days', -3).valueOf(),
        end:   now.clone().add('days', 4).valueOf()
    });
    // TODO: reckon with options moveable and zoomable
    this.range.subscribe(this.main, 'move', 'horizontal');
    this.range.subscribe(this.main, 'zoom', 'horizontal');
    this.range.on('rangechange', function () {
        var force = true;
        me.controller.requestReflow(force);
    });
    this.range.on('rangechanged', function () {
        var force = true;
        me.controller.requestReflow(force);
    });

    // TODO: put the listeners in setOptions, be able to dynamically change with options moveable and zoomable

    // time axis
    this.timeaxis = new TimeAxis(this.main, [], {
        orientation: this.options.orientation,
        range: this.range
    });
    this.timeaxis.setRange(this.range);
    this.controller.add(this.timeaxis);

    // create itemset or groupset
    this.setGroups(null);

    this.items = null;      // DataSet
    this.groups = null;     // DataSet

    // set options (must take place before setting the data)
    if (options) {
        this.setOptions(options);
    }

    // set data
    if (items) {
        this.setItems(items);
    }
}

/**
 * Set options
 * @param {Object} options  TODO: describe the available options
 */
Timeline.prototype.setOptions = function (options) {
    util.extend(this.options, options);

    // update options the timeaxis
    this.timeaxis.setOptions(this.options);

    // update options for the range
    this.range.setOptions(this.options);

    // update options the content
    var itemsTop,
        itemsHeight,
        mainHeight,
        maxHeight,
        me = this;

    if (this.options.orientation == 'top') {
        itemsTop = function () {
            return me.timeaxis.height;
        }
    }
    else {
        itemsTop = function () {
            return me.main.height - me.timeaxis.height - me.content.height;
        }
    }

    if (this.options.height) {
        // fixed height
        mainHeight = this.options.height;
        itemsHeight = function () {
            return me.main.height - me.timeaxis.height;
        };
    }
    else {
        // auto height
        mainHeight = function () {
            return me.timeaxis.height + me.content.height;
        };
        itemsHeight = null;
    }

    // TODO: maxHeight should be a string in px or % (currently only accepts a number)
    if (this.options.maxHeight) {
        if (!util.isNumber(this.options.maxHeight)) {
            throw new TypeError('Number expected for property maxHeight');
        }
        maxHeight = function () {
            return me.options.maxHeight - me.timeaxis.height;
        }
    }

    this.main.setOptions({
        height: mainHeight
    });

    this.content.setOptions({
        orientation: this.options.orientation,
        top: itemsTop,
        height: itemsHeight,
        maxHeight: maxHeight
    });

    this.controller.repaint();
};

/**
 * Set items
 * @param {vis.DataSet | Array | DataTable | null} items
 */
Timeline.prototype.setItems = function(items) {
    var initialLoad = (this.items == null);

    // convert to type DataSet when needed
    var newItemSet;
    if (!items) {
        newItemSet = null;
    }
    else if (items instanceof DataSet) {
        newItemSet = items;
    }
    if (!(items instanceof DataSet)) {
        newItemSet = new DataSet({
            fieldTypes: {
                start: 'Date',
                end: 'Date'
            }
        });
        newItemSet.add(items);
    }

    // set items
    this.items = newItemSet;
    this.content.setItems(newItemSet);

    if (initialLoad && (this.options.start == undefined || this.options.end == undefined)) {
        // apply the data range as range
        var dataRange = this.getItemRange();

        // add 5% on both sides
        var min = dataRange.min;
        var max = dataRange.max;
        if (min != null && max != null) {
            var interval = (max.valueOf() - min.valueOf());
            min = new Date(min.valueOf() - interval * 0.05);
            max = new Date(max.valueOf() + interval * 0.05);
        }

        // override specified start and/or end date
        if (this.options.start != undefined) {
            min = new Date(this.options.start.valueOf());
        }
        if (this.options.end != undefined) {
            max = new Date(this.options.end.valueOf());
        }

        // apply range if there is a min or max available
        if (min != null || max != null) {
            this.range.setRange(min, max);
        }
    }
};

/**
 * Set groups
 * @param {vis.DataSet | Array | DataTable} groups
 */
Timeline.prototype.setGroups = function(groups) {
    this.groups = groups;

    // switch content type between ItemSet or GroupSet when needed
    var type = this.groups ? GroupSet : ItemSet;
    if (!(this.content instanceof type)) {
        // remove old content set
        if (this.content) {
            this.content.hide();
            if (this.content.setItems) {
                this.content.setItems();
            }
            if (this.content.setGroups) {
                this.content.setGroups();
            }
            this.controller.remove(this.content);
        }

        // create new content set
        this.content = new type(this.main, [this.timeaxis]);
        if (this.content.setRange) {
            this.content.setRange(this.range);
        }
        if (this.content.setItems) {
            this.content.setItems(this.items);
        }
        if (this.content.setGroups) {
            this.content.setGroups(this.groups);
        }
        this.controller.add(this.content);
        this.setOptions(this.options);
    }
};

/**
 * Get the data range of the item set.
 * @returns {{min: Date, max: Date}} range  A range with a start and end Date.
 *                                          When no minimum is found, min==null
 *                                          When no maximum is found, max==null
 */
Timeline.prototype.getItemRange = function getItemRange() {
    // calculate min from start filed
    var items = this.items,
        min = null,
        max = null;

    if (items) {
        // calculate the minimum value of the field 'start'
        var minItem = items.min('start');
        min = minItem ? minItem.start.valueOf() : null;

        // calculate maximum value of fields 'start' and 'end'
        var maxStartItem = items.max('start');
        if (maxStartItem) {
            max = maxStartItem.start.valueOf();
        }
        var maxEndItem = items.max('end');
        if (maxEndItem) {
            if (max == null) {
                max = maxEndItem.end.valueOf();
            }
            else {
                max = Math.max(max, maxEndItem.end.valueOf());
            }
        }
    }

    return {
        min: (min != null) ? new Date(min) : null,
        max: (max != null) ? new Date(max) : null
    };
};