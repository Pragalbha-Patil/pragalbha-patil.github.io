// Initialize Appwrite client and databases
const { Client, Databases, Query } = Appwrite;
const client = new Client();
client.setEndpoint('https://fra.cloud.appwrite.io/v1').setProject('667d0f2d001c4fce8b90');
const databases = new Databases(client);

// Configuration
const CONFIG = {
    numCheckboxes: 1000000,
    batchSize: 1000,
    batchDelay: 50,
    databaseId: '667d0f99001b691d76cc',
    collectionId: '667d0fa8000f64e4decc',
    usersCollectionId: '66830ef30011252083cb',
    maxPendingUpdates: 50, // Batch updates when this many pending
    updateBatchDelay: 2000, // Max time to wait before sending batch
    requestTimeout: 10000,
    maxRetries: 3,
};

// State management
const state = {
    renderedCount: 0,
    ticking: false,
    checkboxStates: {}, // Object to store checkbox states
    checkedCount: 0,
    lastId: 0,
    lastRemCount: 0,
    userId: localStorage.getItem("userId"),
    userActivity: null,
    userCheckedCount: 0,
    appwriteStateLoading: false,
    initialRenderComplete: false,
    isAutoScrolling: false,
    lastScrollY: 0,
    pendingUpdates: new Map(), // id -> state
    loadedStateRanges: [], // Array of {start, end}
    requestInFlight: false,
};

const elements = {
    container: null,
    countDisplay: null,
    progressBar: null,
    loadingIndicator: null,
};

// Initialize elements on DOM ready
function initElements() {
    console.log('[INIT] initElements() called');
    elements.container = document.getElementById('checkbox-container');
    elements.countDisplay = document.getElementById('count-display');
    elements.progressBar = document.getElementById('scroll-progress');
    elements.loadingIndicator = document.getElementById('loading');
    console.log('[INIT] Elements initialized:', {
        hasContainer: !!elements.container,
        hasCountDisplay: !!elements.countDisplay,
        hasProgressBar: !!elements.progressBar,
        hasLoadingIndicator: !!elements.loadingIndicator
    });
}

// Debounce function for expensive operations
function debounce(func, wait) {
    let timeout;
    function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    }
    executedFunction.cancel = () => {
        clearTimeout(timeout);
        timeout = null;
    };
    return executedFunction;
}

// Throttle function for high-frequency events
function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ============ NETWORK & STORAGE OPTIMIZATION ============

/**
 * Batch update multiple checkboxes in a single DB operation
 * Much more efficient than individual updates
 */
async function flushPendingUpdates() {
    if (state.pendingUpdates.size === 0 || state.requestInFlight) return;

    state.requestInFlight = true;
    const updates = Array.from(state.pendingUpdates.entries());
    state.pendingUpdates.clear();

    try {
        // Group into create, update, delete operations
        const toCreate = [];
        const toUpdate = [];
        const toDelete = [];

        for (const [id, isChecked] of updates) {
            const documentId = `id-${id}`;
            if (isChecked) {
                toCreate.push({ documentId, id, state: true });
            } else {
                toDelete.push({ documentId });
            }
        }

        // Execute operations in parallel with error handling for each
        const results = await Promise.allSettled([
            ...toCreate.map(op =>
                databases.createDocument(CONFIG.databaseId, CONFIG.collectionId, op.documentId, { id: op.id, state: true })
                    .catch(() => databases.updateDocument(CONFIG.databaseId, CONFIG.collectionId, op.documentId, { id: op.id, state: true }))
            ),
            ...toDelete.map(op =>
                databases.deleteDocument(CONFIG.databaseId, CONFIG.collectionId, op.documentId)
            )
        ]);

        // Log any failures
        results.forEach((result, idx) => {
            if (result.status === 'rejected') {
                console.warn(`Update ${idx} failed:`, result.reason);
            }
        });
    } catch (error) {
        console.error('Error flushing pending updates:', error);
        // Re-queue failed updates
        updates.forEach(([id, state]) => {
            state.pendingUpdates.set(id, state);
        });
    } finally {
        state.requestInFlight = false;
    }
}

