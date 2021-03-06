/**
 * @fileoverview A skeleton of page, later filled with content.
 */

goog.provide('treesaver.layout.Grid');

goog.require('treesaver.array');
goog.require('treesaver.capabilities');
goog.require('treesaver.debug');
goog.require('treesaver.dom');
goog.require('treesaver.dimensions');
goog.require('treesaver.layout.Block');
goog.require('treesaver.layout.BreakRecord');
goog.require('treesaver.layout.Column');
goog.require('treesaver.layout.Container');
goog.require('treesaver.layout.Figure');

/**
 * Grid class
 * @constructor
 * @param {!Element} node HTML root for grid.
 */
treesaver.layout.Grid = function(node) {
  if (goog.DEBUG) {
    if (!node || !treesaver.dom.hasClass(node, 'grid')) {
      treesaver.debug.error('Non grid passed to initGrid');
    }
  }

  // Insert into tree for measuring
  document.body.appendChild(node);

  /**
   * List of required capabilities for this Grid
   * TODO: Only store mutable capabilities
   *
   * @type {?Array.<string>}
   */
  this.requirements = treesaver.dom.hasAttr(node, 'data-requires') ?
    node.getAttribute('data-requires').split(' ') : null;

  /**
   * @type {Array.<string>}
   */
  this.classes = treesaver.dom.classes(node, true);

  /**
   * @type {boolean}
   */
  this.flexible = !treesaver.dom.hasClass(node, 'fixed');

  /**
   * @type {Object.<string, boolean>}
   */
  this.scoringFlags;

  /**
   * @type {?Object.<number, boolean>}
   */
  this.pageNumberFlags;

  /**
   * @type {?Object.<number, boolean>}
   */
  this.pageNumberNegationFlags;

  // Calculate all page scoring flags
  this.findScoringFlags();

  // Sizing
  // Flex grids get stretched later
  this.stretchedSize = this.size = new treesaver.dimensions.Metrics(node);
  if (!this.flexible) {
    this.size.minH = this.size.h;
    this.size.minW = this.size.w;
  }
  else {
    // Use width instead of minWidth
    this.size.minW = Math.max(this.size.minW || 0, this.size.w);
  }
  // Line height needs to be set for stretch sizing ...
  // TODO: What's a reasonable back-up value here?
  this.lineHeight = this.size.lineHeight || 1;

  /**
   * @type {number}
   */
  this.textHeight = 0;

  /**
   * @type {number}
   */
  this.maxColHeight = 0;

  /**
   * Width of columns used in this Grid
   * @type {number}
   */
  this.colWidth = 0;

  /**
   * @type {boolean}
   */
  this.error = false;

  /**
   * @type {Array.<treesaver.layout.Column>}
   */
  this.cols = [];
  treesaver.dom.getElementsByClassName('column', node).forEach(function(colNode) {
    var cur = new treesaver.layout.Column(colNode, this.size.h);
    this.cols.push(cur);

    // Calculate total height
    this.textHeight += cur.h;
    this.maxColHeight = Math.max(this.maxColHeight, cur.h);

    // Confirm column width
    if (!this.colWidth) {
      this.colWidth = colNode.offsetWidth;
    }
    else if (this.colWidth !== colNode.offsetWidth) {
      treesaver.debug.error('Inconsistent column widths in grid');

      this.error = true;
    }
  }, this);

  /**
   * @type {Array.<treesaver.layout.Container>}
   */
  this.containers = [];
  treesaver.dom.getElementsByClassName('container', node).forEach(function(containerNode) {
    var cur = new treesaver.layout.Container(containerNode, this.size.h);
    this.containers.push(cur);
  }, this);

  // Save out the HTML after processing Columns and Containers, in order to maintain
  // any sanitization that may have occurred.
  /**
   * @type {string}
   */
  this.html = treesaver.dom.outerHTML(node);

  // Remove the child
  document.body.removeChild(node);
};

treesaver.layout.Grid.knownFlags = {
  'onlypage': true,
  'odd': true,
  'even': true,
  'sizetocontainer': true
};

treesaver.layout.Grid.pageFlagRegex = /^(no-)?page-(\d+)$/;

/**
 * Parse the class array and find any scoring flags
 */
treesaver.layout.Grid.prototype.findScoringFlags = function() {
  var pageNumberFlagFound = false,
      match, index;

  this.scoringFlags = {};
  this.pageNumberFlags = {};
  this.pageNumberNegationFlags = {};

  this.classes.forEach(function(className) {
    if (className in treesaver.layout.Grid.knownFlags) {
      this.scoringFlags[className] = true;
    }
    else if ((match = treesaver.layout.Grid.pageFlagRegex.exec(className))) {
      index = parseInt(match[2], 10);

      if (!isNaN(index)) {
        if (className.substr(0, 3) === 'no-') {
          this.pageNumberNegationFlags[index] = true;
        }
        else {
          pageNumberFlagFound = true;
          this.pageNumberFlags[index] = true;
        }
      }
    }
  }, this);

  if (!pageNumberFlagFound) {
    this.pageNumberFlags = null;
  }
};