// Debounced batch updates
const debouncedFlushUpdates = debounce(flushPendingUpdates, CONFIG.updateBatchDelay);

/**
 * Queue a checkbox state change for batching
 * Prevents thundering herd of network requests
 */
function queueCheckboxUpdate(id, isChecked) {
    state.pendingUpdates.set(id, isChecked);

    // Flush if we reach threshold
    if (state.pendingUpdates.size >= CONFIG.maxPendingUpdates) {
        debouncedFlushUpdates.cancel?.(); // Cancel any pending debounce
        flushPendingUpdates();
    } else {
        debouncedFlushUpdates();
    }
}

/**
 * Subscribe to real-time updates with connection management
 */
async function subscribeToUpdates() {
    console.log('[SUBSCRIBE] subscribeToUpdates() called');
    try {
        console.log('[SUBSCRIBE] establishing websocket connection');
        await client.subscribe(
            [`databases.${CONFIG.databaseId}.collections.${CONFIG.collectionId}.documents`],
            (response) => {
                console.log('[SUBSCRIBE] WebSocket event received:', response);
                if (!response?.events?.[0]) return;

                const eventsArr = response.events[0].split('.');
                const actionPerformed = eventsArr[eventsArr.length - 1];

                if (!response.payload?.id) return;

                const id = String(response.payload.id);

                if (actionPerformed === 'delete') {
                    state.checkboxStates[id] = false;
                } else if (response.payload?.state !== undefined) {
                    state.checkboxStates[id] = response.payload.state;
                }

                // Update UI for this specific checkbox if visible
                updateUIForCheckbox(id, state.checkboxStates[id]);

                // Recalculate count (debounced)
                recalculateCheckedCount();
            }
        );
        console.log('[SUBSCRIBE] WebSocket subscription established');
    } catch (error) {
        console.error('[SUBSCRIBE] Failed to subscribe to updates:', error);
        // Retry subscription after delay
        setTimeout(subscribeToUpdates, 5000);
    }
}

/**
 * Fetch checkbox states from database with range validation
 * Only fetches ranges we haven't already loaded
 */
async function fetchStateFromAppwrite(startId = 0, endId = CONFIG.numCheckboxes) {
    console.log('[FETCH] fetchStateFromAppwrite() called with:', { startId, endId });

    // Check if range is already loaded or loading
    if (state.appwriteStateLoading) {
        console.log('[FETCH] Already loading, skipping');
        return;
    }

    const rangeOverlaps = state.loadedStateRanges.some(range =>
        !(endId < range.start || startId > range.end)
    );

    if (rangeOverlaps) {
        console.log('[FETCH] Range already loaded, skipping');
        return;
    }

    state.appwriteStateLoading = true;
    let docsProcessed = 0;
    let offset = 0;
    const limit = 1000;

    try {
        console.log('[FETCH] Starting to fetch documents...');
        let hasMoreDocuments = true;

        while (hasMoreDocuments) {
            console.log('[FETCH] Fetching batch at offset:', offset);
            const response = await Promise.race([
                databases.listDocuments(
                    CONFIG.databaseId,
                    CONFIG.collectionId,
                    [Query.limit(limit), Query.offset(offset)]
                ),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Request timeout')), CONFIG.requestTimeout)
                )
            ]);

            if (!response?.documents) {
                console.log('[FETCH] No documents in response');
                break;
            }

            console.log('[FETCH] Received', response.documents.length, 'documents');
            response.documents.forEach(doc => {
                const id = String(doc.id);
                state.checkboxStates[id] = doc.state;
                docsProcessed++;
            });

            offset += limit;
            hasMoreDocuments = response.documents.length === limit;
        }

        state.loadedStateRanges.push({ start: startId, end: endId });
        console.log('[FETCH] Processed', docsProcessed, 'documents total');

        if (!state.initialRenderComplete) {
            state.lastRemCount = CONFIG.numCheckboxes - docsProcessed;
            recalculateCheckedCount();
            debouncedUpdateCountDisplay();
            if (elements.loadingIndicator) {
                elements.loadingIndicator.setAttribute("hidden", true);
            }

            state.initialRenderComplete = true;
            console.log('[FETCH] Initial render marked complete');
        }
    } catch (error) {
        console.error('[FETCH] Error fetching checkbox states:', error);
    } finally {
        state.appwriteStateLoading = false;
    }
}