/**
 * Stretch the height of a grid
 * @param {number} totalHeight The maximum possible height (including margin,
 *                             border, and padding) of the grid.
 */
treesaver.layout.Grid.prototype.stretch = function(totalHeight) {
  if (!this.flexible) {
    return this;
  }

  var i, len, cur,
      contentHeight = totalHeight -
        (this.size.marginHeight + this.size.bpHeight),
      finalHeight = Math.min(this.size.maxH,
          Math.max(contentHeight, this.size.minH)),
      delta = finalHeight - this.size.minH || 0;

  // Our height is always min plus a multiple of lineheight
  finalHeight -= delta % this.lineHeight;

  this.maxColHeight = 0;

  this.textHeight = 0;
  // Stretch columns and compute new heights
  this.cols.forEach(function(col) {
    this.textHeight += col.stretch(finalHeight).h;
    this.maxColHeight = Math.max(this.maxColHeight, col.h);
  }, this);

  // Stretch containers
  this.containers.forEach(function(container) {
    container.stretch(finalHeight);
  }, this);

  this.stretchedSize = this.size.clone();
  this.stretchedSize.h = finalHeight;
  this.stretchedSize.outerH = finalHeight + this.size.bpHeight;

  // Max
  if (!this.scoringFlags['sizetocontainer']) {
    this.stretchedSize.maxH =
      Math.min(this.size.maxH, finalHeight + this.lineHeight * 3);
  }
  else {
    this.stretchedSize.maxH = this.size.maxH;
  }

  return this;
};

/**
  * Comparison function for sorting grids
  * @param {!treesaver.layout.Grid} a
  * @param {!treesaver.layout.Grid} b
  */
treesaver.layout.Grid.sort = function(a, b) {
  // Sort by column and container count, descending
  // Note: Grids should be stretched beforehand
  return (b.size.w + 20 * b.containers.length) -
    (a.size.w + 20 * a.containers.length);
};

/**
  * Compute the score for this grid given the current state
  * of pagination
  * @param {!treesaver.layout.Content} content
  * @param {!treesaver.layout.BreakRecord} breakRecord
  */
treesaver.layout.Grid.prototype.score = function(content, breakRecord) {
  var score = 0,
      humanPageNum = breakRecord.pageNumber + 1;

  // Bonus for higher column count
  score += this.cols.length * treesaver.layout.Grid.SCORING.COLUMN;
  // Penalize for incompatible line heights
  if (this.lineHeight !== content.lineHeight) {
    score -= treesaver.layout.Grid.SCORING.DIFFERENT_LINEHEIGHT;
  }

  if (this.colWidth && this.colWidth !== content.colWidth) {
    score -= treesaver.layout.Grid.SCORING.DIFFERENT_COLWIDTH;
  }

  // Page flags
  if (this.scoringFlags['onlypage']) {
    // TODO: Use different values for penalties and bonuses
    score += breakRecord.pageNumber ? -treesaver.layout.Grid.SCORING.NON_ONLY_PAGE :
      treesaver.layout.Grid.SCORING.ONLY_PAGE;
  }

  // Check general page number flag
  if (this.pageNumberFlags) {
    if (this.pageNumberFlags[humanPageNum]) {
      score += treesaver.layout.Grid.SCORING.PAGE_NUMBER;
    }
    else {
      score -= treesaver.layout.Grid.SCORING.NON_PAGE_NUMBER;
    }
  }

  // Check negations
  if (this.pageNumberNegationFlags[humanPageNum]) {
    score -= treesaver.layout.Grid.SCORING.NON_PAGE_NUMBER;
  }

  if (humanPageNum % 2) {
    score += this.scoringFlags['odd'] ? treesaver.layout.Grid.SCORING.ODD_PAGE :
      this.scoringFlags['even'] ? -treesaver.layout.Grid.SCORING.NON_EVEN_ODD : 0;
  }
  else {
    score += this.scoringFlags['even'] ? treesaver.layout.Grid.SCORING.EVEN_PAGE :
      this.scoringFlags['odd'] ? -treesaver.layout.Grid.SCORING.NON_EVEN_ODD : 0;
  }

  return score;
};

/**
 * Typedef for compiler
 * TODO: Make a real typedef
 *
 * @typedef {{figureIndex, figureSize, flexible}}
 */
treesaver.layout.Grid.ContainerMap;

/**
  * @param {!treesaver.layout.Content} content
  * @param {!treesaver.layout.BreakRecord} br
  * @return {!Array.<treesaver.layout.Grid.ContainerMap>}
  */
treesaver.layout.Grid.prototype.mapContainers = function(content, br) {
  var i, len, container,
      k, size,
      figureIndex, currentIndex,
      figure, figureSize, figures,
      delayed, usingDelayed,
      map = [];

  // Loop through each container and see if we have a figure that fits
  container_loop:
  for (i = 0, len = this.containers.length; i < len; i += 1) {
    container = this.containers[i];
    map[i] = null;
    figureIndex = br.figureIndex;
    // Duplicate the delayed array
    delayed = br.delayed.slice(0);

    figure_loop:
    while (delayed.length || figureIndex < content.figures.length) {
      // Go through delayed/skipped figures first
      if ((usingDelayed = !!delayed.length)) {
        // Take the oldest figure first
        currentIndex = delayed.shift();
      }
      else {
        currentIndex = figureIndex;
      }
      figure = content.figures[currentIndex];

      // Start at the end of the size list in order to find
      // the highest possible match
      size_loop:
      for (k = container.sizes.length - 1; k >= 0; k -= 1) {
        size = container.sizes[k];

        // TODO: Watch for previous failures at this size

        figureSize = figure.getSize(size);

        if (figureSize) {
          // Make sure the height fits for flexible containers
          // Fixed containers should know better than to specify
          // a size that doesn't fit
          if (container.flexible && figureSize.minH &&
              figureSize.minH > container.h) {
            // This size won't work, go to the next
            continue size_loop;
          }

          // Container fits, store mapping
          map[i] = {
            figureIndex: currentIndex,
            figureSize: figureSize,
            size: size,
            // Also used for scoring
            flexible: container.flexible
          };

          // Mark the figure as used
          br.useFigure(currentIndex);

          // This container is filled, move on to the next container
          break figure_loop;
        }
      } // size_loop

      // Required figures must occur in-order
      if (!figure.optional) {
        // Can't move on to the next figure since it might cause
        // incorrect order
        // TODO: See if this figure could fit in other containers
        // Or perhaps flip order around to look at figures first, then
        // containers
        break;
      }

      // Try the next figure
      if (!usingDelayed) {
        figureIndex += 1;
      }
    } // figure_loop
  } // container_loop

  return map;
};

/**
 * @param {!string} themeName
 * @return {boolean} True if the grid is compatible with the given theme
 */
treesaver.layout.Grid.prototype.hasTheme = function(themeName) {
  return this.classes.indexOf(themeName) !== -1;
};

/**
 * Eliminate a grid if it does not meet the current browser capabilities
 *
 * @return {boolean} False if the grid does not qualify
 */
treesaver.layout.Grid.prototype.capabilityFilter = function() {
  if (!this.requirements) {
    return true;
  }

  return treesaver.capabilities.check(this.requirements, true);
};

/**
 * Eliminate a grid if it does not fit within the specified size
 *
 * @param {!treesaver.dimensions.Size} size
 * @return {boolean} False if the grid does not qualify
 */
treesaver.layout.Grid.prototype.sizeFilter = function(size) {
  var innerSize = {
    w: size.w - this.size.bpWidth, // Don't use margin for width
    h: size.h - this.size.bpHeight - this.size.marginHeight
  };

  return treesaver.dimensions.inSizeRange(this.size, innerSize);
};

treesaver.layout.Grid.SCORING = {
  FINISH_TEXT: 250,
  FINISH_ALL: 2000,
  FIXED_CONTAINER: 5000,
  COLUMN: 50,
  EMPTINESS_PENALTY: 2000,
  EMPTY_CONTAINER_PENALTY: 5000,
  DIFFERENT_LINEHEIGHT: 2000,
  DIFFERENT_COLWIDTH: Infinity,
  CONTAINER_BONUS: 2000,
  CONTAINER_AREA_BONUS: 5,
  BLOCK_DELAY_PENALTY: 100,
  REQUIRED_BLOCK_BONUS: 4000,
  PAGE_NUMBER: 3000,
  ONLY_PAGE: 4000,
  ODD_PAGE: 2000,
  EVEN_PAGE: 2000,
  NON_EVEN_ODD: Infinity,
  NON_ONLY_PAGE: Infinity,
  NON_PAGE_NUMBER: Infinity
};

/**
  * Find the best grid for given content
  * @param {!treesaver.layout.Content} content
  * @param {!Array.<treesaver.layout.Grid>} grids
  * @param {!treesaver.layout.BreakRecord} breakRecord
  * @return {?{grid: !treesaver.layout.Grid, containers: !Array.<treesaver.layout.Grid.ContainerMap>}}
  */