// ============ DOM OPERATIONS ============

/**
 * Create checkbox element with proper memory cleanup
 */
function createCheckbox(id) {
    const checkboxDiv = document.createElement('div');
    checkboxDiv.className = 'checkbox-item';
    checkboxDiv.dataset.id = id;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'form-check-input';
    checkbox.id = `checkbox-${id}`;
    checkbox.checked = state.checkboxStates[id] || false;

    // Use event delegation instead of individual listeners for memory efficiency
    checkbox.addEventListener('change', () => {
        const newState = checkbox.checked;
        state.checkboxStates[id] = newState;
        queueCheckboxUpdate(id, newState);
        recalculateCheckedCount();
    });

    checkboxDiv.appendChild(checkbox);

    return checkboxDiv;
}

/**
 * Render checkboxes efficiently
 */
function renderCheckboxes(start, end, updateRender, checkboxId, isChecked) {
    console.log('[RENDER] Called with:', { start, end, updateRender, checkboxId, isChecked });
    console.log('[RENDER] State object exists?', !!state);
    console.log('[RENDER] State.lastId value:', state?.lastId);

    // Safety check - make sure state exists
    if (!state || typeof state.lastId !== 'number') {
        console.error('Fatal: State not properly initialized', state);
        return;
    }

    if (updateRender && checkboxId) {
        const element = document.getElementById(`checkbox-${checkboxId}`);
        if (element) element.checked = isChecked;
        return;
    }

    if (!elements.container) {
        console.error('Container not initialized');
        return;
    }

    const fragment = document.createDocumentFragment();
    for (let i = start; i <= end && i <= CONFIG.numCheckboxes; i++) {
        state.lastId++;
        fragment.appendChild(createCheckbox(state.lastId));
    }
    elements.container.appendChild(fragment);
}

/**
 * Update specific checkbox in DOM if visible
 */
function updateUIForCheckbox(id, isChecked) {
    const checkbox = document.getElementById(`checkbox-${id}`);
    if (checkbox && checkbox.checked !== isChecked) {
        checkbox.checked = isChecked;
    }
}

function updateUI(updateRender, id, checkState) {
    if (updateRender && id) {
        updateUIForCheckbox(id, checkState);
    } else {
        renderCheckboxes(1, 2000, false);
    }
}

/**
 * Check if element is in viewport
 */
function isElementInViewport(el) {
    const rect = el.getBoundingClientRect();
    const buffer = 3000;

    return (
        rect.top >= -buffer &&
        rect.left >= -buffer &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) + buffer &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth) + buffer
    );
}

// ============ RENDERING & SCROLL OPTIMIZATION ============

/**
 * Calculate checked count efficiently (cached)
 */
function recalculateCheckedCount() {
    const newCount = Object.values(state.checkboxStates).filter(v => v).length;
    if (newCount !== state.checkedCount) {
        state.checkedCount = newCount;
        debouncedUpdateCountDisplay();
    }
}

/**
 * Update count display (debounced)
 */
let tempUpdate = 0;
let msgShown = false;
let msgShown2 = false;

const debouncedUpdateCountDisplay = debounce(() => {
    if (!elements.countDisplay) return; // Safety check

    elements.countDisplay.textContent = state.checkedCount.toLocaleString();

    const remaining = document.getElementById('remaining-checkboxes');
    if (!remaining) return;

    const remainingCount = CONFIG.numCheckboxes - state.checkedCount;
    remaining.textContent = remainingCount.toLocaleString();

    remaining.style.color = state.lastRemCount < remainingCount ? 'red' : 'green';

    tempUpdate++;
    if (tempUpdate > 200 && !msgShown) {
        alert('chill, lol');
        msgShown = true;
    }
    if (msgShown && !msgShown2 && tempUpdate > 1000) {
        alert('umm... don\'t you have anything better to do?');
        msgShown2 = true;
    }
}, 100);

/**
 * Load more checkboxes as user scrolls (with proper cleanup)
 */
function loadMoreCheckboxes() {
    if (state.ticking) return;
    if (!elements.container) return; // Safety check

    state.ticking = true;

    requestAnimationFrame(() => {
        const containerHeight = elements.container.clientHeight;
        const scrollPosition = window.scrollY + window.innerHeight;

        // Render more if needed
        if (scrollPosition >= containerHeight - 1000 && state.renderedCount < CONFIG.numCheckboxes) {
            const start = state.renderedCount + 1;
            const end = Math.min(state.renderedCount + CONFIG.batchSize, CONFIG.numCheckboxes);
            renderCheckboxes(start, end, false);
            state.renderedCount = end;

            // Lazy-load DB state for visible area
            const approxIdAtViewport = Math.max(1, Math.floor(scrollPosition / 40));
            fetchStateFromAppwrite(
                Math.max(1, approxIdAtViewport - 5000),
                Math.min(CONFIG.numCheckboxes, approxIdAtViewport + 5000)
            );
        }

        // Clean up off-screen checkboxes when scrolling up
        if (window.scrollY < state.lastScrollY) {
            const checkboxes = Array.from(elements.container.querySelectorAll('.checkbox-item'));
            const inViewport = checkboxes.filter(cb => isElementInViewport(cb));

            if (checkboxes.length > inViewport.length + 500 && checkboxes.length - inViewport.length > 1000) {
                const toRemove = checkboxes.slice(0, checkboxes.length - inViewport.length - 500);
                toRemove.forEach(el => el.remove());
                state.renderedCount = Math.max(0, state.renderedCount - toRemove.length);
            }
        }

        state.lastScrollY = window.scrollY;
        state.ticking = false;
    });
}

/**
 * Throttled scroll listener
 */
const throttledLoadMore = throttle(loadMoreCheckboxes, 100);

/**
 * Update scroll progress bar (with division by zero check)
 */
function updateScrollProgress() {
    const scrollHeight = document.body.scrollHeight - window.innerHeight;
    const scrollPercent = scrollHeight > 0 ? (window.scrollY / scrollHeight) * 100 : 0;

    if (elements.progressBar) {
        elements.progressBar.style.width = Math.min(100, scrollPercent) + '%';
    }
}

/**
 * Update button visibility (debounced)
 */
const debouncedUpdateScrollButtons = debounce(() => {
    const scrollTopBtn = document.getElementById('scrollTopBtn');
    const scrollBottomBtn = document.getElementById('scrollBottomBtn');

    if (window.scrollY > 300) {
        scrollTopBtn?.removeAttribute('hidden');
    } else {
        scrollTopBtn?.setAttribute('hidden', 'true');
    }

    const isNearBottom = window.scrollY + window.innerHeight >= document.body.scrollHeight - 500;
    if (!isNearBottom) {
        scrollBottomBtn?.removeAttribute('hidden');
    } else if (!state.isAutoScrolling) {
        scrollBottomBtn?.setAttribute('hidden', 'true');
    }

    updateScrollProgress();
}, 50);

/**
 * Unified scroll event handler
 */
function handleScroll() {
    throttledLoadMore();
    debouncedUpdateScrollButtons();
}

// ============ SCROLL NAVIGATION ============

function scrollToTop() {
    if (state.isAutoScrolling) {
        stopAutoScroll();
        return;
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
}

function scrollToBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
}

function autoScrollToBottom() {
    const scrollBottomBtn = document.getElementById('scrollBottomBtn');

    if (state.isAutoScrolling) {
        stopAutoScroll();
        scrollBottomBtn.textContent = 'Bottom ↓';
        scrollBottomBtn.removeAttribute("disabled");
        return;
    }

    state.isAutoScrolling = true;
    scrollBottomBtn.setAttribute("disabled", true);
    scrollBottomBtn.textContent = 'Stop (■)';

    const scrollInterval = setInterval(() => {
        scrollToBottom();
    }, 800);

    // Store interval for cleanup
    state.scrollInterval = scrollInterval;
}