treesaver.layout.Grid.best = function(content, grids, breakRecord) {
  if (goog.DEBUG) {
    if (!content) {
      treesaver.debug.error('No content passed to grid.best');
    }
    else if (!grids.length) {
      treesaver.debug.error('No grids passed to grid.best');
    }
    else if (!breakRecord) {
      treesaver.debug.error('No breakRecord passed to grid.best');
    }
  }

  var best = null,
      highScore = -Infinity,
      percentEmpty,
      containerMap,
      // Content block loop
      blockCount = content.blocks.length,
      block, blockHeightEstimate, figure,
      // Grid loop
      i, len, cur, br, score, height, remaining_height,
      // Container loop
      j, jlen, container, mapped_container, filledContainerCount, blockAdded;

  // Loop through each grid
  grid_loop:
  for (i = 0, len = grids.length; i < len; i += 1) {
    cur = grids[i];
    filledContainerCount = 0;
    blockAdded = false;
    br = breakRecord.clone();
    height = br.overhang;
    remaining_height = cur.textHeight - height;
    if (height && cur.textHeight) {
      // Overhang counts as a block
      blockAdded = true;
    }

    // Calculate score quickly based on easy information
    score = cur.score(content, br);

    // Create container map
    containerMap = cur.mapContainers(content, br);

    // Calculate container score
    container_loop:
    for (j = 0, jlen = containerMap.length; j < jlen; j += 1) {
      container = cur.containers[j];
      mapped_container = containerMap[j];

      if (mapped_container) {
        figure = content.figures[mapped_container.figureIndex];

        score += treesaver.layout.Grid.SCORING.CONTAINER_BONUS +
          (mapped_container.figureSize.minH) *
          treesaver.layout.Grid.SCORING.CONTAINER_AREA_BONUS;

        if (!figure.optional) {
          score += treesaver.layout.Grid.SCORING.REQUIRED_BLOCK_BONUS;
        }

        // Bonus for a fixed container
        if (!container.flexible) {
          score += treesaver.layout.Grid.SCORING.FIXED_CONTAINER;
        }

        filledContainerCount += 1;
      }
      else if (!container.flexible) {
        score -= treesaver.layout.Grid.SCORING.EMPTY_CONTAINER_PENALTY;
      }
    }

    // Loop through blocks to figure out text fitting
    block_loop:
    while (cur.textHeight &&
           br.index < blockCount && height <= cur.textHeight) {
      block = content.blocks[br.index];
      // Just an estimate
      blockHeightEstimate = block.metrics.outerH + block.metrics.marginTop;

      if (block.keeptogether &&
          (blockHeightEstimate > cur.maxColHeight ||
           blockHeightEstimate > remaining_height)) {
        // Can't add block, leave loop
        break block_loop;
      }

      if (blockHeightEstimate > remaining_height) {
        // Can't add the block, leave loop
        if (block.keeptogether) {
          break block_loop;
        }

        // Go to first child
        if (block.children) {
          br.index += 1;
          continue block_loop;
        }

        // Put part of the block in
        height += blockHeightEstimate;
        // TODO: Track overhang?
      }

      // Block fits, stuff it in
      height += blockHeightEstimate;
      score += blockHeightEstimate;
      remaining_height -= blockHeightEstimate;

      blockAdded = true;
      // Go to the next sibling (or pop out if there is none)
      br.index = block.nextSibling ? block.nextSibling.index : br.index + 1;
    } // block_loop

    // Check for forward progress
    if (!blockAdded) {
      if (!filledContainerCount) {
        // Avoid completely empty grids (will cause loops?)
        score = -Infinity;
      }
      else {
        // The current/next block
        block = content.blocks[br.index];

        // Is this block part of a fallback for a required figure?
        if (block && block.figure && !block.figure.optional) {
          // If so, check if we've already started displaying the fallback for this figure
          if (br.overhang || block.withinFallback) {
            treesaver.debug.warn('No forward progress on required figure fallback');
            // Must make forward progress on open required figure, penalize severely
            score = -Infinity;
          }
        }
      }
    }
    else if (remaining_height > 0) {
      // Penalize for emptiness, based on percentage
      percentEmpty = remaining_height / cur.textHeight;

      // Filled containers make it hard to estimate how full the page really
      // is, so give a 20% bonus per container
      percentEmpty -= filledContainerCount * .2;

      if (percentEmpty > .5) {
        treesaver.debug.info('Grid penalized for emptiness percentage: ' + percentEmpty * 100);
        score -= remaining_height;
        score -= percentEmpty * percentEmpty *
          treesaver.layout.Grid.SCORING.EMPTINESS_PENALTY;
      }
    }

    if (score > highScore) {
      highScore = score;
      best = {
        grid: cur,
        containers: containerMap
      };
    }
  } // grid_loop

  return best;
};

if (goog.DEBUG) {
  treesaver.layout.Grid.prototype.toString = function() {
    return "[Grid " + this.classes + "]";
  };
}