function stopAutoScroll() {
    if (state.scrollInterval) {
        clearInterval(state.scrollInterval);
        state.scrollInterval = undefined;
    }
    state.isAutoScrolling = false;
}

// ============ INITIALIZATION ============

/**
 * Initialize the application
 */
function initializeApp() {
    console.log('[INIT] initializeApp() started');
    console.log('[INIT] Global state at startup:', state);

    initElements();
    console.log('[INIT] After initElements, state is:', state);

    // Render initial batch immediately
    const initialBatch = CONFIG.batchSize * 2;
    console.log('[INIT] About to call renderCheckboxes with:', { start: 1, end: initialBatch });
    renderCheckboxes(1, initialBatch, false);
    state.renderedCount = initialBatch;
    console.log('[INIT] Rendered initial batch, state.renderedCount:', state.renderedCount);
    debouncedUpdateCountDisplay();

    // Setup event listeners
    document.getElementById('scrollTopBtn')?.addEventListener('click', scrollToTop);
    document.getElementById('scrollBottomBtn')?.addEventListener('click', autoScrollToBottom);
    window.addEventListener('scroll', handleScroll);

    // Keyboard shortcuts
    window.addEventListener('keydown', (event) => {
        if (event.code === 'Home') {
            event.preventDefault();
            scrollToTop();
        } else if (event.code === 'End') {
            event.preventDefault();
            autoScrollToBottom();
        }
    });

    // Manual scroll up interrupt
    window.addEventListener('wheel', (event) => {
        if (state.isAutoScrolling && event.deltaY < 0) {
            stopAutoScroll();
            const btn = document.getElementById('scrollBottomBtn');
            if (btn) {
                btn.textContent = 'Bottom ↓';
                btn.removeAttribute("disabled");
            }
        }
    }, { passive: true });

    // Cleanup on unload
    window.addEventListener('beforeunload', () => {
        stopAutoScroll();
        flushPendingUpdates();
    });

    // Start async operations after DOM is ready (non-blocking)
    setTimeout(() => {
        console.log('[ASYNC-INIT] Starting network operations');
        try {
            console.log('[ASYNC-INIT] Calling subscribeToUpdates()');
            subscribeToUpdates(); // Non-blocking callback subscription
            console.log('[ASYNC-INIT] Calling fetchStateFromAppwrite()');
            fetchStateFromAppwrite(); // Fetch initial state in background
            console.log('[ASYNC-INIT] Network operations initiated');
        } catch (error) {
            console.error('Failed to initialize network operations:', error);
        }
    }, 500);
}

document.addEventListener('DOMContentLoaded', initializeApp);

// ============ UTILITY FUNCTIONS ============

async function trackUserActivity() {
    if (state.userId) {
        try {
            state.userActivity = await databases.listDocuments(
                CONFIG.databaseId,
                CONFIG.usersCollectionId,
                [Query.equal('user_id', state.userId)]
            );
            if (state.userActivity?.documents?.[0]) {
                state.userCheckedCount = (state.userActivity.documents[0].checked_boxes || []).length;
            }
        } catch (error) {
            console.error('Error tracking user activity:', error);
        }
    } else {
        const genRandomHex = (size) =>
            [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

        state.userId = genRandomHex(20);
        localStorage.setItem("userId", state.userId);

        try {
            await databases.createDocument(
                CONFIG.databaseId,
                CONFIG.usersCollectionId,
                state.userId,
                { user_id: state.userId, checked_boxes: [] }
            );
        } catch (error) {
            console.error('Error creating user activity:', error);
        }
    }
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function toggleRandomCheckbox(id) {
    const checkboxId = id || getRandomInt(1, state.renderedCount);
    const checkbox = document.getElementById(`checkbox-${checkboxId}`);

    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
}
